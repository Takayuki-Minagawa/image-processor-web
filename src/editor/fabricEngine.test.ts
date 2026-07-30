import { FabricImage } from 'fabric'
import { describe, expect, it, vi } from 'vitest'
import { FabricEditorEngine } from './fabricEngine'

const pngHeaderDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('FabricEditorEngine asynchronous selection operations', () => {
  it('cuts the selection captured before cloning instead of a later selection', async () => {
    const original = { id: 'original' }
    const laterSelection = { id: 'later' }
    const clipboardClone = { id: 'clone' }
    let activeObjects = [original]
    let resolveClone!: (objects: object[]) => void
    const clonePromise = new Promise<object[]>((resolve) => {
      resolveClone = resolve
    })
    const remove = vi.fn()
    const discardActiveObject = vi.fn()

    interface CutHarness {
      clipboard: object[]
      pasteGeneration: number
      assertUsable: () => void
      cloneObjects: (objects: object[]) => Promise<object[]>
      mutate: (reason: string, mutation: () => void) => void
      emitStatus: (message: string, kind: string) => void
      canvas: {
        getActiveObjects: () => object[]
        getObjects: () => object[]
        discardActiveObject: () => void
        remove: (...objects: object[]) => void
      }
    }

    const harness: CutHarness = {
      clipboard: [],
      pasteGeneration: 8,
      assertUsable: vi.fn(),
      cloneObjects: vi.fn(() => clonePromise),
      mutate: vi.fn((_reason, mutation) => mutation()),
      emitStatus: vi.fn(),
      canvas: {
        getActiveObjects: () => activeObjects,
        getObjects: () => [original, laterSelection],
        discardActiveObject,
        remove,
      },
    }
    const cutSelection = FabricEditorEngine.prototype
      .cutSelection as unknown as (this: CutHarness) => Promise<boolean>

    const pendingCut = cutSelection.call(harness)
    expect(harness.cloneObjects).toHaveBeenCalledWith([original])

    activeObjects = [laterSelection]
    resolveClone([clipboardClone])

    await expect(pendingCut).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith(original)
    expect(remove).not.toHaveBeenCalledWith(laterSelection)
    expect(discardActiveObject).not.toHaveBeenCalled()
    expect(harness.clipboard).toEqual([clipboardClone])
    expect(harness.pasteGeneration).toBe(0)
  })
})

describe('FabricEditorEngine clipboard lifecycle', () => {
  it('keeps copied objects across a document clear and resets paste offset', () => {
    const copied = { id: 'copied' }
    const documentObject = { id: 'document-object' }

    interface ClearHarness {
      clipboard: object[]
      pasteGeneration: number
      documentWidth: number
      documentHeight: number
      assertUsable: () => void
      mutate: (reason: string, mutation: () => void) => void
      setDocumentClip: () => void
      canvas: {
        getObjects: () => object[]
        discardActiveObject: () => void
        remove: (...objects: object[]) => void
      }
    }

    const harness: ClearHarness = {
      clipboard: [copied],
      pasteGeneration: 12,
      documentWidth: 1_280,
      documentHeight: 720,
      assertUsable: vi.fn(),
      mutate: vi.fn((_reason, mutation) => mutation()),
      setDocumentClip: vi.fn(),
      canvas: {
        getObjects: () => [documentObject],
        discardActiveObject: vi.fn(),
        remove: vi.fn(),
      },
    }
    const clear = FabricEditorEngine.prototype.clear as unknown as (
      this: ClearHarness,
      width?: number,
      height?: number,
    ) => void

    clear.call(harness, 640, 480)

    expect(harness.clipboard).toEqual([copied])
    expect(harness.pasteGeneration).toBe(0)
    expect(harness.documentWidth).toBe(640)
    expect(harness.documentHeight).toBe(480)
  })

  it('wraps repeated paste offsets instead of growing without bound', async () => {
    const offsets: number[] = []
    const clone = {
      getBoundingRect: () => ({
        left: 0,
        top: 0,
        width: 20,
        height: 20,
      }),
    }

    interface PasteHarness {
      clipboard: object[]
      pasteGeneration: number
      documentWidth: number
      documentHeight: number
      assertUsable: () => void
      cloneObjects: () => Promise<object[]>
      nextPasteOffset: (objects: object[], offset: number) => number
      layerNames: () => Set<string>
      preparePastedObject: (
        object: object,
        offset: number,
        names: Set<string>,
      ) => void
      mutate: (reason: string, mutation: () => void) => void
      activateObjects: (objects: object[]) => void
      requireEditorId: () => string
      canvas: {
        discardActiveObject: () => void
        add: (...objects: object[]) => void
      }
    }

    const harness: PasteHarness = {
      clipboard: [{}],
      pasteGeneration: 0,
      documentWidth: 100,
      documentHeight: 100,
      assertUsable: vi.fn(),
      cloneObjects: vi.fn(async () => [clone]),
      nextPasteOffset: (
        FabricEditorEngine.prototype as unknown as {
          nextPasteOffset: (
            this: PasteHarness,
            objects: object[],
            offset: number,
          ) => number
        }
      ).nextPasteOffset,
      layerNames: () => new Set(),
      preparePastedObject: vi.fn((_object, offset) => offsets.push(offset)),
      mutate: vi.fn((_reason, mutation) => mutation()),
      activateObjects: vi.fn(),
      requireEditorId: () => 'pasted',
      canvas: {
        discardActiveObject: vi.fn(),
        add: vi.fn(),
      },
    }
    const pasteSelection = FabricEditorEngine.prototype
      .pasteSelection as unknown as (
      this: PasteHarness,
      offset?: number,
    ) => Promise<string[]>

    for (let count = 0; count < 6; count += 1) {
      await pasteSelection.call(harness)
    }

    expect(offsets[0]).toBe(16)
    expect(offsets[4]).toBe(80)
    expect(offsets[5]).toBe(16)

    harness.pasteGeneration = 0
    expect(
      harness.nextPasteOffset(
        [
          clone,
          {
            getBoundingRect: () => ({
              left: 90,
              top: 90,
              width: 10,
              height: 10,
            }),
          },
        ],
        16,
      ),
    ).toBe(0)
  })
})

