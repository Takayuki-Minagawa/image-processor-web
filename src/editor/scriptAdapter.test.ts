import { FabricImage, IText } from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEditorScript } from '../scripting/parser'
import type { EditorScriptProgram } from '../scripting/types'
import { createIdentityCurve, type FilterOperation } from './filters/types'
import {
  FabricEditorEngine,
  type FabricEditorCallbacks,
  type ImageFilterSettings,
} from './fabricEngine'
import {
  EditorScriptExecutionError,
  executeEditorScript,
  filterOperationToImageFilterSettings,
} from './scriptAdapter'

const engines = new Set<FabricEditorEngine>()

const createEngine = (
  callbacks: FabricEditorCallbacks = {},
): FabricEditorEngine => {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const engine = new FabricEditorEngine(canvas, {
    width: 200,
    height: 150,
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

const imageElement = (width = 20, height = 10): HTMLCanvasElement => {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return element
}

const importTwoImages = async (
  engine: FabricEditorEngine,
): Promise<[string, string]> => {
  const first = new FabricImage(imageElement(), { width: 20, height: 10 })
  const second = new FabricImage(imageElement(), { width: 20, height: 10 })
  vi.spyOn(FabricImage, 'fromURL')
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const firstId = await engine.importImage(
    pngHeaderDataUrl(20, 10),
    'First image',
  )
  const secondId = await engine.importImage(
    pngHeaderDataUrl(20, 10),
    'Second image',
  )
  return [firstId, secondId]
}

const selectedFilters = (
  engine: FabricEditorEngine,
  id: string,
): Required<ImageFilterSettings> => {
  expect(engine.selectLayer(id)).toBe(true)
  const settings = engine.getSelectedImageFilters()
  expect(settings).not.toBeNull()
  return settings!
}

describe('editor script adapter', () => {
  it('commits the complete script as one script change', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })

    const result = await executeEditorScript(
      engine,
      parseEditorScript(`
        editor.resize(640, 360);
        editor.addText("Pixelweave", {
          left: 24,
          top: 36,
          fill: "#ffffff",
          fontSize: 48,
          name: "Script title"
        });
      `),
    )

    expect(engine.getDocumentSize()).toEqual({ width: 640, height: 360 })
    expect(engine.getCanvas().getObjects()[0]).toBeInstanceOf(IText)
    expect(engine.getLayers()[0]).toMatchObject({
      name: 'Script title',
      type: 'text',
    })
    expect(result).toMatchObject({
      executedCommands: 2,
      addedLayerIds: [engine.getLayers()[0].id],
      affectedLayerIds: [engine.getLayers()[0].id],
    })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('script')
  })

  it('resolves an explicit layer id without filtering the selected sibling', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    const [firstId, secondId] = await importTwoImages(engine)
    onChanged.mockClear()

    const result = await executeEditorScript(
      engine,
      parseEditorScript(
        `editor.applyFilter("invert", { amount: 0.4 }, "${firstId}");`,
      ),
    )

    expect(selectedFilters(engine, firstId).invert).toBe(0.4)
    expect(selectedFilters(engine, secondId).invert).toBe(0)
    expect(result.affectedLayerIds).toEqual([firstId])
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('script')
  })

  it('resolves current layer id and name bindings over a layer snapshot', async () => {
    const engine = createEngine()
    const [firstId, secondId] = await importTwoImages(engine)
    const program: EditorScriptProgram = {
      schemaVersion: 1,
      commands: [
        {
          type: 'forEachLayer',
          binding: 'layer',
          commands: [
            {
              type: 'applyFilter',
              operation: { id: 'sharpen', params: { amount: 0.4 } },
              targetLayer: {
                kind: 'current-layer',
                binding: 'layer',
                property: 'id',
              },
            },
            {
              type: 'applyFilter',
              operation: { id: 'sepia', params: { amount: 0.3 } },
              targetLayer: {
                kind: 'current-layer',
                binding: 'layer',
                property: 'name',
              },
            },
          ],
        },
      ],
    }

    const result = await executeEditorScript(engine, program)

    for (const id of [firstId, secondId]) {
      expect(selectedFilters(engine, id)).toMatchObject({
        sharpen: 0.4,
        sepia: 0.3,
      })
    }
    expect(new Set(result.affectedLayerIds)).toEqual(
      new Set([firstId, secondId]),
    )
    expect(result.executedCommands).toBe(5)
  })

  it('rolls back earlier commands and restores selection after a failure', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    const baselineId = engine.addText('Baseline', { name: 'Baseline' })
    const before = engine.snapshot()
    onChanged.mockClear()

    const execution = executeEditorScript(
      engine,
      parseEditorScript(`
          editor.addText("Temporary", { name: "Temporary" });
          editor.applyFilter("invert", {}, "missing-layer");
        `),
    )
    await expect(execution).rejects.toBeInstanceOf(EditorScriptExecutionError)
    await expect(execution).rejects.toMatchObject({
      name: 'EditorScriptExecutionError',
      code: 'target-not-found',
    })

    expect(engine.snapshot()).toEqual(before)
    expect(engine.getSelectedLayerIds()).toEqual([baselineId])
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('rejects forged commands before opening an editor transaction', async () => {
    const engine = createEngine()
    const runAtomic = vi.spyOn(engine, 'runAtomic')
    const forged = {
      schemaVersion: 1,
      commands: [{ type: 'resizeCanvas', width: 20_000, height: 1 }],
    } as unknown as EditorScriptProgram

    await expect(executeEditorScript(engine, forged)).rejects.toMatchObject({
      name: 'EditorScriptExecutionError',
      code: 'invalid-command',
    })
    expect(runAtomic).not.toHaveBeenCalled()
    expect(engine.getDocumentSize()).toEqual({ width: 200, height: 150 })
  })
})

