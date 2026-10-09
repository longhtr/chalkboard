/**
 * Reads dimensions directly from supported raster containers without decoding
 * pixels. Every parser bounds segment/box traversal and rejects truncated or
 * contradictory structures before image bytes reach durable storage.
 */
import { crc32 } from '@chalkboard/shared';

const MAX_CONTAINER_SEGMENTS = 4_096;

function pngDimensions(
  content: Buffer,
): { height: number; width: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    content.length < 45 ||
    !content.subarray(0, signature.length).equals(signature)
  ) {
    return null;
  }
  let dimensions: { height: number; width: number } | null = null;
  let foundImageData = false;
  let offset = signature.length;
  let segments = 0;
  while (offset < content.length) {
    segments += 1;
    if (segments > MAX_CONTAINER_SEGMENTS || offset + 12 > content.length) {
      return null;
    }
    const length = content.readUInt32BE(offset);
    const type = content.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (
      end > content.length ||
      crc32(content, offset + 4, offset + 8 + length) !==
        content.readUInt32BE(offset + 8 + length)
    ) {
      return null;
    }
    if (dimensions === null) {
      if (type !== 'IHDR' || length !== 13) return null;
      dimensions = {
        height: content.readUInt32BE(offset + 12),
        width: content.readUInt32BE(offset + 8),
      };
    } else if (type === 'IHDR') {
      return null;
    }
    if (type === 'IDAT' && length > 0) foundImageData = true;
    if (type === 'IEND') {
      return length === 0 && end === content.length && foundImageData
        ? dimensions
        : null;
    }
    offset = end;
  }
  return null;
}

function gifDimensions(
  content: Buffer,
): { height: number; width: number } | null {
  const signature = content.toString('ascii', 0, 6);
  if (
    content.length < 14 ||
    (signature !== 'GIF87a' && signature !== 'GIF89a')
  ) {
    return null;
  }
  let width = content.readUInt16LE(6);
  let height = content.readUInt16LE(8);
  const screenDescriptor = content.readUInt8(10);
  const globalColorTableBytes =
    (screenDescriptor & 0x80) === 0
      ? 0
      : 3 * 2 ** ((screenDescriptor & 0x07) + 1);
  let offset = 13 + globalColorTableBytes;
  let foundImage = false;
  let segments = 0;
  const skipSubBlocks = (): boolean => {
    while (offset < content.length) {
      segments += 1;
      if (segments > MAX_CONTAINER_SEGMENTS) return false;
      const length = content.readUInt8(offset);
      offset += 1;
      if (length === 0) return true;
      if (offset + length > content.length) return false;
      offset += length;
    }
    return false;
  };
  while (offset < content.length) {
    segments += 1;
    if (segments > MAX_CONTAINER_SEGMENTS) return null;
    const marker = content.readUInt8(offset);
    offset += 1;
    if (marker === 0x3b) {
      return foundImage && offset === content.length ? { height, width } : null;
    }
    if (marker === 0x21) {
      if (offset >= content.length) return null;
      offset += 1;
      if (!skipSubBlocks()) return null;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > content.length) return null;
    const left = content.readUInt16LE(offset);
    const top = content.readUInt16LE(offset + 2);
    const imageWidth = content.readUInt16LE(offset + 4);
    const imageHeight = content.readUInt16LE(offset + 6);
    const packed = content.readUInt8(offset + 8);
    if (imageWidth === 0 || imageHeight === 0) return null;
    width = Math.max(width, left + imageWidth);
    height = Math.max(height, top + imageHeight);
    offset += 9;
    if ((packed & 0x80) !== 0) {
      offset += 3 * 2 ** ((packed & 0x07) + 1);
    }
    if (offset >= content.length) return null;
    const minimumCodeSize = content.readUInt8(offset);
    if (minimumCodeSize < 2 || minimumCodeSize > 8) return null;
    offset += 1;
    if (!skipSubBlocks()) return null;
    foundImage = true;
  }
  return null;
}

const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(
  content: Buffer,
): { height: number; width: number } | null {
  if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) {
    return null;
  }
  let dimensions: { height: number; width: number } | null = null;
  let foundScan = false;
  let offset = 2;
  let segments = 0;
  while (offset < content.length) {
    if (content[offset] !== 0xff) {
      if (!foundScan) return null;
      offset += 1;
      continue;
    }
    segments += 1;
    if (segments > MAX_CONTAINER_SEGMENTS) return null;
    while (content[offset] === 0xff) offset += 1;
    const marker = content[offset];
    offset += 1;
    if (marker === undefined) return null;
    if (marker === 0xd9) {
      return foundScan && dimensions !== null && offset === content.length
        ? dimensions
        : null;
    }
    if (marker === 0x00) {
      if (!foundScan) return null;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= content.length) return null;
    const length = content.readUInt16BE(offset);
    if (length < 2 || offset + length > content.length) return null;
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (dimensions !== null || length < 7) return null;
      dimensions = {
        height: content.readUInt16BE(offset + 3),
        width: content.readUInt16BE(offset + 5),
      };
    }
    if (marker === 0xda) foundScan = true;
    offset += length;
  }
  return null;
}

function readUInt24LE(content: Buffer, offset: number): number {
  return (
    (content[offset] ?? 0) |
    ((content[offset + 1] ?? 0) << 8) |
    ((content[offset + 2] ?? 0) << 16)
  );
}

