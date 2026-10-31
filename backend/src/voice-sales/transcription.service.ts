import { HttpError } from '../errors/http-error.js'
import {
  MAX_TRANSCRIPT_LENGTH,
  type VoiceAudioInput,
  type VoiceTranscript,
  type VoiceTranscriptionDiagnostic,
  type VoiceTranscriptionDependencies,
} from './transcription.types.js'

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
const PROVIDER_RESPONSE_LIMIT = 256 * 1024

export interface ElevenLabsTranscriptionConfiguration {
  readonly apiKey: string | null
  readonly timeoutMs: number
  readonly onFailure?: (diagnostic: VoiceTranscriptionDiagnostic) => void
}

interface ProviderResponse {
  readonly text?: unknown
  readonly language_code?: unknown
  readonly language_probability?: unknown
}

interface ProviderErrorResponse {
  readonly code?: unknown
  readonly type?: unknown
  readonly status?: unknown
  readonly detail?: unknown
  readonly error?: unknown
}

const safeProviderCode = (value: unknown): string | null => (
  typeof value === 'string' && /^[a-z0-9_.-]{1,80}$/iu.test(value) ? value.toLowerCase() : null
)

function providerErrorCode(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown'
  const response = value as ProviderErrorResponse
  const detail = response.detail && typeof response.detail === 'object' && !Array.isArray(response.detail)
    ? response.detail as ProviderErrorResponse
    : null
  const nested = response.error && typeof response.error === 'object' && !Array.isArray(response.error)
    ? response.error as ProviderErrorResponse
    : null
  return [detail?.code, detail?.status, detail?.type, nested?.code, nested?.status, nested?.type,
    response.code, response.status, response.type].map(safeProviderCode).find(Boolean) ?? 'unknown'
}

function providerHttpFailure(upstreamStatus: number): HttpError {
  if (upstreamStatus === 400 || upstreamStatus === 415 || upstreamStatus === 422) {
    return new HttpError(422, 'VOICE_TRANSCRIPTION_AUDIO_REJECTED', 'The audio could not be processed. Record again and retry.')
  }
  if (upstreamStatus === 401) {
    return new HttpError(503, 'VOICE_TRANSCRIPTION_PROVIDER_AUTHENTICATION', 'Voice transcription is temporarily unavailable.')
  }
  if (upstreamStatus === 402) {
    return new HttpError(503, 'VOICE_TRANSCRIPTION_PROVIDER_CREDITS', 'Voice transcription is temporarily unavailable.')
  }
  if (upstreamStatus === 403) {
    return new HttpError(503, 'VOICE_TRANSCRIPTION_PROVIDER_PERMISSION', 'Voice transcription is temporarily unavailable.')
  }
  if (upstreamStatus === 429) {
    return new HttpError(429, 'VOICE_TRANSCRIPTION_RATE_LIMITED', 'Voice transcription is busy. Please try again shortly.')
  }
  if (upstreamStatus >= 500) {
    return new HttpError(502, 'VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE', 'Voice transcription is temporarily unavailable.')
  }
  return new HttpError(502, 'VOICE_TRANSCRIPTION_PROVIDER_FAILED', 'Audio could not be transcribed. Please try again.')
}

const timeoutFailure = () => new HttpError(504, 'VOICE_TRANSCRIPTION_TIMEOUT', 'Transcription timed out. Please try again.')
const connectivityFailure = () => new HttpError(502, 'VOICE_TRANSCRIPTION_PROVIDER_UNREACHABLE', 'Voice transcription is temporarily unavailable.')
const responseFailure = () => new HttpError(502, 'VOICE_TRANSCRIPTION_RESPONSE_INVALID', 'The transcription provider returned an invalid response.')
const noSpeechFailure = () => new HttpError(422, 'VOICE_TRANSCRIPTION_NO_SPEECH', 'No speech was detected. Record again and speak clearly.')

