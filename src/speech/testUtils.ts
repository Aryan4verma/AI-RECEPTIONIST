/** Shared fixture helpers for speech tests. */
export function wavBytes(seconds = 1, byteRate = 16000 * 2): Uint8Array {
  const dataBytes = Math.floor(seconds * byteRate);
  const buf = Buffer.alloc(44 + Math.min(dataBytes, 4));
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(byteRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(4, 40);
  return new Uint8Array(buf);
}
