/** Constructs tiny deterministic PNG bytes for upload tests without checked generated output. */
import { crc32 } from '../../apps/shared/src/crc32';

function pngChunk(type: string, payload: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(payload.length + 12);
  result.writeUInt32BE(payload.length);
  typeBytes.copy(result, 4);
  payload.copy(result, 8);
  result.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, payload])),
    result.length - 4,
  );
  return result;
}

export function padPngToBytes(content: Buffer, targetBytes: number): Buffer {
  const paddingBytes = targetBytes - content.length;
  if (paddingBytes < 12) throw new Error('PNG padding needs a complete chunk');
  return Buffer.concat([
    content.subarray(0, -12),
    pngChunk('paDd', Buffer.alloc(paddingBytes - 12)),
    content.subarray(-12),
  ]);
}