function parseProviderResponse(value: unknown): VoiceTranscript {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw responseFailure()
  const response = value as ProviderResponse
  if (typeof response.text !== 'string') throw responseFailure()
  const text = response.text.trim()
  if (!text) throw noSpeechFailure()
  if (text.length > MAX_TRANSCRIPT_LENGTH) throw responseFailure()

  const languageCode = response.language_code === null || response.language_code === undefined
    ? null
    : typeof response.language_code === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(response.language_code)
      ? response.language_code
      : null
  const languageProbability = response.language_probability === null || response.language_probability === undefined
    ? null
    : typeof response.language_probability === 'number' && Number.isFinite(response.language_probability)
      && response.language_probability >= 0 && response.language_probability <= 1
      ? response.language_probability
      : null

  return Object.freeze({ text, languageCode, languageProbability, model: 'scribe_v2' })
}

function deadlineSignal(timeoutMs: number, upstream?: AbortSignal) {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  upstream?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear() {
      clearTimeout(timer)
      upstream?.removeEventListener('abort', onAbort)
    },
  }
}

export function createVoiceTranscriptionDependencies(
  configuration: ElevenLabsTranscriptionConfiguration,
  fetchImpl: typeof fetch = globalThis.fetch,
): VoiceTranscriptionDependencies {
  const apiKey = configuration.apiKey
  const reportFailure = (input: VoiceAudioInput, diagnostic: Omit<VoiceTranscriptionDiagnostic, 'requestId' | 'mimeType' | 'byteCount'>) => {
    try {
      configuration.onFailure?.({
        ...diagnostic,
        requestId: input.requestId,
        mimeType: input.mimeType,
        byteCount: input.bytes.length,
      })
    } catch {
      // Diagnostics must never change the request result.
    }
  }
  if (!apiKey) {
    return Object.freeze({
      configured: false,
      async transcribe() {
        throw new HttpError(503, 'VOICE_TRANSCRIPTION_NOT_CONFIGURED', 'Voice transcription is not configured')
      },
    })
  }

  return Object.freeze({
    configured: true,
    async transcribe(input: VoiceAudioInput, upstreamSignal?: AbortSignal): Promise<VoiceTranscript> {
      const body = new FormData()
      body.set('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.fileName)
      body.set('model_id', 'scribe_v2')
      body.set('tag_audio_events', 'false')
      body.set('diarize', 'false')

      const deadline = deadlineSignal(configuration.timeoutMs, upstreamSignal)
      try {
        const response = await fetchImpl(ELEVENLABS_STT_URL, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body,
          signal: deadline.signal,
        })
        const raw = await response.text()
        if (!response.ok) {
          let providerCode = 'unknown'
          if (raw && raw.length <= PROVIDER_RESPONSE_LIMIT) {
            try { providerCode = providerErrorCode(JSON.parse(raw)) } catch { /* Unparseable bodies stay unknown. */ }
          }
          reportFailure(input, {
            stage: 'provider_response',
            upstreamStatus: response.status,
            providerCode,
          })
          throw providerHttpFailure(response.status)
        }
        if (!raw || raw.length > PROVIDER_RESPONSE_LIMIT) {
          reportFailure(input, { stage: 'provider_response', upstreamStatus: response.status, providerCode: 'invalid_response' })
          throw responseFailure()
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          reportFailure(input, { stage: 'provider_response', upstreamStatus: response.status, providerCode: 'invalid_json' })
          throw responseFailure()
        }
        try {
          return parseProviderResponse(parsed)
        } catch (error: unknown) {
          if (error instanceof HttpError) {
            reportFailure(input, {
              stage: 'provider_response',
              upstreamStatus: response.status,
              providerCode: error.code === 'VOICE_TRANSCRIPTION_NO_SPEECH' ? 'no_speech' : 'invalid_response',
            })
          }
          throw error
        }
      } catch (error: unknown) {
        if (error instanceof HttpError) throw error
        if (deadline.timedOut()) {
          reportFailure(input, { stage: 'provider_timeout', providerCode: 'timeout' })
          throw timeoutFailure()
        }
        if (upstreamSignal?.aborted) {
          throw new HttpError(499, 'VOICE_TRANSCRIPTION_CANCELLED', 'Transcription was cancelled')
        }
        reportFailure(input, { stage: 'provider_connectivity', providerCode: 'network_error' })
        throw connectivityFailure()
      } finally {
        deadline.clear()
      }
    },
  })
}
