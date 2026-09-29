import { buildProductPayload, buildVariantPayload, findVariantDuplicate, validateImage } from './product-flow.js'
import { validateRestockDraft } from '../inventory/restock-flow.js'

export function validateProductSetup(draft, role) {
  const product = buildProductPayload(draft, role)
  if (!product.ok) return product
  if (!draft.options?.length) return { ok: false, message: 'Add at least one color / size.' }
  for (const [index, option] of draft.options.entries()) {
    const variant = buildVariantPayload(option, role)
    const duplicate = findVariantDuplicate(option, draft.options.slice(0, index))
    const quantity = String(option.quantity ?? '').trim()
    const stock = role === 'OWNER' && quantity !== '' && quantity !== '0'
      ? validateRestockDraft(option) : { ok: true }
    const failure = [variant, duplicate, stock].find((result) => !result.ok)
    if (failure) return { ...failure, message: `Option ${index + 1}: ${failure.message}` }
  }
  return { ok: true }
}

// Retain confirmed steps and frozen stock requests for retries in this form.
// Catalog creation has no idempotency contract: uncertain creates require review.
export function createProductSetupWorkflow({ role, createProduct, createVariant, createSetup, restock, uploadImage, createKey = () => crypto.randomUUID() }) {
  let attempt = null
  let pending = false
  let review = false
  return {
    get started() { return attempt !== null },
    get productId() { return attempt?.product?.id ?? null },
    async submit(draft, image = null) {
      if (pending) return { skipped: true }
      if (review) return { ok: false, review: true, message: 'Check the catalog before creating anything again. The last save could not be confirmed.' }
      if (!attempt) {
        const valid = validateProductSetup(draft, role)
        if (!valid.ok) return valid
        if (image) {
          const validImage = validateImage(image)
          if (!validImage.ok) return validImage
        }
        attempt = { image, imageSaved: false, draft: structuredClone(draft), product: null, options: draft.options.map(() => ({ variant: null, stocked: false, key: createKey() })) }
      }
      pending = true
      let stage = 'product'
      try {
        if (!attempt.product) {
          const result = await (createSetup ? createSetup(attempt.draft) : createProduct(attempt.draft))
          if (!result.ok) {
            review = Boolean(result.uncertain)
            if (!review) attempt = null
            return { ...result, review }
          }
          attempt.product = result.product
        }
        for (const [index, option] of (createSetup ? [] : attempt.draft.options).entries()) {
          const progress = attempt.options[index]
          stage = 'variant'
          if (!progress.variant) {
            const result = await createVariant(attempt.product.id, option)
            if (!result.ok) {
              review = Boolean(result.uncertain)
              return { ...result, review, message: `Product saved. Option ${index + 1}: ${result.message}` }
            }
            progress.variant = result.variant
          }
          stage = 'stock'
          if (role === 'OWNER' && Number(option.quantity) > 0 && !progress.stocked) {
            const payload = validateRestockDraft(option).payload
            const result = await restock(attempt.product.id, progress.variant.id, payload, progress.key)
            if (!result.ok) return { ...result, message: `Product and option ${index + 1} saved. Stock: ${result.message}` }
            progress.stocked = true
          }
        }
        stage = 'image'
        if (attempt.image && !attempt.imageSaved) {
          const result = await uploadImage(attempt.product.id, attempt.image)
          if (!result.ok) return { ...result, message: `Product saved. Photo: ${result.message}` }
          attempt.imageSaved = true
        }
        return { ok: true, productId: attempt.product.id }
      } catch {
        review = stage !== 'stock' && stage !== 'image'
        return { ok: false, review, uncertain: true, message: review ? 'Save could not be confirmed. Check the catalog before creating this product again.' : stage === 'image' ? 'Product saved, but the photo upload could not be confirmed. Retry to upload the same photo.' : 'Stock could not be confirmed. Retry to safely finish this save.' }
      } finally { pending = false }
    },
  }
}
