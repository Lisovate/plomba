/**
 * Image normalisation and redaction. Every photo is decoded, turned upright,
 * resized and re-encoded before it goes anywhere, which also strips EXIF
 * metadata (including GPS position) from what is stored.
 */

import sharp, { type OverlayOptions } from 'sharp';
import { ValidationError } from '../errors.ts';
import type { ImageInput, PixelBox } from '../ports.ts';

export interface NormalisedImage extends ImageInput {
  readonly mimeType: 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

/** Large enough to read a container number and see a dent, small enough to send quickly. */
export const DEFAULT_MAX_SIDE = 2048;

export async function normaliseImage(
  input: Uint8Array,
  maxSide = DEFAULT_MAX_SIDE,
  options: {
    /** Enlarge images whose longer side is shorter than this (e.g. tight crops of markings). */
    readonly minLongSide?: number;
  } = {},
): Promise<NormalisedImage> {
  try {
    const decoded = sharp(input, { limitInputPixels: 64_000_000 }).rotate();
    const { width = 0, height = 0, orientation = 1 } = await decoded.metadata();
    const longSide = Math.max(width, height);
    const target =
      options.minLongSide && longSide > 0 && longSide < options.minLongSide
        ? options.minLongSide
        : Math.min(maxSide, longSide || maxSide);
    // EXIF orientations 5–8 swap width and height once the image is turned upright.
    const landscape = orientation >= 5 ? height >= width : width >= height;
    const { data, info } = await decoded
      .resize(landscape ? { width: target } : { height: target })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(data),
      mimeType: 'image/jpeg',
      width: info.width,
      height: info.height,
    };
  } catch (cause) {
    throw new ValidationError('The upload is not a readable image', { cause });
  }
}

/** Blurs each box (with a margin) beyond recognition. */
export async function blurRegions(
  image: NormalisedImage,
  boxes: readonly PixelBox[],
): Promise<NormalisedImage> {
  if (boxes.length === 0) return image;
  const overlays: OverlayOptions[] = [];
  for (const box of boxes) {
    const margin = 0.15 * Math.max(box.right - box.left, box.bottom - box.top);
    const left = Math.max(0, Math.floor(box.left - margin));
    const top = Math.max(0, Math.floor(box.top - margin));
    const right = Math.min(image.width, Math.ceil(box.right + margin));
    const bottom = Math.min(image.height, Math.ceil(box.bottom + margin));
    const width = right - left;
    const height = bottom - top;
    if (width < 2 || height < 2) continue;
    const sigma = Math.max(8, Math.max(width, height) / 8);
    const patch = await sharp(image.data)
      .extract({ left, top, width, height })
      .blur(sigma)
      .toBuffer();
    overlays.push({ input: patch, left, top });
  }
  const data = await sharp(image.data).composite(overlays).jpeg({ quality: 85 }).toBuffer();
  return { ...image, data: new Uint8Array(data) };
}
