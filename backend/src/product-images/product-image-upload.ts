import multer from 'multer'
import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import { MAX_PRODUCT_IMAGE_BYTES } from './product-image-policy.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_PRODUCT_IMAGE_BYTES, fields: 0, parts: 1 },
}).single('image')

export const productImageUpload: RequestHandler = (request, response, next) => {
  upload(request, response, (error: unknown) => {
    if (!error) {
      if (!request.file) {
        next(new HttpError(422, 'PRODUCT_IMAGE_REQUIRED', 'One image is required'))
        return
      }
      next()
      return
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new HttpError(413, 'PRODUCT_IMAGE_TOO_LARGE', 'Image exceeds the 10 MiB limit'))
      return
    }
    next(new HttpError(422, 'PRODUCT_IMAGE_UPLOAD_INVALID', 'One image file is required'))
  })
}
