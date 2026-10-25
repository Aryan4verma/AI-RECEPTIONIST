"""Faster-Whisper STT sidecar (ADR-0005) — local, free, CPU int8.

Endpoints:
  GET  /health     -> {"ok": true, "model_loaded": bool}
  POST /transcribe -> body: raw audio bytes; ?max_seconds=60
                      -> {"transcript": str} or 4xx with {"error": code}

Constraints honored: model loads lazily on first use and unloads after
IDLE_UNLOAD_SECONDS of inactivity; requests are serialized (single worker)
so STT never runs concurrently with anything else inside this process;
int8 tiny keeps RSS well under 1 GB.
"""
import io
import json
import threading
from urllib.parse import parse_qs, urlparse
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_NAME = "tiny"
COMPUTE_TYPE = "int8"
IDLE_UNLOAD_SECONDS = 600
MAX_BODY_BYTES = 10 * 1024 * 1024  # matches backend MAX_AUDIO_MB
MAX_SECONDS = 60.0

_model = None
_model_lock = threading.Lock()
_last_used = 0.0
_worker_lock = threading.Lock()  # serialize transcription


def _load_model():
    global _model, _last_used
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel  # deferred: heavy import

            _model = WhisperModel(MODEL_NAME, device="cpu", compute_type=COMPUTE_TYPE)
        _last_used = time.time()
        return _model


def _unload_if_idle():
    global _model
    with _model_lock:
        if _model is not None and (time.time() - _last_used) > IDLE_UNLOAD_SECONDS:
            _model = None  # release RSS back to the OS


class Handler(BaseHTTPRequestHandler):
    server_version = "whisper-sidecar/1.0"

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "model_loaded": _model is not None})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/transcribe":
            self._send(404, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._send(400, {"error": "empty_body"})
            return
        if length > MAX_BODY_BYTES:
            self._send(413, {"error": "audio_too_large"})
            return
        audio = self.rfile.read(length)
        try:
            model = _load_model()
        except Exception as exc:  # noqa: BLE001 - surfaced as typed error
            self._send(500, {"error": "model_load_failed", "detail": str(exc)[:200]})
            return
        query = parse_qs(urlparse(self.path).query)
        max_seconds = min(float(query.get("max_seconds", ["60"])[0]), MAX_SECONDS)
        try:
            with _worker_lock:  # one transcription at a time
                # faster-whisper accepts a readable BinaryIO — pass an in-memory
                # stream (never a temp file: audio stays in process memory).
                segments, info = model.transcribe(io.BytesIO(audio), beam_size=1, vad_filter=True)
                # DECODED duration is authoritative for EVERY supported format
                # (not just WAV headers): enforce it server-side post-decode.
                if info is not None and info.duration > max_seconds:
                    self._send(422, {"error": "audio_too_long",
                                     "detail": f"{info.duration:.1f}s > {max_seconds:.0f}s"})
                    return
                transcript = " ".join(s.text.strip() for s in segments).strip()
            self._send(200, {"transcript": transcript})
        except Exception as exc:  # noqa: BLE001
            self._send(422, {"error": "transcription_failed", "detail": str(exc)[:200]})

    def log_message(self, fmt, *args):  # quiet: errors only
        if "/health" not in (fmt % args if args else ""):
            super().log_message(fmt, *args)


def _idle_monitor():
    """Real idle unloading: a daemon thread releases the model (and its RSS)
    after IDLE_UNLOAD_SECONDS without a request."""
    while True:
        time.sleep(60)
        try:
            _unload_if_idle()
        except Exception:  # noqa: BLE001 - monitoring must never crash the sidecar
            pass


def main():
    import os

    port = int(os.environ.get("WHISPER_SIDECAR_PORT", "8788"))
    threading.Thread(target=_idle_monitor, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"whisper-sidecar listening on 127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