describe('script filter projection', () => {
  const brighterCurve = (): number[] =>
    createIdentityCurve().map((value) => Math.min(255, value + 24))

  const projections: Array<{
    operation: FilterOperation
    setting: keyof Required<ImageFilterSettings>
    expected: number
  }> = [
    {
      operation: { id: 'sharpen', params: { amount: 1.25 } },
      setting: 'sharpen',
      expected: 1.25,
    },
    {
      operation: { id: 'emboss', params: { strength: 3 } },
      setting: 'emboss',
      expected: 2,
    },
    {
      operation: {
        id: 'noise',
        params: { amount: 0.2, seed: 7, monochrome: true },
      },
      setting: 'noise',
      expected: 0.2,
    },
    {
      operation: { id: 'pixelate', params: { size: 200 } },
      setting: 'pixelate',
      expected: 128,
    },
    {
      operation: { id: 'sepia', params: { amount: 0.45 } },
      setting: 'sepia',
      expected: 0.45,
    },
    {
      operation: { id: 'invert', params: { amount: 0.6 } },
      setting: 'invert',
      expected: 0.6,
    },
    {
      operation: {
        id: 'levels',
        params: {
          inputBlack: 10,
          inputWhite: 240,
          gamma: 1.7,
          outputBlack: 0,
          outputWhite: 255,
        },
      },
      setting: 'gamma',
      expected: 1.7,
    },
    {
      operation: {
        id: 'curves',
        params: {
          master: brighterCurve(),
          red: createIdentityCurve(),
          green: createIdentityCurve(),
          blue: createIdentityCurve(),
        },
      },
      setting: 'brightness',
      expected: 24 / 255,
    },
    {
      operation: {
        id: 'white-balance',
        params: { temperature: 0.35, tint: -0.2 },
      },
      setting: 'temperature',
      expected: 0.35,
    },
    {
      operation: {
        id: 'vignette',
        params: {
          amount: 0.55,
          midpoint: 0.5,
          softness: 0.4,
          color: { r: 0, g: 0, b: 0 },
        },
      },
      setting: 'vignette',
      expected: 0.55,
    },
    {
      operation: {
        id: 'gradient-map',
        params: {
          stops: [
            { offset: 0, color: { r: 0, g: 0, b: 0 } },
            { offset: 1, color: { r: 255, g: 255, b: 255 } },
          ],
        },
      },
      setting: 'duotone',
      expected: 1,
    },
    {
      operation: {
        id: 'duotone',
        params: {
          shadows: { r: 0, g: 0, b: 0 },
          highlights: { r: 255, g: 255, b: 255 },
        },
      },
      setting: 'duotone',
      expected: 1,
    },
    {
      operation: {
        id: 'halftone',
        params: {
          size: 9,
          angle: 45,
          foreground: { r: 0, g: 0, b: 0 },
          background: { r: 255, g: 255, b: 255 },
        },
      },
      setting: 'halftone',
      expected: 0.5,
    },
    {
      operation: {
        id: 'glitch',
        params: { amount: 0.7, offset: 12, scanlines: 0.3, seed: 9 },
      },
      setting: 'glitch',
      expected: 0.7,
    },
  ]

  it.each(projections)(
    'projects $operation.id into existing image settings',
    ({ operation, setting, expected }) => {
      const settings = filterOperationToImageFilterSettings(operation)
      expect(settings[setting]).toBeCloseTo(expected)
    },
  )
})
