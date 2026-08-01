import { describe, expect, it, vi } from 'vitest'
import {
  MemoryBinaryDirectory,
  MemoryBinaryStorage,
} from '../test/fixtures/binaryRepository'
import { loadUserFontFace } from './userFontMetadata'
import {
  BrowserUserFontRepository,
  type SaveUserFontInput,
} from './userFontRepository'

const fontBytes = (
  format: 'woff2' | 'ttf' | 'otf' = 'woff2',
  byteLength = 64,
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(byteLength)
  if (format === 'woff2') bytes.set([0x77, 0x4f, 0x46, 0x32])
  if (format === 'ttf') bytes.set([0x00, 0x01, 0x00, 0x00])
  if (format === 'otf') bytes.set([0x4f, 0x54, 0x54, 0x4f])
  bytes.fill(0x5a, 4)
  return bytes
}

const fontInput = (
  overrides: Partial<SaveUserFontInput> = {},
): SaveUserFontInput => ({
  family: 'Local Sans',
  fileName: 'local-sans.woff2',
  bytes: fontBytes(),
  licenseAcknowledged: true,
  ...overrides,
})

describe('BrowserUserFontRepository', () => {
  it('validates, hashes, stores, lists, reads, and removes WOFF2 bytes in OPFS', async () => {
    const directory = new MemoryBinaryDirectory()
    const repository = new BrowserUserFontRepository({
      getOpfsDirectory: async () => directory,
      storage: null,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    })

    const saved = await repository.save(
      fontInput({
        id: 'local-sans',
        displayName: 'Local Sans Display',
        weightMinimum: 100,
        weightMaximum: 900,
      }),
    )

    expect(saved).toMatchObject({
      backend: 'opfs',
      metadata: {
        id: 'local-sans',
        family: 'Local Sans',
        displayName: 'Local Sans Display',
        format: 'woff2',
        byteLength: 64,
        weightMinimum: 100,
        weightMaximum: 900,
        addedAt: '2026-08-01T00:00:00.000Z',
      },
    })
    expect(saved.metadata.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(await repository.list()).toEqual([saved.metadata])

    const stored = await repository.get('local-sans')
    expect(new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))).toEqual(
      fontBytes(),
    )
    expect(await repository.remove('local-sans')).toBe(true)
    expect(await repository.get('local-sans')).toBeNull()
  })

  it('returns bytes directly usable by loadUserFontFace', async () => {
    const directory = new MemoryBinaryDirectory()
    const repository = new BrowserUserFontRepository({
      getOpfsDirectory: async () => directory,
      storage: null,
    })
    const saved = await repository.save(fontInput({ id: 'loadable-font' }))
    const stored = await repository.get(saved.metadata.id)
    if (!stored) throw new Error('Expected the stored font.')

    const face = { load: vi.fn() }
    face.load.mockResolvedValue(face)
    const createFontFace = vi.fn().mockReturnValue(face)
    const fontSet = { add: vi.fn() }

    await expect(
      loadUserFontFace(stored.metadata, stored.bytes, {
        createFontFace,
        fontSet,
      }),
    ).resolves.toBe(face)
    expect(createFontFace).toHaveBeenCalledWith(
      'Local Sans',
      stored.bytes,
      expect.objectContaining({ style: 'normal', weight: '400' }),
    )
    expect(fontSet.add).toHaveBeenCalledWith(face)
  })

  it('accepts known TTF and OTF signatures and rejects mismatches', async () => {
    const directory = new MemoryBinaryDirectory()
    const repository = new BrowserUserFontRepository({
      getOpfsDirectory: async () => directory,
      storage: null,
    })

    await expect(
      repository.save(
        fontInput({
          id: 'local-ttf',
          fileName: 'local.ttf',
          bytes: fontBytes('ttf'),
        }),
      ),
    ).resolves.toMatchObject({ metadata: { format: 'ttf' } })
    await expect(
      repository.save(
        fontInput({
          id: 'local-otf',
          fileName: 'local.otf',
          bytes: fontBytes('otf'),
        }),
      ),
    ).resolves.toMatchObject({ metadata: { format: 'otf' } })
    await expect(
      repository.save(fontInput({ fileName: 'wrong.ttf', format: 'woff2' })),
    ).rejects.toMatchObject({ code: 'unsupported-format' })
    await expect(
      repository.save(fontInput({ bytes: new Uint8Array([1, 2, 3, 4]) })),
    ).rejects.toMatchObject({ code: 'invalid-font' })
  })

  it('retains bytes in bounded localStorage and exposes overflow explicitly', async () => {
    const storage = new MemoryBinaryStorage()
    const first = new BrowserUserFontRepository({
      getOpfsDirectory: null,
      storage,
    })
    const saved = await first.save(fontInput({ id: 'fallback-font' }))
    const reopened = new BrowserUserFontRepository({
      getOpfsDirectory: null,
      storage,
    })

    expect(saved.backend).toBe('localStorage')
    expect(
      new Uint8Array(
        (await reopened.get('fallback-font'))?.bytes ?? new ArrayBuffer(0),
      ),
    ).toEqual(fontBytes())
    expect(storage.getItem('pixelweave:user-fonts:v1')).toContain('bytes')

    const bounded = new BrowserUserFontRepository({
      getOpfsDirectory: null,
      storage: new MemoryBinaryStorage(),
      maxFallbackEntryBytes: 63,
    })
    await expect(bounded.save(fontInput())).rejects.toMatchObject({
      code: 'fallback-limit',
    })
  })

  it('reports unsupported persistence when neither OPFS nor fallback exists', async () => {
    const repository = new BrowserUserFontRepository({
      getOpfsDirectory: null,
      storage: null,
    })
    await expect(repository.save(fontInput())).rejects.toMatchObject({
      code: 'unsupported',
    })
  })
})