function webpDimensions(
  content: Buffer,
): { height: number; width: number } | null {
  if (
    content.length < 20 ||
    content.toString('ascii', 0, 4) !== 'RIFF' ||
    content.readUInt32LE(4) + 8 !== content.length ||
    content.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  let dimensions: { height: number; width: number } | null = null;
  let extended = false;
  let offset = 12;
  let segments = 0;
  while (offset < content.length) {
    segments += 1;
    if (segments > MAX_CONTAINER_SEGMENTS || offset + 8 > content.length) {
      return null;
    }
    const kind = content.toString('ascii', offset, offset + 4);
    const length = content.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const end = payload + length;
    const paddedEnd = end + (length % 2);
    if (end > content.length || paddedEnd > content.length) return null;
    let candidate: { height: number; width: number } | null = null;
    if (kind === 'VP8X' && length >= 10) {
      candidate = {
        height: readUInt24LE(content, payload + 7) + 1,
        width: readUInt24LE(content, payload + 4) + 1,
      };
    } else if (kind === 'VP8L' && length >= 5 && content[payload] === 0x2f) {
      const bits = content.readUInt32LE(payload + 1);
      candidate = {
        height: ((bits >>> 14) & 0x3fff) + 1,
        width: (bits & 0x3fff) + 1,
      };
    } else if (
      kind === 'VP8 ' &&
      length >= 10 &&
      content[payload + 3] === 0x9d &&
      content[payload + 4] === 0x01 &&
      content[payload + 5] === 0x2a
    ) {
      candidate = {
        height: content.readUInt16LE(payload + 8) & 0x3fff,
        width: content.readUInt16LE(payload + 6) & 0x3fff,
      };
    }
    if (candidate !== null) {
      if (kind === 'VP8X') {
        if (dimensions !== null) return null;
        extended = true;
        dimensions = candidate;
      } else if (!extended) {
        if (dimensions !== null) return null;
        dimensions = candidate;
      }
    }
    offset = paddedEnd;
  }
  return offset === content.length ? dimensions : null;
}

interface BmffBox {
  end: number;
  payload: number;
  type: string;
}

function bmffBoxes(
  content: Buffer,
  start: number,
  end: number,
  budget: { segments: number },
): BmffBox[] | null {
  const boxes: BmffBox[] = [];
  let offset = start;
  while (offset < end) {
    budget.segments += 1;
    if (budget.segments > MAX_CONTAINER_SEGMENTS || offset + 8 > end) {
      return null;
    }
    const size32 = content.readUInt32BE(offset);
    const type = content.toString('ascii', offset + 4, offset + 8);
    let header = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) return null;
      const size64 = content.readBigUInt64BE(offset + 8);
      if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      header = 16;
      size = Number(size64);
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return null;
    boxes.push({ end: offset + size, payload: offset + header, type });
    offset += size;
  }
  return boxes;
}

function childBoxes(
  content: Buffer,
  box: BmffBox,
  budget: { segments: number },
  headerKind: 'basic' | 'full' = 'basic',
): BmffBox[] | null {
  const start = box.payload + (headerKind === 'full' ? 4 : 0);
  return start <= box.end ? bmffBoxes(content, start, box.end, budget) : null;
}

function avifDimensions(
  content: Buffer,
): { height: number; width: number } | null {
  const budget = { segments: 0 };
  const topLevel = bmffBoxes(content, 0, content.length, budget);
  if (topLevel === null) return null;
  const fileType = topLevel.find(({ type }) => type === 'ftyp');
  if (fileType === undefined || fileType.payload + 8 > fileType.end)
    return null;
  const brands: string[] = [
    content.toString('ascii', fileType.payload, fileType.payload + 4),
  ];
  for (
    let offset = fileType.payload + 8;
    offset + 4 <= fileType.end;
    offset += 4
  ) {
    brands.push(content.toString('ascii', offset, offset + 4));
  }
  if (!brands.some((brand) => brand === 'avif' || brand === 'avis')) {
    return null;
  }
  if (!topLevel.some((box) => box.type === 'mdat' && box.payload < box.end)) {
    return null;
  }

  const dimensions: Array<{ height: number; width: number }> = [];
  for (const metadata of topLevel.filter(({ type }) => type === 'meta')) {
    for (const itemProperties of childBoxes(
      content,
      metadata,
      budget,
      'full',
    ) ?? []) {
      if (itemProperties.type !== 'iprp') continue;
      for (const propertyContainer of childBoxes(
        content,
        itemProperties,
        budget,
      ) ?? []) {
        if (propertyContainer.type !== 'ipco') continue;
        for (const property of childBoxes(content, propertyContainer, budget) ??
          []) {
          if (
            property.type !== 'ispe' ||
            property.payload + 12 !== property.end ||
            content.readUInt32BE(property.payload) !== 0
          )
            continue;
          const width = content.readUInt32BE(property.payload + 4);
          const height = content.readUInt32BE(property.payload + 8);
          if (width > 0 && height > 0) dimensions.push({ height, width });
        }
      }
    }
  }
  if (dimensions.length === 0) return null;
  return {
    height: Math.max(...dimensions.map(({ height }) => height)),
    width: Math.max(...dimensions.map(({ width }) => width)),
  };
}

type RasterMediaType =
  'image/avif' | 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp';

/** Validates the declared raster container and returns its largest frame dimensions. */
export function rasterDimensions(
  content: Buffer,
  mediaType: RasterMediaType,
): { height: number; width: number } | null {
  switch (mediaType) {
    case 'image/png':
      return pngDimensions(content);
    case 'image/gif':
      return gifDimensions(content);
    case 'image/jpeg':
      return jpegDimensions(content);
    case 'image/webp':
      return webpDimensions(content);
    case 'image/avif':
      return avifDimensions(content);
  }
}
