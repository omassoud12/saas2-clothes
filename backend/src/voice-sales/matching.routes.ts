import { Router } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { UserRole } from '../generated/prisma/enums.js'
import { requireVoiceSaleTenant } from './authenticated-tenant.js'
import type { VoiceMatchingDependencies } from './match.types.js'
import { voiceAudioUpload } from './transcription-upload.js'
import {
  MAX_VOICE_AUDIO_DURATION_MS,
  MIN_VOICE_AUDIO_DURATION_MS,
  type VoiceTranscriptionDependencies,
} from './transcription.types.js'

const supportedAudioTypes = new Set([
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav',
])

function isSupportedAudio(bytes: Buffer, mimeType: string): boolean {
  if (!supportedAudioTypes.has(mimeType)) return false
  if (mimeType === 'audio/webm') return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  if (mimeType === 'audio/ogg') return bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS'
  if (mimeType === 'audio/mp4') return bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp'
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
  }
  return bytes.length >= 3 && (bytes.subarray(0, 3).toString('ascii') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
}

function parseDuration(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new HttpError(422, 'VOICE_AUDIO_DURATION_INVALID', 'Audio duration is required')
  }
  const durationMs = Number(value)
  if (!Number.isSafeInteger(durationMs) || durationMs < MIN_VOICE_AUDIO_DURATION_MS || durationMs > MAX_VOICE_AUDIO_DURATION_MS) {
    throw new HttpError(422, 'VOICE_AUDIO_DURATION_INVALID', 'Audio must be between 0.1 and 30 seconds')
  }
  return durationMs
}

export function createVoiceMatchingRouter(
  auth: AuthDependencies,
  matching?: VoiceMatchingDependencies,
  transcription?: VoiceTranscriptionDependencies,
): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER, UserRole.WAREHOUSE))
  if (matching) router.post('/match', async (request, response, next) => {
    try {
      requireVoiceSaleTenant(request.auth)
      const body: unknown = request.body
      if (Object.keys(request.query).length || !body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'text')
        || typeof (body as { text?: unknown }).text !== 'string') {
        throw new HttpError(422, 'INVALID_VOICE_MATCH_INPUT', 'Only a text string may be supplied')
      }
      const result = await matching.matchVoiceSaleText((body as { text: string }).text, request.auth!)
      response.status(result.status === 'INVALID_INPUT' ? 422 : 200).json(result)
    } catch (error) { next(error) }
  })
  if (transcription) router.post('/transcribe', voiceAudioUpload, async (request, response, next) => {
    try {
      requireVoiceSaleTenant(request.auth)
      if (Object.keys(request.query).length || !request.file || !request.body || typeof request.body !== 'object'
        || Array.isArray(request.body) || Object.keys(request.body).length !== 1 || !Object.hasOwn(request.body, 'durationMs')) {
        throw new HttpError(422, 'INVALID_VOICE_TRANSCRIPTION_INPUT', 'Only audio and duration may be supplied')
      }
      const mimeType = request.file.mimetype.split(';', 1)[0].toLowerCase()
      if (!request.file.buffer.length) throw new HttpError(422, 'VOICE_AUDIO_EMPTY', 'Audio file is empty')
      if (!isSupportedAudio(request.file.buffer, mimeType)) {
        throw new HttpError(415, 'VOICE_AUDIO_UNSUPPORTED', 'Audio format is unsupported or malformed')
      }
      const durationMs = parseDuration((request.body as { durationMs?: unknown }).durationMs)
      const controller = new AbortController()
      request.once('aborted', () => controller.abort())
      const transcript = await transcription.transcribe({
        bytes: request.file.buffer,
        durationMs,
        fileName: `recording.${mimeType === 'audio/webm' ? 'webm' : mimeType === 'audio/ogg' ? 'ogg' : mimeType === 'audio/mp4' ? 'm4a' : mimeType.includes('wav') ? 'wav' : 'mp3'}`,
        mimeType,
        requestId: request.requestId,
      }, controller.signal)
      response.json({ transcript })
    } catch (error) { next(error) }
  })
  return router
}
