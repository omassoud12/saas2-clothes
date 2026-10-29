import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createVoiceRecordingController, requestVoiceTranscription, selectRecordingMimeType, validateVoiceAudio, VOICE_MAX_BYTES } from './voice-recording-flow.js'

const transcript = text => ({ ok: true, transcript: { text, languageCode: 'ar', languageProbability: 0.97, model: 'scribe_v2' } })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

class FakeMediaRecorder {
  static isTypeSupported(type) { return type === 'audio/webm;codecs=opus' }
  constructor(_stream, options) { this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive' }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) }); this.onstop?.() }
}

function fixture(overrides = {}) {
  let stopped = 0
  const stream = { getTracks: () => [{ stop() { stopped += 1 } }] }
  return { stream, mediaDevices: { async getUserMedia() { return stream } }, stopped: () => stopped, ...overrides }
}

describe('voice audio request', () => {
  test('selects a supported format without fuzzy fallbacks', () => {
    assert.equal(selectRecordingMimeType(FakeMediaRecorder), 'audio/webm;codecs=opus')
    assert.equal(selectRecordingMimeType(class { static isTypeSupported() { return false } }), null)
    assert.equal(selectRecordingMimeType(undefined), null)
  })
  test('validates empty, size, duration and MIME limits', () => {
    assert.equal(validateVoiceAudio(new Blob([], { type: 'audio/webm' }), 1000).code, 'VOICE_AUDIO_EMPTY')
    assert.equal(validateVoiceAudio(new Blob([new Uint8Array(VOICE_MAX_BYTES + 1)], { type: 'audio/webm' }), 1000).code, 'VOICE_AUDIO_TOO_LARGE')
    assert.equal(validateVoiceAudio(new Blob(['x'], { type: 'audio/webm' }), 99).code, 'VOICE_AUDIO_DURATION_INVALID')
    assert.equal(validateVoiceAudio(new Blob(['x'], { type: 'video/webm' }), 1000).code, 'VOICE_AUDIO_UNSUPPORTED')
    assert.equal(validateVoiceAudio(new Blob(['x'], { type: 'audio/ogg;codecs=opus' }), 1000).ok, true)
  })
  test('uses authenticated multipart transport and preserves Arabic/English', async () => {
    let captured
    const supabase = { auth: { async getSession() { return { data: { session: { access_token: 'session-token', user: { id: 'user' } } }, error: null } } } }
    const result = await requestVoiceTranscription({ supabase, blob: new Blob(['audio'], { type: 'audio/webm' }), durationMs: 1200,
      fetchImpl: async (_url, options) => { captured = options; return new Response(JSON.stringify({ transcript: { text: 'بدي T-shirt black XL قطعتين', languageCode: 'ar', languageProbability: 0.9, model: 'scribe_v2' } }), { status: 200 }) } })
    assert.equal(result.ok, true); assert.equal(result.transcript.text, 'بدي T-shirt black XL قطعتين')
    assert.equal(captured.headers.Authorization, 'Bearer session-token'); assert.equal(Object.hasOwn(captured.headers, 'Content-Type'), false)
    assert.ok(captured.body instanceof FormData); assert.ok(captured.body.get('audio') instanceof Blob); assert.equal(captured.body.get('durationMs'), '1200')
  })
  test('sanitizes API failures and malformed success', async () => {
    const supabase = { auth: { async getSession() { return { data: { session: { access_token: 'token', user: { id: 'user' } } }, error: null } } } }
    for (const [status, code, expected] of [
      [401, 'SESSION_REQUIRED', 'session'],
      [403, 'ROLE_FORBIDDEN', 'role'],
      [413, 'VOICE_AUDIO_TOO_LARGE', 'large'],
      [415, 'VOICE_AUDIO_UNSUPPORTED', 'format'],
      [422, 'VOICE_AUDIO_DURATION_INVALID', 'malformed'],
      [422, 'VOICE_TRANSCRIPTION_NO_SPEECH', 'no speech'],
      [422, 'VOICE_TRANSCRIPTION_AUDIO_REJECTED', 'processed'],
      [429, 'VOICE_TRANSCRIPTION_RATE_LIMITED', 'attempts'],
      [503, 'VOICE_TRANSCRIPTION_NOT_CONFIGURED', 'configured'],
      [503, 'VOICE_TRANSCRIPTION_PROVIDER_AUTHENTICATION', 'configuration attention'],
      [503, 'VOICE_TRANSCRIPTION_PROVIDER_CREDITS', 'configuration attention'],
      [503, 'VOICE_TRANSCRIPTION_PROVIDER_PERMISSION', 'configuration attention'],
      [502, 'VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE', 'provider'],
      [502, 'VOICE_TRANSCRIPTION_PROVIDER_UNREACHABLE', 'provider'],
      [502, 'VOICE_TRANSCRIPTION_RESPONSE_INVALID', 'invalid response'],
      [504, 'VOICE_TRANSCRIPTION_TIMEOUT', 'timed out'],
    ]) {
      const result = await requestVoiceTranscription({ supabase, blob: new Blob(['x'], { type: 'audio/webm' }), durationMs: 100,
        fetchImpl: async () => new Response(JSON.stringify({ error: { code, message: 'PRIVATE_SECRET' } }), { status }) })
      assert.equal(result.ok, false); assert.match(result.message.toLowerCase(), new RegExp(expected)); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/u)
    }
    const unavailable = await requestVoiceTranscription({ supabase, blob: new Blob(['x'], { type: 'audio/webm' }), durationMs: 100,
      fetchImpl: async () => { throw new Error('PRIVATE_PROXY_FAILURE') } })
    assert.match(unavailable.message, /cannot reach the backend/i); assert.doesNotMatch(JSON.stringify(unavailable), /PRIVATE/u)
    const malformed = await requestVoiceTranscription({ supabase, blob: new Blob(['x'], { type: 'audio/webm' }), durationMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({ transcript: { text: '', providerSecret: 'PRIVATE' } }), { status: 200 }) })
    assert.equal(malformed.code, 'VOICE_TRANSCRIPTION_NO_SPEECH'); assert.match(malformed.message, /no speech/i)
    assert.doesNotMatch(JSON.stringify(malformed), /PRIVATE/u)
  })
})

