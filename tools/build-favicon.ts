import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FAVICON_SOURCE = path.join(ROOT, 'frontend', 'assets', 'sharti-favicon.svg');
export const FAVICON_ICO = path.join(ROOT, 'frontend', 'assets', 'favicon.ico');

const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const;
const RASTER_SIZE = 512;

interface IcoImage {
  size: number;
  data: Buffer;
}

function packIco(images: IcoImage[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

/**
 * Renders frontend/assets/sharti-favicon.svg into a multi-size favicon.ico.
 * The write is skipped when the result is byte-identical, so watchers can call
 * this on every change without causing pointless rebuilds.
 */
export async function buildFavicon(
  source = FAVICON_SOURCE,
  target = FAVICON_ICO,
): Promise<{ changed: boolean; bytes: number }> {
  const svg = fs.readFileSync(source);
  const raster = await sharp(svg).resize(RASTER_SIZE, RASTER_SIZE).png().toBuffer();

  const images = await Promise.all(
    ICO_SIZES.map(async (size) => ({
      size,
      data: await sharp(raster).resize(size, size, { fit: 'contain' }).png().toBuffer(),
    })),
  );

  const ico = packIco(images);
  const previous = fs.existsSync(target) ? fs.readFileSync(target) : null;

  if (previous?.equals(ico)) {
    return { changed: false, bytes: ico.length };
  }

  fs.writeFileSync(target, ico);
  return { changed: true, bytes: ico.length };
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  buildFavicon()
    .then(({ changed, bytes }) => {
      console.log(`[favicon] ${changed ? 'generated' : 'up to date'} (${bytes} bytes)`);
    })
    .catch((error: unknown) => {
      console.error('[favicon] generation failed', error);
      process.exitCode = 1;
    });
}
