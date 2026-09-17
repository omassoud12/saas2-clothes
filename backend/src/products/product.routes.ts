import { Router } from 'express'
import { createRequireAuth, createRequireTenant } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { productImageUpload } from '../product-images/product-image-upload.js'
import {
  createProduct,
  createVariant,
  deleteImage,
  getProduct,
  listProducts,
  productOwnership,
  updateProduct,
  updateVariant,
  uploadImage,
} from './product.controller.js'
import type { ProductDependencies } from './product.types.js'

export function createProductRouter(auth: AuthDependencies, products: ProductDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth))

  router.get('/', listProducts(products))
  router.post('/', createProduct(products))
  router.get('/:productId', getProduct(products))
  router.patch('/:productId', updateProduct(products))
  router.post('/:productId/variants', createVariant(products))
  router.patch('/:productId/variants/:variantId', updateVariant(products))
  router.post('/:productId/image', productOwnership(products), productImageUpload, uploadImage(products))
  router.delete('/:productId/image', deleteImage(products))

  return router
}
