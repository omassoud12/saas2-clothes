export const MAX_VOICE_AUDIO_BYTES = 5 * 1024 * 1024
export const MIN_VOICE_AUDIO_DURATION_MS = 100
export const MAX_VOICE_AUDIO_DURATION_MS = 30_000
export const MAX_TRANSCRIPT_LENGTH = 4_096

export interface VoiceAudioInput {
  readonly bytes: Buffer
  readonly durationMs: number
  readonly fileName: string
  readonly mimeType: string
  readonly requestId?: string
}

export type VoiceTranscriptionFailureStage =
  | 'provider_request'
  | 'provider_response'
  | 'provider_timeout'
  | 'provider_connectivity'

export interface VoiceTranscriptionDiagnostic {
  readonly requestId?: string
  readonly stage: VoiceTranscriptionFailureStage
  readonly upstreamStatus?: number
  readonly providerCode: string
  readonly mimeType: string
  readonly byteCount: number
}

export interface VoiceTranscript {
  readonly text: string
  readonly languageCode: string | null
  readonly languageProbability: number | null
  readonly model: 'scribe_v2'
}

export interface VoiceTranscriptionDependencies {
  readonly configured: boolean
  transcribe(input: VoiceAudioInput, signal?: AbortSignal): Promise<VoiceTranscript>
}
