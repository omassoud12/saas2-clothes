import sharp from 'sharp'
import { HttpError } from '../errors/http-error.js'

export const MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_PRODUCT_IMAGE_PIXELS = 40_000_000
export const MAX_PRODUCT_IMAGE_DIMENSION = 1600

const acceptedFormats = new Set(['jpeg', 'png', 'webp'])

export async function processProductImage(buffer: Buffer): Promise<Buffer> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new HttpError(422, 'PRODUCT_IMAGE_INVALID', 'A valid image is required')
  }
  if (buffer.length > MAX_PRODUCT_IMAGE_BYTES) {
    throw new HttpError(413, 'PRODUCT_IMAGE_TOO_LARGE', 'Image exceeds the 10 MiB limit')
  }

  let metadata: { format?: string; pages?: number; pageHeight?: number; width?: number; height?: number }
  try {
    // Metadata inspection does not decode pixels. The processing pass below
    // separately enforces Sharp's decoder-level pixel limit.
    metadata = await sharp(buffer, { limitInputPixels: false, failOn: 'error' }).metadata()
  } catch {
    throw new HttpError(422, 'PRODUCT_IMAGE_INVALID', 'Image is invalid or corrupt')
  }

  if (!metadata.format || !acceptedFormats.has(metadata.format)) {
    throw new HttpError(415, 'PRODUCT_IMAGE_UNSUPPORTED', 'Image format is unsupported')
  }
  if ((metadata.pages ?? 1) > 1 ||
      (metadata.pageHeight !== undefined && metadata.height !== undefined &&
        metadata.pageHeight < metadata.height)) {
    throw new HttpError(415, 'PRODUCT_IMAGE_ANIMATED', 'Animated images are unsupported')
  }
  if (!metadata.width || !metadata.height) {
    throw new HttpError(422, 'PRODUCT_IMAGE_INVALID', 'Image dimensions are invalid')
  }
  if (metadata.width * metadata.height > MAX_PRODUCT_IMAGE_PIXELS) {
    throw new HttpError(413, 'PRODUCT_IMAGE_DIMENSIONS_TOO_LARGE', 'Image dimensions are too large')
  }

  try {
    return await sharp(buffer, {
      limitInputPixels: MAX_PRODUCT_IMAGE_PIXELS,
      failOn: 'error',
      animated: false,
    })
      .rotate()
      .resize(MAX_PRODUCT_IMAGE_DIMENSION, MAX_PRODUCT_IMAGE_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer()
  } catch {
    throw new HttpError(422, 'PRODUCT_IMAGE_INVALID', 'Image is invalid or corrupt')
  }
}
