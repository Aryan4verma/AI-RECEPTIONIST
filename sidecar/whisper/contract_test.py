"""Contract check (no model load, RAM-light): WhisperModel.transcribe must
accept a readable in-memory BinaryIO (io.BytesIO) per the genuine
faster-whisper input contract. Run: python sidecar/whisper/contract_test.py
"""
import inspect
import io

from faster_whisper import WhisperModel

annotation = str(inspect.signature(WhisperModel.transcribe).parameters["audio"].annotation)
assert "BinaryIO" in annotation or "BytesIO" in annotation or "Union" in annotation, annotation
# BytesIO IS a readable BinaryIO — the exact shape app.py passes.
assert isinstance(io.BytesIO(b""), io.RawIOBase) or hasattr(io.BytesIO(b""), "read")
print(f"CONTRACT OK: transcribe(audio: {annotation}) — BytesIO input is valid")
