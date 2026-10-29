import { authenticatedApiRequest } from '../../auth/owner-flow.js'

export const VOICE_MAX_DURATION_MS = 30_000
export const VOICE_MIN_DURATION_MS = 100
export const VOICE_MAX_BYTES = 5 * 1024 * 1024
export const VOICE_MIME_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm',
])

const failure = (code, message, extra = {}) => Object.freeze({ ok: false, code, message, ...extra })
const baseMime = value => typeof value === 'string' ? value.split(';', 1)[0].toLowerCase() : ''

export function selectRecordingMimeType(MediaRecorderClass = globalThis.MediaRecorder) {
  if (!MediaRecorderClass) return null
  if (typeof MediaRecorderClass.isTypeSupported !== 'function') return ''
  return VOICE_MIME_CANDIDATES.find(type => MediaRecorderClass.isTypeSupported(type)) ?? null
}

export function validateVoiceAudio(blob, durationMs) {
  if (!(blob instanceof Blob) || blob.size === 0) return failure('VOICE_AUDIO_EMPTY', 'No audio was captured. Please record again.')
  if (blob.size > VOICE_MAX_BYTES) return failure('VOICE_AUDIO_TOO_LARGE', 'The recording is too large. Keep it under 30 seconds.')
  if (!Number.isSafeInteger(durationMs) || durationMs < VOICE_MIN_DURATION_MS || durationMs > VOICE_MAX_DURATION_MS) {
    return failure('VOICE_AUDIO_DURATION_INVALID', 'Record between 0.1 and 30 seconds.')
  }
  const mimeType = baseMime(blob.type)
  if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav'].includes(mimeType)) {
    return failure('VOICE_AUDIO_UNSUPPORTED', 'This browser produced an unsupported audio format.')
  }
  return Object.freeze({ ok: true, blob, durationMs, mimeType })
}

function transcriptionFailure(result) {
  if (result.status === 401 || result.code === 'SESSION_REQUIRED') {
    return failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', 'Your session has expired. Sign in again.', { requiresLogin: true, status: 401 })
  }
  if (result.code === 'API_UNAVAILABLE') {
    return failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', 'Cannot reach the backend. Check that the local server is running.', { status: result.status })
  }
  if (result.code === 'VOICE_TRANSCRIPTION_NO_SPEECH') {
    return failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', 'No speech was detected. Record again and speak clearly.', { status: result.status })
  }
  if (result.code === 'VOICE_TRANSCRIPTION_AUDIO_REJECTED') {
    return failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', 'The audio could not be processed. Record again and retry.', { status: result.status })
  }
  if (['VOICE_TRANSCRIPTION_PROVIDER_AUTHENTICATION', 'VOICE_TRANSCRIPTION_PROVIDER_CREDITS',
    'VOICE_TRANSCRIPTION_PROVIDER_PERMISSION'].includes(result.code)) {
    return failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', 'Voice transcription needs provider configuration attention.', { status: result.status })
  }
  if (['VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE', 'VOICE_TRANSCRIPTION_PROVIDER_UNREACHABLE',
    'VOICE_TRANSCRIPTION_PROVIDER_FAILED'].includes(result.code)) {
    return failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', 'The transcription provider is temporarily unavailable. Please try again.', { status: result.status })
  }
  if (result.code === 'VOICE_TRANSCRIPTION_RESPONSE_INVALID') {
    return failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', 'The transcription provider returned an invalid response. Please try again.', { status: result.status })
  }
  const messages = {
    403: 'Voice transcription is unavailable for your role or store status.',
    413: 'The recording is too large. Keep it under 30 seconds.',
    415: 'This audio format is not supported. Try a different browser.',
    422: 'The recording is empty, malformed, or outside the 30-second limit.',
    429: 'Too many transcription attempts. Wait a moment and try again.',
    503: 'Voice transcription is not configured on the backend.',
    504: 'Transcription timed out. Please try again.',
  }
  return failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', messages[result.status] || 'The audio could not be transcribed. Please try again.', {
    status: result.status,
    ...(Number.isSafeInteger(result.retryAfterSeconds) ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
  })
}

