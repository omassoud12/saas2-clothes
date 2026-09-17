import { processProductImage } from './product-image-policy.js'
import { productImageKey } from './product-image-key.js'
import type { ProductImageStore } from './r2-product-image-store.js'

export async function uploadProductImage(
  store: ProductImageStore,
  accountId: string,
  productId: string,
  buffer: Buffer,
): Promise<string> {
  const imageKey = productImageKey(accountId, productId)
  const webp = await processProductImage(buffer)
  await store.upload(accountId, productId, imageKey, webp)
  return imageKey
}
