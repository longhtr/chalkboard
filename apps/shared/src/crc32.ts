/**
 * CRC-32 used by both stored ZIP entries and PNG chunks. The lookup table is
 * deterministic module state; callers may checksum a complete array or a
 * validated half-open range without allocating a slice.
 */
const TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 0 ? value >>> 1 : 0xedb8_8320 ^ (value >>> 1);
  }
  return value >>> 0;
});

/** Computes CRC-32 over the requested half-open byte range. */
export function crc32(
  bytes: Uint8Array,
  start = 0,
  end = bytes.length,
): number {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > bytes.length
  ) {
    throw new RangeError('CRC-32 byte range is invalid');
  }
  let value = 0xffff_ffff;
  for (const byte of bytes.subarray(start, end)) {
    value = (TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}
