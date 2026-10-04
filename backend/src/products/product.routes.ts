import { Router } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
import { productImageUpload } from '../product-images/product-image-upload.js'
import { createRestock } from '../restocks/restock.controller.js'
import {
  applyVariantPrice,
  quickAddStock,
  setOpeningCost,
  createProductSetup,
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
  router.use((_request, response, next) => { response.locals.productRequestStarted = performance.now(); next() }, createRequireAuth(auth), createRequireTenant(auth), (_request, response, next) => {
    response.locals.productAuthMs = performance.now() - response.locals.productRequestStarted
    next()
  })

  router.get('/', listProducts(products))
  router.post('/', createProduct(products))
  router.post('/:productId/variant-prices', requireRole(UserRole.OWNER), applyVariantPrice(products))
  router.post('/setup', createProductSetup(products))
  router.get('/:productId', getProduct(products))
  router.patch('/:productId', updateProduct(products))
  router.post('/:productId/variants', createVariant(products))
  router.patch('/:productId/variants/:variantId', updateVariant(products))
  router.post('/:productId/variants/:variantId/quick-stock', requireRole(UserRole.OWNER), quickAddStock(products))
  router.post('/:productId/variants/:variantId/stock-adjustment', requireRole(UserRole.OWNER), quickAddStock(products, true))
  router.put('/:productId/variants/:variantId/opening-cost', requireRole(UserRole.OWNER), setOpeningCost(products))
  router.post('/:productId/variants/:variantId/restocks', requireRole(UserRole.OWNER), createRestock(products))
  router.post('/:productId/image', productOwnership(products), productImageUpload, uploadImage(products))
  router.delete('/:productId/image', deleteImage(products))

  return router
}
