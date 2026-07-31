import { describe, expect, it } from 'vitest'
import {
  LocalStorageModelConsentRepository,
  type ModelConsentKeyValueStorage,
} from './localStorageConsent'
import type { BackgroundModelConsent } from './modelCache'

const consent = (
  overrides: Partial<BackgroundModelConsent> = {},
): BackgroundModelConsent => ({
  modelId: 'subject-lite',
  version: '1.0.0',
  sizeBytes: 3,
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  grantedAt: '2026-07-31T00:00:00.000Z',
  ...overrides,
})

const memoryStorage = (): ModelConsentKeyValueStorage => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

describe('local storage model consent repository', () => {
  it('persists defensive consent copies across repository instances', async () => {
    const storage = memoryStorage()
    const first = new LocalStorageModelConsentRepository({ storage })
    const original = consent()
    await first.put(original)
    original.version = 'changed'

    const second = new LocalStorageModelConsentRepository({ storage })
    const restored = await second.get('subject-lite')
    expect(restored).toEqual(consent())
    restored!.version = 'also-changed'
    await expect(second.get('subject-lite')).resolves.toEqual(consent())
  })

  it('keeps separate model grants independent and removes exact ids', async () => {
    const storage = memoryStorage()
    const repository = new LocalStorageModelConsentRepository({
      storage,
      prefix: 'test.',
    })
    await repository.put(consent())
    await repository.put(
      consent({
        modelId: 'portrait-pro',
        version: '2',
      }),
    )

    await repository.remove('subject-lite')

    await expect(repository.get('subject-lite')).resolves.toBeNull()
    await expect(repository.get('portrait-pro')).resolves.toMatchObject({
      modelId: 'portrait-pro',
      version: '2',
    })
  })

  it('ignores malformed persisted values and rejects invalid writes', async () => {
    const storage = memoryStorage()
    storage.setItem(
      'test.subject-lite',
      JSON.stringify({ ...consent(), sha256: 'not-a-checksum' }),
    )
    const repository = new LocalStorageModelConsentRepository({
      storage,
      prefix: 'test.',
    })

    await expect(repository.get('subject-lite')).resolves.toBeNull()
    await expect(
      repository.put(consent({ grantedAt: 'not-a-date' })),
    ).rejects.toThrow('consent is invalid')
    await expect(repository.get('../unsafe')).rejects.toThrow('id is invalid')
  })
})