describe('FabricEditorEngine image import', () => {
  it('resizes an empty document from the one Fabric decode', async () => {
    const image = {
      width: 20,
      height: 10,
      left: 0,
      top: 0,
      set: vi.fn(),
      editorId: undefined as string | undefined,
    }
    const fromUrl = vi
      .spyOn(FabricImage, 'fromURL')
      .mockResolvedValue(image as unknown as FabricImage)

    interface ImportHarness {
      documentWidth: number
      documentHeight: number
      assertUsable: () => void
      uniqueLayerName: (name: string) => string
      initializeEditorObject: (object: typeof image, name: string) => void
      mutate: (reason: string, mutation: () => void) => void
      setDocumentClip: () => void
      emitStatus: (message: string, kind: string) => void
      requireEditorId: (object: typeof image) => string
      canvas: {
        getObjects: () => object[]
        add: (object: typeof image) => void
        setActiveObject: (object: typeof image) => void
      }
    }

    const harness: ImportHarness = {
      documentWidth: 1_280,
      documentHeight: 720,
      assertUsable: vi.fn(),
      uniqueLayerName: (name) => name,
      initializeEditorObject: (object) => {
        object.editorId = 'image-id'
      },
      mutate: vi.fn((_reason, mutation) => mutation()),
      setDocumentClip: vi.fn(),
      emitStatus: vi.fn(),
      requireEditorId: (object) => object.editorId ?? '',
      canvas: {
        getObjects: () => [],
        add: vi.fn(),
        setActiveObject: vi.fn(),
      },
    }
    const importImage = FabricEditorEngine.prototype.importImage as unknown as (
      this: ImportHarness,
      dataUrl: string,
      name?: string,
      options?: { resizeCanvasIfEmpty?: boolean },
    ) => Promise<string>

    try {
      await expect(
        importImage.call(
          harness,
          pngHeaderDataUrl(image.width, image.height),
          'Photo',
          { resizeCanvasIfEmpty: true },
        ),
      ).resolves.toBe('image-id')
      expect(fromUrl).toHaveBeenCalledOnce()
    } finally {
      fromUrl.mockRestore()
    }

    expect(harness.documentWidth).toBe(20)
    expect(harness.documentHeight).toBe(10)
    expect(harness.setDocumentClip).toHaveBeenCalledOnce()
    expect(harness.mutate).toHaveBeenCalledWith(
      'object-added',
      expect.any(Function),
    )
  })
})

describe('FabricEditorEngine object normalization', () => {
  it('does not scan layer names for an object that is already named', () => {
    const object = {
      editorId: 'id',
      editorName: 'Existing name',
      editorLocked: false,
    }

    interface NormalizeHarness {
      uniqueLayerName: (name: string) => string
      defaultNameForObject: () => string
      configureSingleObjectInteractivity: (value: typeof object) => void
    }

    const harness: NormalizeHarness = {
      uniqueLayerName: vi.fn((name) => name),
      defaultNameForObject: vi.fn(() => 'Layer'),
      configureSingleObjectInteractivity: vi.fn(),
    }
    const normalizeEditorObject = (
      FabricEditorEngine.prototype as unknown as {
        normalizeEditorObject: (
          this: NormalizeHarness,
          value: typeof object,
        ) => typeof object
      }
    ).normalizeEditorObject

    expect(normalizeEditorObject.call(harness, object)).toBe(object)
    expect(harness.uniqueLayerName).not.toHaveBeenCalled()
    expect(harness.defaultNameForObject).not.toHaveBeenCalled()
  })
})
