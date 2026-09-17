import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import sharp from 'sharp'
import express from 'express'
import { HttpError } from '../errors/http-error.js'
import { errorHandler } from '../middleware/error-handler.js'
import { productImageKey, requireProductImageKey } from './product-image-key.js'
import {
  MAX_PRODUCT_IMAGE_BYTES,
  processProductImage,
} from './product-image-policy.js'
import { uploadProductImage } from './product-image.service.js'
import { productImageUpload } from './product-image-upload.js'
import { createR2ProductImageStore, loadR2Environment } from './r2-product-image-store.js'

const accountId = '11111111-1111-4111-8111-111111111111'
const otherAccountId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'
const key = `tenants/${accountId}/products/${productId}/main.webp`

function expectHttpError(error: unknown, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.code, code)
  return true
}

async function fixture(format: 'jpeg' | 'png' | 'webp', width = 40, height = 20): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#774422' } })
    .toFormat(format)
    .toBuffer()
}

function pngWithDeclaredDimensions(png: Buffer, width: number, height: number): Buffer {
  const modified = Buffer.from(png)
  modified.writeUInt32BE(width, 16)
  modified.writeUInt32BE(height, 20)
  let crc = 0xffffffff
  for (const byte of modified.subarray(12, 29)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  modified.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29)
  return modified
}

describe('product image key', () => {
  test('uses canonical tenant/product path', () => {
    assert.equal(productImageKey(accountId, productId), key)
    assert.equal(requireProductImageKey(accountId, productId, key), key)
    assert.throws(() => productImageKey('../other', productId), (error) => expectHttpError(error, 'PRODUCT_IMAGE_IDENTIFIER_INVALID'))
    assert.throws(() => requireProductImageKey(otherAccountId, productId, key), (error) => expectHttpError(error, 'PRODUCT_IMAGE_KEY_FORBIDDEN'))
    assert.throws(() => requireProductImageKey(accountId, productId, `${key}/elsewhere`), (error) => expectHttpError(error, 'PRODUCT_IMAGE_KEY_FORBIDDEN'))
  })
})

describe('product image processing', () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    test(`accepts ${format} content and outputs WebP`, async () => {
      const output = await processProductImage(await fixture(format))
      const metadata = await sharp(output).metadata()
      assert.equal(metadata.format, 'webp')
      assert.equal(metadata.width, 40)
      assert.equal(metadata.height, 20)
    })
  }

  test('rejects invalid bytes and unsupported SVG/GIF', async () => {
    await assert.rejects(processProductImage(Buffer.from('not an image')), (error) => expectHttpError(error, 'PRODUCT_IMAGE_INVALID'))
    await assert.rejects(processProductImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')), (error) => expectHttpError(error, 'PRODUCT_IMAGE_UNSUPPORTED'))
    const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')
    await assert.rejects(processProductImage(gif), (error) => expectHttpError(error, 'PRODUCT_IMAGE_UNSUPPORTED'))
  })

  test('rejects bytes beyond the transport policy limit', async () => {
    await assert.rejects(processProductImage(Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1)), (error) => expectHttpError(error, 'PRODUCT_IMAGE_TOO_LARGE'))
  })

  test('rejects metadata declaring more than 40 million decoded pixels', async () => {
    const huge = pngWithDeclaredDimensions(await fixture('png', 1, 1), 10_000, 5_000)
    await assert.rejects(processProductImage(huge), (error) => expectHttpError(error, 'PRODUCT_IMAGE_DIMENSIONS_TOO_LARGE'))
  })

  test('resizes inside 1600 × 1600 without distorting or enlarging', async () => {
    const output = await processProductImage(await fixture('png', 2000, 1000))
    const metadata = await sharp(output).metadata()
    assert.equal(metadata.width, 1600)
    assert.equal(metadata.height, 800)
    const small = await processProductImage(await fixture('jpeg', 10, 5))
    const smallMetadata = await sharp(small).metadata()
    assert.equal(smallMetadata.width, 10)
    assert.equal(smallMetadata.height, 5)
  })
})