function normalizeTranscript(value) {
  const transcript = value?.transcript
  if (transcript && typeof transcript === 'object' && !Array.isArray(transcript)
    && typeof transcript.text === 'string' && !transcript.text.trim()) {
    return failure('VOICE_TRANSCRIPTION_NO_SPEECH', 'No speech was detected. Record again and speak clearly.')
  }
  if (!transcript || typeof transcript !== 'object' || Array.isArray(transcript)
    || typeof transcript.text !== 'string' || !transcript.text.trim() || transcript.text.length > 4096
    || transcript.model !== 'scribe_v2'
    || !(transcript.languageCode === null || typeof transcript.languageCode === 'string')
    || !(transcript.languageProbability === null || (typeof transcript.languageProbability === 'number'
      && Number.isFinite(transcript.languageProbability) && transcript.languageProbability >= 0 && transcript.languageProbability <= 1))) {
    return failure('VOICE_TRANSCRIPTION_RESPONSE_INVALID', 'The transcription service returned an invalid response. Please try again.')
  }
  return Object.freeze({ ok: true, transcript: Object.freeze({
    text: transcript.text.trim(), languageCode: transcript.languageCode,
    languageProbability: transcript.languageProbability, model: 'scribe_v2',
  }) })
}

export async function requestVoiceTranscription({ supabase, blob, durationMs, fetchImpl, signal }) {
  const validation = validateVoiceAudio(blob, durationMs)
  if (!validation.ok) return validation
  const body = new FormData()
  const extension = validation.mimeType === 'audio/webm' ? 'webm' : validation.mimeType === 'audio/ogg' ? 'ogg'
    : validation.mimeType === 'audio/mp4' ? 'm4a' : validation.mimeType.includes('wav') ? 'wav' : 'mp3'
  body.set('audio', blob, `recording.${extension}`)
  body.set('durationMs', String(durationMs))
  const response = await authenticatedApiRequest({ supabase, fetchImpl, path: '/api/voice-sales/transcribe',
    method: 'POST', requestBody: body, signal, fallbackMessage: 'The audio could not be transcribed. Please try again.' })
  if (!response.ok) return transcriptionFailure(response)
  if (response.status !== 200) return transcriptionFailure(response)
  return normalizeTranscript(response.data)
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop()
}

