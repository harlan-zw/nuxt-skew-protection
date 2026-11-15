import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import s3Driver from 'unstorage/drivers/s3'
import { describe, expect, it } from 'vitest'
import { createAssetManager } from '../../src/utils/version-manager'

describe('pending uploads through the S3 driver', () => {
  it.each(['AssetPut', 'BeforeCommit', 'AfterCommit'] as const)('handles interrupted uploads and uncertain manifest PUTs: %s', async (failure) => {
    const objects = new Map<string, Buffer>()
    let responseMode: typeof failure | 'Success' = failure
    const server = createServer((request, response) => {
      const key = request.url || '/'
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        if (request.method === 'PUT') {
          const isManifest = key === '/assets/version-manifest.json'
          if (!isManifest || responseMode !== 'BeforeCommit')
            objects.set(key, Buffer.concat(chunks))
          response.statusCode = (isManifest && responseMode !== 'Success') || (key === objectPath && responseMode === 'AssetPut')
            ? 500
            : 200
        }
        else if (request.method === 'DELETE') {
          objects.delete(key)
          response.statusCode = 204
        }
        else {
          const value = objects.get(key)
          response.statusCode = value ? 200 : 404
          if (value && request.method === 'GET')
            response.write(value)
        }
        response.end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Expected a local HTTP server port')
    const directory = await mkdtemp(join(tmpdir(), 'skew-pending-s3-'))
    const createManager = () => createAssetManager({
      readConsistency: 'strong',
      driver: s3Driver({
        endpoint: `http://127.0.0.1:${address.port}`,
        bucket: 'assets',
        region: 'auto',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      }),
    })
    const asset = '_nuxt/entry.hash.js'
    const bytes = Buffer.from('S3 asset bytes')
    const objectPath = `/assets/blobs/${createHash('sha256').update(bytes).digest('hex')}`
    try {
      await mkdir(join(directory, '_nuxt', 'builds', 'meta'), { recursive: true })
      await writeFile(join(directory, asset), bytes)
      await writeFile(join(directory, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id: 'next' }))
      await writeFile(join(directory, '_nuxt', 'builds', 'meta', 'next.json'), JSON.stringify({ id: 'next' }))
      await expect(createManager().publishBuild('next', directory, [asset])).rejects.toThrow('500')
      expect(objects.get(objectPath)).toEqual(bytes)
      responseMode = 'Success'

      const recovered = createManager()
      await recovered.cleanupExpiredVersions()
      expect(objects.get(objectPath)).toEqual(failure === 'AssetPut'
        ? undefined
        : bytes)
      expect((await recovered.getManifest()).current).toBe(failure === 'AfterCommit'
        ? 'next'
        : '')
      await recovered.publishBuild('next', directory, [asset])
      const manifest = await recovered.getManifest()
      expect(objects.get(`/assets/${manifest.versions.next!.storageKeys![asset]}`)).toEqual(bytes)
      expect(manifest.current).toBe('next')
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error
        ? reject(error)
        : resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })
})
