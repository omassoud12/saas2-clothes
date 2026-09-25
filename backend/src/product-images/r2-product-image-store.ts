import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { HttpError } from '../errors/http-error.js'
import { requireProductImageKey } from './product-image-key.js'

export interface R2Environment {
  readonly endpoint: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucketName: string
  readonly networkTimeoutMs?: number
}

export const DEFAULT_R2_NETWORK_TIMEOUT_MS = 10_000

export interface ProductImageStore {
  upload(accountId: string, productId: string, imageKey: string, webp: Buffer): Promise<void>
  signedReadUrl(accountId: string, productId: string, imageKey: string, expiresIn?: number): Promise<string>
  delete(accountId: string, productId: string, imageKey: string): Promise<void>
  destroy?(): void
}

function requireEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} environment variable is required`)
  return value
}

function parseNetworkTimeout(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_R2_NETWORK_TIMEOUT_MS
  if (!/^\d+$/.test(value.trim())) {
    throw new Error('R2_NETWORK_TIMEOUT_MS configuration is invalid')
  }
  const timeout = Number(value)
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 60_000) {
    throw new Error('R2_NETWORK_TIMEOUT_MS configuration is invalid')
  }
  return timeout
}

export function loadR2Environment(environment: NodeJS.ProcessEnv = process.env): R2Environment {
  const endpoint = requireEnvironmentValue(environment, 'R2_ENDPOINT')
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('R2_ENDPOINT must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('R2_ENDPOINT must be a valid HTTPS URL')
  }
  return Object.freeze({
    endpoint: url.toString(),
    accessKeyId: requireEnvironmentValue(environment, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnvironmentValue(environment, 'R2_SECRET_ACCESS_KEY'),
    bucketName: requireEnvironmentValue(environment, 'R2_BUCKET_NAME'),
    networkTimeoutMs: parseNetworkTimeout(environment.R2_NETWORK_TIMEOUT_MS),
  })
}

type SignUrl = typeof getSignedUrl

interface AbortDeadline {
  readonly signal: AbortSignal
  clear(): void
}

function createAbortDeadline(timeoutMs: number): AbortDeadline {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref?.()

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  }
}

export function createR2ProductImageStore(
  config: R2Environment,
  options: {
    client?: S3Client
    signUrl?: SignUrl
    abortDeadlineFactory?: (timeoutMs: number) => AbortDeadline
  } = {},
): ProductImageStore {
  const client = options.client ?? new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  const signUrl = options.signUrl ?? getSignedUrl
  const networkTimeoutMs =
    config.networkTimeoutMs ?? DEFAULT_R2_NETWORK_TIMEOUT_MS
  const abortDeadlineFactory =
    options.abortDeadlineFactory ?? createAbortDeadline

  return {
    async upload(accountId, productId, imageKey, webp) {
      const key = requireProductImageKey(accountId, productId, imageKey)
      const deadline = abortDeadlineFactory(networkTimeoutMs)
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucketName,
            Key: key,
            Body: webp,
            ContentType: 'image/webp',
          }),
          { abortSignal: deadline.signal },
        )
      } catch {
        throw new HttpError(502, 'PRODUCT_IMAGE_UPLOAD_FAILED', 'Image upload failed')
      } finally {
        deadline.clear()
      }
    },
    async signedReadUrl(accountId, productId, imageKey, expiresIn = 300) {
      const key = requireProductImageKey(accountId, productId, imageKey)
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 300) {
        throw new HttpError(422, 'PRODUCT_IMAGE_URL_TTL_INVALID', 'Image URL lifetime is invalid')
      }
      try {
        return await signUrl(client, new GetObjectCommand({
          Bucket: config.bucketName,
          Key: key,
        }), { expiresIn })
      } catch {
        throw new HttpError(502, 'PRODUCT_IMAGE_URL_FAILED', 'Image URL could not be generated')
      }
    },
    async delete(accountId, productId, imageKey) {
      const key = requireProductImageKey(accountId, productId, imageKey)
      const deadline = abortDeadlineFactory(networkTimeoutMs)
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }),
          { abortSignal: deadline.signal },
        )
      } catch {
        throw new HttpError(502, 'PRODUCT_IMAGE_DELETE_FAILED', 'Image deletion failed')
      } finally {
        deadline.clear()
      }
    },
    destroy() {
      client.destroy()
    },
  }
}
