import type { RequestHandler } from 'express'
import multer from 'multer'
import { HttpError } from '../errors/http-error.js'
import { MAX_VOICE_AUDIO_BYTES } from './transcription.types.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_VOICE_AUDIO_BYTES, fields: 1, parts: 2 },
}).single('audio')

export const voiceAudioUpload: RequestHandler = (request, response, next) => {
  upload(request, response, (error: unknown) => {
    if (!error) {
      if (!request.file) {
        next(new HttpError(422, 'VOICE_AUDIO_REQUIRED', 'One audio file is required'))
        return
      }
      next()
      return
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new HttpError(413, 'VOICE_AUDIO_TOO_LARGE', 'Audio exceeds the 5 MiB limit'))
      return
    }

    next(new HttpError(422, 'VOICE_AUDIO_UPLOAD_INVALID', 'One audio file and its duration are required'))
  })
}
