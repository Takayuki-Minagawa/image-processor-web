import { describe, expect, it } from 'vitest'
import type { BrowserLockManagerLike } from '../lib/browserLock'
import {
  MemoryBinaryDirectory,
  MemoryBinaryStorage,
} from '../test/fixtures/binaryRepository'
import {
  BrowserUserAssetRepository,
  type SaveUserAssetInput,
} from './userAssetRepository'

const png = (width = 32, height = 24): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

const rasterInput = (
  overrides: Partial<SaveUserAssetInput> = {},
): SaveUserAssetInput => ({
  name: 'Local image',
  fileName: 'image.png',
  bytes: png(),
  ...overrides,
})

class MemoryLockManager implements BrowserLockManagerLike {
  readonly #queues = new Map<string, Promise<void>>()

  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    const prior = this.#queues.get(name) ?? Promise.resolve()
    const result = prior.then(callback, callback)
    this.#queues.set(
      name,
      Promise.resolve(result).then(
        () => undefined,
        () => undefined,
      ),
    )
    return Promise.resolve(result)
  }
}

describe('BrowserUserAssetRepository', () => {
  it('validates, hashes, stores, lists, reads, and removes raster bytes in OPFS', async () => {
    const directory = new MemoryBinaryDirectory()
    const repository = new BrowserUserAssetRepository({
      getOpfsDirectory: async () => directory,
      storage: null,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    })

    const saved = await repository.save(
      rasterInput({
        id: 'hero-image',
        declaredDimensions: { width: 32, height: 24 },
      }),
    )

    expect(saved).toMatchObject({
      backend: 'opfs',
      metadata: {
        id: 'hero-image',
        width: 32,
        height: 24,
        byteLength: 24,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    })
    expect(saved.metadata.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(await repository.list()).toEqual([saved.metadata])
    const stored = await repository.get('hero-image')
    expect(stored?.backend).toBe('opfs')
    expect(new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))).toEqual(png())
    expect(await repository.remove('hero-image')).toBe(true)
    expect(await repository.get('hero-image')).toBeNull()
    expect(await repository.remove('hero-image')).toBe(false)
  })

  it('sanitizes SVG before hashing and persistence', async () => {
    const storage = new MemoryBinaryStorage()
    const repository = new BrowserUserAssetRepository({
      getOpfsDirectory: null,
      storage,
    })
    const unsafe = new TextEncoder().encode(`
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="alert(1)">
        <script>alert(2)</script>
        <image href="https://example.test/pixel.png"/>
        <rect width="120" height="80" fill="#123456"/>
      </svg>
    `)

    const saved = await repository.save({
      name: 'Safe logo',
      fileName: 'logo.svg',
      bytes: unsafe,
    })
    const stored = await repository.get(saved.metadata.id)
    const source = new TextDecoder().decode(stored?.bytes)

    expect(saved.backend).toBe('localStorage')
    expect(saved.metadata).toMatchObject({
      width: 120,
      height: 80,
      mediaType: 'image/svg+xml',
    })
    expect(source).not.toMatch(/script|onload|https:\/\//iu)
    expect(source).toContain('<rect')
    expect(saved.metadata.byteLength).toBe(
      new TextEncoder().encode(source).byteLength,
    )
  })

  it('retains exact bytes in bounded localStorage when OPFS is unavailable', async () => {
    const storage = new MemoryBinaryStorage()
    const first = new BrowserUserAssetRepository({
      getOpfsDirectory: null,
      storage,
    })
    const saved = await first.save(rasterInput({ id: 'fallback-image' }))

    const reopened = new BrowserUserAssetRepository({
      getOpfsDirectory: null,
      storage,
    })
    const stored = await reopened.get('fallback-image')

    expect(saved.backend).toBe('localStorage')
    expect(new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))).toEqual(png())
    expect(storage.getItem('pixelweave:user-assets:v1')).toContain('bytes')
  })

  it('falls back with bytes when an available OPFS directory cannot write', async () => {
    const directory = new MemoryBinaryDirectory()
    directory.failWrites = true
    const storage = new MemoryBinaryStorage()
    const repository = new BrowserUserAssetRepository({
      getOpfsDirectory: async () => directory,
      storage,
    })

    const saved = await repository.save(rasterInput({ id: 'write-fallback' }))

    expect(saved.backend).toBe('localStorage')
    expect(
      new Uint8Array(
        (await repository.get('write-fallback'))?.bytes ?? new ArrayBuffer(0),
      ),
    ).toEqual(png())
  })

  it('never replaces an unreadable OPFS index with an empty one', async () => {
    const directory = new MemoryBinaryDirectory()
    const storage = new MemoryBinaryStorage()
    const first = new BrowserUserAssetRepository({
      getOpfsDirectory: async () => directory,
      storage,
      lockManager: null,
    })
    await first.save(rasterInput({ id: 'existing-image' }))
    const indexName = [...directory.files.keys()].find((name) =>
      name.endsWith('index-v1.json'),
    )!
    const committedIndex = new TextDecoder().decode(
      directory.files.get(indexName),
    )

    directory.failReads = true
    const second = new BrowserUserAssetRepository({
      getOpfsDirectory: async () => directory,
      storage,
      lockManager: null,
    })
    await expect(
      second.save(rasterInput({ id: 'fallback-after-read-error' })),
    ).resolves.toMatchObject({ backend: 'localStorage' })
    expect(new TextDecoder().decode(directory.files.get(indexName))).toBe(
      committedIndex,
    )

    directory.failReads = false
    await expect(second.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'existing-image' }),
        expect.objectContaining({ id: 'fallback-after-read-error' }),
      ]),
    )
  })

  it('serializes writes across repository instances with a shared browser lock', async () => {
    const directory = new MemoryBinaryDirectory()
    const lockManager = new MemoryLockManager()
    const options = {
      getOpfsDirectory: async () => directory,
      storage: new MemoryBinaryStorage(),
      lockManager,
    }
    const first = new BrowserUserAssetRepository(options)
    const second = new BrowserUserAssetRepository(options)

    await Promise.all([
      first.save(rasterInput({ id: 'tab-one' })),
      second.save(rasterInput({ id: 'tab-two' })),
    ])

    expect((await first.list()).map(({ id }) => id).sort()).toEqual([
      'tab-one',
      'tab-two',
    ])
  })

  it('rejects invalid headers, dimension mismatches, media mismatches, and fallback overflow', async () => {
    const storage = new MemoryBinaryStorage()
    const repository = new BrowserUserAssetRepository({
      getOpfsDirectory: null,
      storage,
      maxFallbackEntryBytes: 23,
    })

    await expect(
      repository.save(
        rasterInput({ fileName: 'fake.jpg', mediaType: 'image/png' }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-media' })
    await expect(
      repository.save(rasterInput({ bytes: new Uint8Array([1, 2, 3]) })),
    ).rejects.toMatchObject({ code: 'invalid-image' })
    await expect(
      repository.save(
        rasterInput({ declaredDimensions: { width: 300, height: 200 } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-image' })
    await expect(repository.save(rasterInput())).rejects.toMatchObject({
      code: 'fallback-limit',
    })
    await expect(
      repository.save(rasterInput({ id: '../unsafe' })),
    ).rejects.toMatchObject({ code: 'invalid-metadata' })
  })

  it('enforces logical capacity and detects stored-byte corruption', async () => {
    const capacityDirectory = new MemoryBinaryDirectory()
    const capacityRepository = new BrowserUserAssetRepository({
      getOpfsDirectory: async () => capacityDirectory,
      storage: null,
      maxEntries: 1,
    })
    await capacityRepository.save(rasterInput({ id: 'one' }))
    await expect(
      capacityRepository.save(rasterInput({ id: 'two' })),
    ).rejects.toMatchObject({ code: 'capacity-limit' })

    const corruptionDirectory = new MemoryBinaryDirectory()
    const corruptionRepository = new BrowserUserAssetRepository({
      getOpfsDirectory: async () => corruptionDirectory,
      storage: null,
    })
    await corruptionRepository.save(rasterInput({ id: 'corrupted' }))
    const name = corruptionDirectory.binaryFileName('.png')
    const changed = png()
    changed[23] ^= 0x01
    corruptionDirectory.corrupt(name, changed)
    await expect(corruptionRepository.get('corrupted')).rejects.toMatchObject({
      code: 'integrity-failed',
    })
  })

  it('reports unsupported persistence when neither OPFS nor fallback exists', async () => {
    const repository = new BrowserUserAssetRepository({
      getOpfsDirectory: null,
      storage: null,
    })
    await expect(repository.save(rasterInput())).rejects.toMatchObject({
      code: 'unsupported',
    })
  })
})
