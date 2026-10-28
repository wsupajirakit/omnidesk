/**
 * [FEAT-20261026-RAGENGINE] Vector helpers — normalise once, then similarity is a dot product.
 * Stored as raw little-endian float32 bytes (Buffer, BSON subtype 0): Mongo 7.0 is not
 * documented to accept the newer vector subtype 9, so the plain one is the safe choice.
 */
export function l2Normalise(values: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(values);
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i]! * out[i]!;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm;
  return out;
}

/** Cosine of two L2-normalised vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

export function vectorToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function bufferToVector(buf: Uint8Array): Float32Array {
  const copy = new Uint8Array(buf); // aligned copy — a Mongo Binary may not start on a 4-byte boundary
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}
