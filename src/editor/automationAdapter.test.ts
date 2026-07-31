import { FabricImage } from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricEditorEngine, type FabricEditorCallbacks } from './fabricEngine'
import { executeEditorAutomationCommand } from './automationAdapter'

const engines = new Set<FabricEditorEngine>()

const createEngine = (
  callbacks: FabricEditorCallbacks = {},
): FabricEditorEngine => {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const engine = new FabricEditorEngine(canvas, {
    width: 320,
    height: 180,
    callbacks,
  })
  engines.add(engine)
  return engine
}

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const pngHeaderDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('editor automation adapter', () => {
  it('executes resize, text, and watermark commands with semantic results', async () => {
    const engine = createEngine()
    const context = {
      origin: 'replay' as const,
      resultAliases: new Map<string, unknown>(),
    }

    await executeEditorAutomationCommand(
      engine,
      { type: 'resizeCanvas', width: 640, height: 360 },
      context,
    )
    const text = await executeEditorAutomationCommand(
      engine,
      {
        type: 'addText',
        commandId: 'title',
        text: 'Pixelweave',
        x: 20,
        y: 30,
        fill: '#7c3aed',
      },
      context,
    )
    context.resultAliases.set('title', text.result)
    const watermark = await executeEditorAutomationCommand(
      engine,
      {
        type: 'addWatermark',
        text: 'LOCAL',
        position: 'bottomRight',
        opacity: 0.5,
      },
      context,
    )

    expect(engine.getDocumentSize()).toEqual({ width: 640, height: 360 })
    expect(text.result).toEqual(expect.any(String))
    expect(watermark.result).toEqual(expect.any(String))
    expect(engine.getLayers()).toHaveLength(2)
  })

  it('replays full DSL macros with one outer commit, including layer loops and registry filters', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    const imageElement = document.createElement('canvas')
    imageElement.width = 20
    imageElement.height = 10
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValueOnce(
      new FabricImage(imageElement, { width: 20, height: 10 }),
    )
    const imageId = await engine.importImage(pngHeaderDataUrl(20, 10), 'Photo')
    onChanged.mockClear()
    const context = {
      origin: 'replay' as const,
      resultAliases: new Map<string, unknown>(),
    }

    await engine.runAtomic('macro', () =>
      executeEditorAutomationCommand(
        engine,
        {
          type: 'runScript',
          source: `
            editor.resize(640, 360);
            editor.forEachLayer(layer => {
              editor.applyFilter("invert", { amount: 0.5 }, layer.id);
            });
            editor.addText("Macro title", { fill: "#ffffff" });
          `,
        },
        context,
      ),
    )

    expect(engine.getDocumentSize()).toEqual({ width: 640, height: 360 })
    expect(engine.selectLayer(imageId)).toBe(true)
    expect(engine.getSelectedImageFilters()).toMatchObject({ invert: 0.5 })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('macro')
  })

  it('rolls back the entire runScript command when a later DSL operation fails', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    engine.addText('Baseline', { name: 'Baseline' })
    const before = engine.snapshot()
    onChanged.mockClear()
    const context = {
      origin: 'replay' as const,
      resultAliases: new Map<string, unknown>(),
    }

    await expect(
      engine.runAtomic('macro', () =>
        executeEditorAutomationCommand(
          engine,
          {
            type: 'runScript',
            source: `
              editor.addText("Temporary");
              editor.applyFilter("invert", {}, "missing-layer");
            `,
          },
          context,
        ),
      ),
    ).rejects.toThrow(/missing-layer/)

    expect(engine.snapshot()).toEqual(before)
    expect(onChanged).not.toHaveBeenCalled()
  })
})