describe('product image transport policy', () => {
  test('accepts one memory upload and rejects an upload above 10 MiB', async () => {
    const app = express()
    app.post('/image', productImageUpload, (request, response) => {
      response.json({ size: request.file?.buffer.length, diskPath: request.file?.path ?? null })
    })
    app.use(errorHandler)
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/image`

    try {
      const good = new FormData()
      good.append('image', new Blob([new Uint8Array(4)]), 'sample.png')
      const accepted = await fetch(baseUrl, { method: 'POST', body: good })
      assert.equal(accepted.status, 200)
      assert.deepEqual(await accepted.json(), { size: 4, diskPath: null })

      const large = new FormData()
      large.append('image', new Blob([new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1)]), 'large.png')
      const rejected = await fetch(baseUrl, { method: 'POST', body: large })
      assert.equal(rejected.status, 413)
      assert.equal((await rejected.json() as { error: { code: string } }).error.code, 'PRODUCT_IMAGE_TOO_LARGE')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })
})

describe('private R2 product image store', () => {
  test('loads backend-only environment without exposing secret in errors', () => {
    const config = loadR2Environment({
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET_NAME: 'saas2-clothes-products',
    })
    assert.equal(config.bucketName, 'saas2-clothes-products')
    assert.throws(() => loadR2Environment({ R2_ENDPOINT: 'http://example.com' }), /HTTPS/)
  })

  test('uploads WebP with the canonical key, signs bounded reads, and deletes only that key', async () => {
    const commands: Array<PutObjectCommand | DeleteObjectCommand> = []
    const signed: Array<{ command: GetObjectCommand; expiresIn: number }> = []
    const fakeClient = {
      async send(command: PutObjectCommand | DeleteObjectCommand) {
        commands.push(command)
        return {}
      },
    } as unknown as S3Client
    const config = {
      endpoint: 'https://example.r2.cloudflarestorage.com',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      bucketName: 'saas2-clothes-products',
    }
    const store = createR2ProductImageStore(config, {
      client: fakeClient,
      signUrl: async (_client, command, options) => {
        assert.ok(command instanceof GetObjectCommand)
        signed.push({ command, expiresIn: options?.expiresIn ?? 0 })
        return 'https://signed.example/image'
      },
    })
    const result = await uploadProductImage(store, accountId, productId, await fixture('png'))
    assert.equal(result, key)
    assert.ok(commands[0] instanceof PutObjectCommand)
    assert.equal(commands[0].input.Bucket, config.bucketName)
    assert.equal(commands[0].input.Key, key)
    assert.equal(commands[0].input.ContentType, 'image/webp')
    assert.equal((await sharp(commands[0].input.Body as Buffer).metadata()).format, 'webp')

    assert.equal(await store.signedReadUrl(accountId, productId, key), 'https://signed.example/image')
    assert.equal(signed[0].expiresIn, 300)
    assert.equal(signed[0].command.input.Key, key)
    await assert.rejects(store.signedReadUrl(accountId, productId, key, 301), (error) => expectHttpError(error, 'PRODUCT_IMAGE_URL_TTL_INVALID'))
    await assert.rejects(store.signedReadUrl(otherAccountId, productId, key), (error) => expectHttpError(error, 'PRODUCT_IMAGE_KEY_FORBIDDEN'))

    await store.delete(accountId, productId, key)
    assert.ok(commands[1] instanceof DeleteObjectCommand)
    assert.equal(commands[1].input.Key, key)
    await assert.rejects(store.delete(otherAccountId, productId, key), (error) => expectHttpError(error, 'PRODUCT_IMAGE_KEY_FORBIDDEN'))
  })

  test('maps R2 failures to safe application errors', async () => {
    const store = createR2ProductImageStore({
      endpoint: 'https://example.r2.cloudflarestorage.com',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      bucketName: 'saas2-clothes-products',
    }, {
      client: { async send() { throw new Error('secret transport detail') } } as unknown as S3Client,
      signUrl: async () => { throw new Error('secret signing detail') },
    })
    await assert.rejects(store.upload(accountId, productId, key, Buffer.from('webp')), (error) => expectHttpError(error, 'PRODUCT_IMAGE_UPLOAD_FAILED'))
    await assert.rejects(store.signedReadUrl(accountId, productId, key), (error) => expectHttpError(error, 'PRODUCT_IMAGE_URL_FAILED'))
    await assert.rejects(store.delete(accountId, productId, key), (error) => expectHttpError(error, 'PRODUCT_IMAGE_DELETE_FAILED'))
  })
})