export function createVoiceRecordingController({
  supabase, request = requestVoiceTranscription, mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderClass = globalThis.MediaRecorder, now = Date.now,
  interval = globalThis.setInterval, clearIntervalImpl = globalThis.clearInterval,
  timeout = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  const supported = Boolean(mediaDevices?.getUserMedia && MediaRecorderClass && selectRecordingMimeType(MediaRecorderClass) !== null)
  let state = Object.freeze({ phase: 'idle', supported, elapsedMs: 0, originalTranscriptText: '', transcriptText: '', confirmedText: '',
    transcriptRevision: null, languageCode: null, languageProbability: null, error: null, canRetry: false })
  let recorder = null, stream = null, timer = null, maximumTimer = null, startedAt = 0, chunks = [], lastRecording = null, revision = 0
  let transcriptionController = null
  const listeners = new Set()
  const publish = patch => { state = Object.freeze({ ...state, ...patch }); listeners.forEach(listener => listener()) }
  const clearTimers = () => {
    if (timer !== null) clearIntervalImpl(timer)
    if (maximumTimer !== null) clearTimeoutImpl(maximumTimer)
    timer = null; maximumTimer = null
  }
  const release = () => { clearTimers(); stopTracks(stream); stream = null; recorder = null }

  async function transcribe(recording, current) {
    transcriptionController = new AbortController()
    publish({ phase: 'transcribing', elapsedMs: recording.durationMs, error: null, canRetry: false })
    try {
      const result = await request({ supabase, blob: recording.blob, durationMs: recording.durationMs, signal: transcriptionController.signal })
      if (current !== revision) return { ignored: true }
      if (!result.ok) { publish({ phase: 'error', error: result, canRetry: true }); return result }
      publish({ phase: 'review', originalTranscriptText: result.transcript.text, transcriptText: result.transcript.text,
        confirmedText: '', languageCode: result.transcript.languageCode,
        languageProbability: result.transcript.languageProbability, transcriptRevision: current, error: null, canRetry: false })
      return result
    } catch {
      const error = failure('VOICE_TRANSCRIPTION_REQUEST_FAILED', 'The audio could not be transcribed. Please try again.')
      if (current === revision) publish({ phase: 'error', error, canRetry: true })
      return error
    } finally {
      if (current === revision) transcriptionController = null
    }
  }

  function finishRecording(current) {
    const elapsedMs = Math.min(VOICE_MAX_DURATION_MS, Math.max(0, Math.round(now() - startedAt)))
    const type = recorder?.mimeType || chunks[0]?.type || selectRecordingMimeType(MediaRecorderClass) || ''
    const blob = new Blob(chunks, { type })
    chunks = []
    release()
    if (current !== revision) return
    const validation = validateVoiceAudio(blob, elapsedMs)
    if (!validation.ok) { publish({ phase: 'error', error: validation, canRetry: false, elapsedMs }); return }
    lastRecording = { blob, durationMs: elapsedMs }
    void transcribe(lastRecording, current)
  }

  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async start() {
      if (!supported) { const error = failure('VOICE_RECORDING_UNSUPPORTED', 'Voice recording is not supported in this browser.'); publish({ phase: 'error', error, canRetry: false }); return error }
      if (['requesting', 'recording', 'transcribing'].includes(state.phase)) return { skipped: true }
      const current = ++revision
      publish({ phase: 'requesting', elapsedMs: 0, originalTranscriptText: '', transcriptText: '', confirmedText: '', transcriptRevision: null,
        languageCode: null, languageProbability: null, error: null, canRetry: false })
      try {
        const nextStream = await mediaDevices.getUserMedia({ audio: true })
        if (current !== revision) { stopTracks(nextStream); return { ignored: true } }
        stream = nextStream
        const mimeType = selectRecordingMimeType(MediaRecorderClass)
        recorder = mimeType ? new MediaRecorderClass(stream, { mimeType }) : new MediaRecorderClass(stream)
        chunks = []
        recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data) }
        recorder.onerror = () => {
          if (current !== revision) return
          ++revision; release(); publish({ phase: 'error', error: failure('VOICE_RECORDING_FAILED', 'Recording failed. Please try again.'), canRetry: false })
        }
        recorder.onstop = () => finishRecording(current)
        startedAt = now(); recorder.start()
        timer = interval(() => publish({ elapsedMs: Math.min(VOICE_MAX_DURATION_MS, Math.max(0, Math.round(now() - startedAt))) }), 250)
        maximumTimer = timeout(() => { if (recorder?.state === 'recording') recorder.stop() }, VOICE_MAX_DURATION_MS)
        publish({ phase: 'recording' })
        return { ok: true }
      } catch {
        release()
        const error = failure('MICROPHONE_PERMISSION_DENIED', 'Microphone access was denied or is unavailable.')
        if (current === revision) publish({ phase: 'error', error, canRetry: false })
        return error
      }
    },
    stop() { if (state.phase !== 'recording' || recorder?.state !== 'recording') return { skipped: true }; clearTimers(); recorder.stop(); return { ok: true } },
    cancel() {
      ++revision; clearTimers(); transcriptionController?.abort(); transcriptionController = null
      if (recorder?.state === 'recording') recorder.stop()
      release(); chunks = []; lastRecording = null
      publish({ phase: 'idle', elapsedMs: 0, originalTranscriptText: '', transcriptText: '', confirmedText: '', transcriptRevision: null,
        languageCode: null, languageProbability: null, error: null, canRetry: false })
    },
    retry() { if (!state.canRetry || !lastRecording) return Promise.resolve({ skipped: true }); const current = ++revision; return transcribe(lastRecording, current) },
    editTranscript(value) { if (!['review', 'confirmed'].includes(state.phase) || typeof value !== 'string') return; publish({ phase: 'review', transcriptText: value.slice(0, 4096), confirmedText: '', error: null }) },
    confirmTranscript() {
      const text = state.transcriptText.trim()
      if (state.phase !== 'review' || !text) { const error = failure('VOICE_TRANSCRIPT_REQUIRED', 'Review the transcript before confirming it.'); publish({ error }); return error }
      publish({ phase: 'confirmed', transcriptText: text, confirmedText: text, error: null })
      return Object.freeze({ ok: true, text })
    },
    invalidate() { ++revision; transcriptionController?.abort(); transcriptionController = null; release(); chunks = []; lastRecording = null; listeners.clear() },
  })
}
