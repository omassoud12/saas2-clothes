import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import { isExpensiveRead } from '../app.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { errorHandler } from '../middleware/error-handler.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { createVoiceMatchingRouter } from './matching.routes.js'
import { createVoiceTranscriptionDependencies } from './transcription.service.js'
import {
  MAX_VOICE_AUDIO_BYTES,
  type VoiceTranscriptionDependencies,
  type VoiceTranscriptionDiagnostic,
} from './transcription.types.js'

const userId = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'

function auth(role: UserRole = UserRole.OWNER, active = true): AuthDependencies {
  return {
    async verifyAccessToken(token) { return token === 'test' ? { id: userId, email: 'test@example.invalid', emailConfirmedAt: '2026-01-01', isAnonymous: false } : null },
    async findApplicationUser() { return { id: userId, role, accountId: role === UserRole.SUPER_ADMIN ? null : accountId, isActive: active } },
    async findAccountById() { return { id: accountId, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw new Error('unused') },
  }
}

async function withApi<T>(service: VoiceTranscriptionDependencies, role: UserRole, operation: (url: string) => Promise<T>, active = true) {
  const app = express()
  app.use((request, response, next) => {
    request.requestId = 'transcription-test-request'
    response.setHeader('X-Request-Id', request.requestId)
    next()
  })
  app.use('/api/voice-sales', createVoiceMatchingRouter(auth(role, active), undefined, service))
  app.use(errorHandler)
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  try { return await operation(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/voice-sales/transcribe`) }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}

function audioForm(bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]), type = 'audio/webm', duration = '1200') {
  const body = new FormData()
  body.set('audio', new Blob([new Uint8Array(bytes)], { type }), 'recording.webm')
  body.set('durationMs', duration)
  return body
}

const post = (url: string, body: FormData, token = 'test') => fetch(url, {
  method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body,
})

describe('ElevenLabs transcription adapter', () => {
  test('uses the Scribe v2 multipart contract and returns only safe fields', async () => {
    let captured: RequestInit | undefined
    const service = createVoiceTranscriptionDependencies({ apiKey: 'server-secret', timeoutMs: 1_000 }, async (url, init) => {
      assert.equal(url, 'https://api.elevenlabs.io/v1/speech-to-text')
      captured = init
      return new Response(JSON.stringify({ text: 'بدي تي شيرت سودا XL قطعتين', language_code: 'ar', language_probability: 0.98,
        words: [{ text: 'PRIVATE_PROVIDER_DETAIL' }], request_id: 'PRIVATE' }), { status: 200 })
    })
    const result = await service.transcribe({ bytes: Buffer.from('OggSdata'), durationMs: 1_200, fileName: 'recording.ogg', mimeType: 'audio/ogg' })
    assert.deepEqual(result, { text: 'بدي تي شيرت سودا XL قطعتين', languageCode: 'ar', languageProbability: 0.98, model: 'scribe_v2' })
    assert.equal(captured?.method, 'POST')
    assert.equal((captured?.headers as Record<string, string>)['xi-api-key'], 'server-secret')
    assert.ok(captured?.body instanceof FormData)
    assert.equal(captured.body.get('model_id'), 'scribe_v2')
    assert.equal(captured.body.get('tag_audio_events'), 'false')
    assert.equal(captured.body.get('diarize'), 'false')
    assert.ok(captured.body.get('file') instanceof Blob)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/u)
  })

  test('classifies provider failures and reports only sanitized diagnostics', async () => {
    const input = { bytes: Buffer.from('x'), durationMs: 100, fileName: 'x.webm', mimeType: 'audio/webm', requestId: 'request-1' }
    const missing = createVoiceTranscriptionDependencies({ apiKey: null, timeoutMs: 1_000 })
    await assert.rejects(missing.transcribe(input), (error: unknown) => (error as { code?: string }).code === 'VOICE_TRANSCRIPTION_NOT_CONFIGURED')

    const cases = [
      [400, 'validation_error', 422, 'VOICE_TRANSCRIPTION_AUDIO_REJECTED'],
      [422, 'invalid_audio', 422, 'VOICE_TRANSCRIPTION_AUDIO_REJECTED'],
      [401, 'authentication_error', 503, 'VOICE_TRANSCRIPTION_PROVIDER_AUTHENTICATION'],
      [402, 'insufficient_credits', 503, 'VOICE_TRANSCRIPTION_PROVIDER_CREDITS'],
      [403, 'insufficient_permissions', 503, 'VOICE_TRANSCRIPTION_PROVIDER_PERMISSION'],
      [429, 'rate_limit_exceeded', 429, 'VOICE_TRANSCRIPTION_RATE_LIMITED'],
      [500, 'internal_error', 502, 'VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE'],
      [503, 'service_unavailable', 502, 'VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE'],
    ] as const
    for (const [upstreamStatus, providerCode, expectedStatus, expectedCode] of cases) {
      const diagnostics: VoiceTranscriptionDiagnostic[] = []
      const service = createVoiceTranscriptionDependencies({
        apiKey: 'secret', timeoutMs: 1_000, onFailure: value => diagnostics.push(value),
      }, async () => new Response(JSON.stringify({ detail: { code: providerCode, message: 'PRIVATE_PROVIDER_MESSAGE' } }), { status: upstreamStatus }))
      await assert.rejects(service.transcribe(input), (error: unknown) => {
        const failure = error as { status?: number, code?: string, message?: string }
        return failure.status === expectedStatus && failure.code === expectedCode && !failure.message?.includes('PRIVATE')
      })
      assert.deepEqual(diagnostics, [{ requestId: 'request-1', stage: 'provider_response', upstreamStatus,
        providerCode, mimeType: 'audio/webm', byteCount: 1 }])
      assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|secret/u)
    }
  })

  test('maps valid no-speech and malformed success responses without reporting private fields', async () => {
    const input = { bytes: Buffer.from('x'), durationMs: 100, fileName: 'x.webm', mimeType: 'audio/webm' }
    const cases = [
      [JSON.stringify({ text: '', words: [{ text: 'PRIVATE' }] }), 'VOICE_TRANSCRIPTION_NO_SPEECH', 422, 'no_speech'],
      ['{bad', 'VOICE_TRANSCRIPTION_RESPONSE_INVALID', 502, 'invalid_json'],
      [JSON.stringify({ words: [{ text: 'PRIVATE' }] }), 'VOICE_TRANSCRIPTION_RESPONSE_INVALID', 502, 'invalid_response'],
    ] as const
    for (const [body, expectedCode, expectedStatus, diagnosticCode] of cases) {
      const diagnostics: VoiceTranscriptionDiagnostic[] = []
      const service = createVoiceTranscriptionDependencies({ apiKey: 'secret', timeoutMs: 1_000,
        onFailure: value => diagnostics.push(value) }, async () => new Response(body, { status: 200 }))
      await assert.rejects(service.transcribe(input), (error: unknown) => {
        const failure = error as { status?: number, code?: string }
        return failure.status === expectedStatus && failure.code === expectedCode
      })
      assert.equal(diagnostics[0]?.providerCode, diagnosticCode)
      assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|secret/u)
    }
  })

  test('network failures have a distinct safe classification', async () => {
    const diagnostics: VoiceTranscriptionDiagnostic[] = []
    const service = createVoiceTranscriptionDependencies({ apiKey: 'secret', timeoutMs: 1_000,
      onFailure: value => diagnostics.push(value) }, async () => { throw Object.assign(new Error('PRIVATE_NETWORK_DETAIL'), { code: 'PRIVATE' }) })
    await assert.rejects(service.transcribe({ bytes: Buffer.from('x'), durationMs: 100, fileName: 'x.webm', mimeType: 'audio/webm' }),
      (error: unknown) => (error as { code?: string }).code === 'VOICE_TRANSCRIPTION_PROVIDER_UNREACHABLE')
    assert.deepEqual(diagnostics, [{ stage: 'provider_connectivity', providerCode: 'network_error',
      requestId: undefined, mimeType: 'audio/webm', byteCount: 1 }])
    assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|secret/u)
  })

  test('provider timeouts have a distinct safe failure', async () => {
    const diagnostics: VoiceTranscriptionDiagnostic[] = []
    const service = createVoiceTranscriptionDependencies({ apiKey: 'secret', timeoutMs: 5,
      onFailure: value => diagnostics.push(value) }, async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    await assert.rejects(service.transcribe({ bytes: Buffer.from('x'), durationMs: 100, fileName: 'x.webm', mimeType: 'audio/webm' }),
      (error: unknown) => (error as { code?: string }).code === 'VOICE_TRANSCRIPTION_TIMEOUT')
    assert.equal(diagnostics[0]?.stage, 'provider_timeout')
  })
})

describe('authenticated voice transcription API', () => {
  test('transcription is classified under the expensive-operation rate limit', () => {
    assert.equal(isExpensiveRead({ method: 'POST', originalUrl: '/api/voice-sales/transcribe' } as express.Request), true)
    assert.equal(isExpensiveRead({ method: 'POST', originalUrl: '/API/VOICE-SALES/TRANSCRIBE/' } as express.Request), true)
  })
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) test(`${role} can transcribe bounded audio`, async () => {
    let calls = 0
    const service: VoiceTranscriptionDependencies = { configured: true, async transcribe(input) {
      calls += 1; assert.equal(input.mimeType, 'audio/webm'); assert.equal(input.durationMs, 1200)
      assert.equal(input.requestId, 'transcription-test-request')
      return { text: 't chirt orange kt3ten', languageCode: null, languageProbability: null, model: 'scribe_v2' }
    } }
    await withApi(service, role, async url => {
      const response = await post(url, audioForm())
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { transcript: { text: 't chirt orange kt3ten', languageCode: null, languageProbability: null, model: 'scribe_v2' } })
    })
    assert.equal(calls, 1)
  })

  test('auth and active tenant checks run before provider access', async () => {
    let calls = 0
    const service: VoiceTranscriptionDependencies = { configured: true, async transcribe() { calls += 1; throw new Error('unused') } }
    await withApi(service, UserRole.OWNER, async url => assert.equal((await post(url, audioForm(), '')).status, 401))
    await withApi(service, UserRole.SUPER_ADMIN, async url => assert.equal((await post(url, audioForm())).status, 403))
    await withApi(service, UserRole.WAREHOUSE, async url => assert.equal((await post(url, audioForm())).status, 403), false)
    assert.equal(calls, 0)
  })

  test('invalid uploads never reach the provider', async () => {
    let calls = 0
    const service: VoiceTranscriptionDependencies = { configured: true, async transcribe() { calls += 1; throw new Error('unused') } }
    await withApi(service, UserRole.OWNER, async url => {
      const cases: Array<[FormData, number, string]> = [
        [audioForm(Buffer.alloc(0)), 422, 'VOICE_AUDIO_EMPTY'],
        [audioForm(Buffer.from('not-webm')), 415, 'VOICE_AUDIO_UNSUPPORTED'],
        [audioForm(Buffer.from('plain'), 'text/plain'), 415, 'VOICE_AUDIO_UNSUPPORTED'],
        [audioForm(undefined, undefined, '99'), 422, 'VOICE_AUDIO_DURATION_INVALID'],
        [audioForm(undefined, undefined, '30001'), 422, 'VOICE_AUDIO_DURATION_INVALID'],
      ]
      for (const [body, status, code] of cases) {
        const response = await post(url, body)
        assert.equal(response.status, status)
        assert.equal((await response.json() as { error: { code: string } }).error.code, code)
      }
      const response = await post(url, audioForm(Buffer.alloc(MAX_VOICE_AUDIO_BYTES + 1)))
      assert.equal(response.status, 413)
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'VOICE_AUDIO_TOO_LARGE')
    })
    assert.equal(calls, 0)
  })

  test('query scope and extra multipart fields are rejected', async () => {
    const service: VoiceTranscriptionDependencies = { configured: true, async transcribe() { throw new Error('unused') } }
    await withApi(service, UserRole.OWNER, async url => {
      assert.equal((await post(`${url}?accountId=attacker`, audioForm())).status, 422)
      const extra = audioForm(); extra.set('accountId', 'attacker')
      assert.equal((await post(url, extra)).status, 422)
    })
  })
})
