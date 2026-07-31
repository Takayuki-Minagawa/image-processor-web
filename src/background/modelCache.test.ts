import { describe, expect, it, vi } from 'vitest'
import {
  ConsentAwareBackgroundModelCache,
  MemoryBinaryModelRepository,
  MemoryModelConsentRepository,
  OpfsModelRepository,
  sha256Hex,
  verifyBackgroundModelBytes,
  type BackgroundModelDescriptor,
} from './modelCache'

const abcHash =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const descriptor = (): BackgroundModelDescriptor => ({
  id: 'subject-lite',
  version: '1.0.0',
  sizeBytes: 3,
  sha256: abcHash,
  downloadUrl: '/models/subject-lite.onnx',
})

const abc = (): Uint8Array => new TextEncoder().encode('abc')

describe('background model cache', () => {
  it('calculates and verifies a stable SHA-256 checksum', async () => {
    await expect(sha256Hex(abc())).resolves.toBe(abcHash)
    await expect(
      verifyBackgroundModelBytes(descriptor(), abc()),
    ).resolves.toBeUndefined()
    await expect(
      verifyBackgroundModelBytes(descriptor(), new TextEncoder().encode('abd')),
    ).rejects.toMatchObject({
      code: 'model-checksum-mismatch',
    })
  })

  it('requires explicit consent before the first download', async () => {
    const download = vi.fn(async () => abc())
    const cache = new ConsentAwareBackgroundModelCache({
      now: () => '2026-07-31T00:00:00.000Z',
    })

    await expect(
      cache.getOrDownload(descriptor(), download),
    ).rejects.toMatchObject({
      code: 'consent-required',
    })
    expect(download).not.toHaveBeenCalled()

    await expect(cache.grantConsent(descriptor())).resolves.toMatchObject({
      modelId: 'subject-lite',
      grantedAt: '2026-07-31T00:00:00.000Z',
    })
    await expect(
      cache.getOrDownload(descriptor(), download),
    ).resolves.toSatisfy((bytes: Uint8Array) =>
      [...bytes].every((value, index) => value === abc()[index]),
    )
    expect(download).toHaveBeenCalledOnce()
  })

  it('reuses a verified cached model offline and returns defensive copies', async () => {
    const models = new MemoryBinaryModelRepository()
    const consents = new MemoryModelConsentRepository()
    const cache = new ConsentAwareBackgroundModelCache({
      models,
      consents,
    })
    const download = vi.fn(async () => abc())
    await cache.grantConsent(descriptor())
    const first = await cache.getOrDownload(descriptor(), download)
    first[0] = 0

    await cache.revoke(descriptor(), false)
    const offlineDownload = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(
      cache.getOrDownload(descriptor(), offlineDownload),
    ).resolves.toSatisfy((bytes: Uint8Array) =>
      [...bytes].every((value, index) => value === abc()[index]),
    )
    expect(offlineDownload).not.toHaveBeenCalled()
  })

  it('evicts corrupt cached bytes before a verified replacement', async () => {
    const models = new MemoryBinaryModelRepository()
    await models.put(descriptor(), new TextEncoder().encode('abd'))
    const cache = new ConsentAwareBackgroundModelCache({ models })
    await cache.grantConsent(descriptor())
    const download = vi.fn(async () => abc())

    await expect(
      cache.getOrDownload(descriptor(), download),
    ).resolves.toSatisfy((bytes: Uint8Array) =>
      [...bytes].every((value, index) => value === abc()[index]),
    )
    expect(download).toHaveBeenCalledOnce()
  })

  it('falls back to memory when OPFS is unavailable', async () => {
    const fallback = new MemoryBinaryModelRepository()
    const repository = new OpfsModelRepository(async () => {
      throw new DOMException('blocked', 'SecurityError')
    }, fallback)

    await repository.put(descriptor(), abc())
    expect([...(await repository.get(descriptor()))!]).toEqual([...abc()])
    await repository.remove(descriptor())
    await expect(repository.get(descriptor())).resolves.toBeNull()
  })
})