describe('recording and confirmation lifecycle', () => {
  test('start, stop, edit and confirmation never invoke matching themselves', async () => {
    let clock = 0, transcriptionCalls = 0
    const source = fixture()
    const controller = createVoiceRecordingController({ mediaDevices: source.mediaDevices, MediaRecorderClass: FakeMediaRecorder, now: () => clock,
      interval: () => 1, clearIntervalImpl() {}, timeout: () => 2, clearTimeoutImpl() {}, request: async () => { transcriptionCalls += 1; return transcript('بدي tshirt سودا XL قطعتين') } })
    assert.equal((await controller.start()).ok, true); assert.equal(controller.getSnapshot().phase, 'recording')
    clock = 1500; assert.equal(controller.stop().ok, true); await tick()
    assert.equal(source.stopped(), 1); assert.equal(transcriptionCalls, 1); assert.equal(controller.getSnapshot().phase, 'review')
    assert.ok(controller.getSnapshot().transcriptText.trim().length > 0)
    assert.equal(controller.getSnapshot().originalTranscriptText, controller.getSnapshot().transcriptText)
    assert.equal(controller.getSnapshot().transcriptRevision, 1)
    controller.editTranscript('بدي T-shirt black XL قطعتين')
    assert.notEqual(controller.getSnapshot().originalTranscriptText, controller.getSnapshot().transcriptText)
    assert.deepEqual(controller.confirmTranscript(), { ok: true, text: 'بدي T-shirt black XL قطعتين' })
    assert.notEqual(controller.getSnapshot().originalTranscriptText, controller.getSnapshot().confirmedText)
    assert.equal(controller.getSnapshot().phase, 'confirmed')
  })
  test('cancel stops tracks and ignores late permission or transcription', async () => {
    let resolvePermission
    const track = { stopped: 0, stop() { this.stopped += 1 } }
    const first = createVoiceRecordingController({ mediaDevices: { getUserMedia: () => new Promise(resolve => { resolvePermission = resolve }) }, MediaRecorderClass: FakeMediaRecorder })
    const start = first.start(); first.cancel(); resolvePermission({ getTracks: () => [track] })
    assert.equal((await start).ignored, true); assert.equal(track.stopped, 1); assert.equal(first.getSnapshot().phase, 'idle')
    let clock = 0, resolveTranscript
    const source = fixture()
    const second = createVoiceRecordingController({ mediaDevices: source.mediaDevices, MediaRecorderClass: FakeMediaRecorder, now: () => clock,
      interval: () => 1, clearIntervalImpl() {}, timeout: () => 2, clearTimeoutImpl() {}, request: () => new Promise(resolve => { resolveTranscript = resolve }) })
    await second.start(); clock = 500; second.stop(); assert.equal(second.getSnapshot().phase, 'transcribing')
    second.cancel(); resolveTranscript(transcript('late')); await tick()
    assert.equal(second.getSnapshot().phase, 'idle'); assert.equal(second.getSnapshot().transcriptText, '')
    assert.equal(second.getSnapshot().originalTranscriptText, '')
    assert.equal(second.getSnapshot().transcriptRevision, null)
  })
  test('a cancelled older transcription cannot replace a newer recording', async () => {
    let clock = 0, calls = 0, resolveOlder
    const source = fixture()
    const controller = createVoiceRecordingController({ mediaDevices: source.mediaDevices, MediaRecorderClass: FakeMediaRecorder, now: () => clock,
      interval: () => 1, clearIntervalImpl() {}, timeout: () => 2, clearTimeoutImpl() {}, request: () => {
        calls += 1
        if (calls === 1) return new Promise(resolve => { resolveOlder = resolve })
        return Promise.resolve(transcript('newer transcript'))
      } })
    await controller.start(); clock = 500; controller.stop()
    assert.equal(controller.getSnapshot().phase, 'transcribing')
    controller.cancel()
    await controller.start(); clock = 1_200; controller.stop(); await tick()
    assert.equal(controller.getSnapshot().transcriptText, 'newer transcript')
    const newerRevision = controller.getSnapshot().transcriptRevision
    resolveOlder(transcript('older transcript')); await tick()
    assert.equal(controller.getSnapshot().transcriptText, 'newer transcript')
    assert.equal(controller.getSnapshot().transcriptRevision, newerRevision)
  })
  test('permission rejection, unsupported browser and retry are handled', async () => {
    const denied = createVoiceRecordingController({ mediaDevices: { async getUserMedia() { throw new Error('PRIVATE') } }, MediaRecorderClass: FakeMediaRecorder })
    assert.equal((await denied.start()).code, 'MICROPHONE_PERMISSION_DENIED'); assert.doesNotMatch(JSON.stringify(denied.getSnapshot()), /PRIVATE/u)
    const unsupported = createVoiceRecordingController({ mediaDevices: null, MediaRecorderClass: null })
    assert.equal((await unsupported.start()).code, 'VOICE_RECORDING_UNSUPPORTED')
    let clock = 0, calls = 0
    const source = fixture()
    const controller = createVoiceRecordingController({ mediaDevices: source.mediaDevices, MediaRecorderClass: FakeMediaRecorder, now: () => clock,
      interval: () => 1, clearIntervalImpl() {}, timeout: () => 2, clearTimeoutImpl() {}, request: async () => { calls += 1; return calls === 1 ? { ok: false, code: 'FAILED', message: 'Try again' } : transcript('tshirt black xl two pieces') } })
    await controller.start(); clock = 800; controller.stop(); await tick()
    assert.equal(controller.getSnapshot().phase, 'error'); assert.equal(controller.getSnapshot().canRetry, true)
    await controller.retry(); assert.equal(controller.getSnapshot().phase, 'review'); assert.equal(calls, 2)
  })
  test('automatic 30-second stop uses the bounded flow', async () => {
    let clock = 0, automaticStop
    const source = fixture()
    const controller = createVoiceRecordingController({ mediaDevices: source.mediaDevices, MediaRecorderClass: FakeMediaRecorder, now: () => clock,
      interval: () => 1, clearIntervalImpl() {}, timeout: callback => { automaticStop = callback; return 2 }, clearTimeoutImpl() {}, request: async () => transcript('hello') })
    await controller.start(); clock = 30_000; automaticStop(); await tick()
    assert.equal(controller.getSnapshot().phase, 'review'); assert.equal(controller.getSnapshot().elapsedMs, 30_000); assert.equal(source.stopped(), 1)
  })
})
