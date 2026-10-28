import { Group, Rect } from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareSvgNativeImport } from '../import/svgGeometry'
import { FabricEditorEngine } from './fabricEngine'
import { createSvgDesignPage } from './svgPageAdapter'
import {
  createProjectDocument,
  parseProject,
  serializeProject,
} from './project'
import type { JsonObject } from './types'

const svg = (
  attributes: string,
  children = '<rect x="10" y="20" width="20" height="30" stroke-width="0"/>',
) => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${children}</svg>`

afterEach(() => vi.restoreAllMocks())

describe('native SVG page adapter', () => {
  it('keeps basic group selectors scoped to authored groups', async () => {
    const geometry = prepareSvgNativeImport(
      svg(
        'width="200" height="100" viewBox="0 0 100 100"',
        '<style>g {fill: red; opacity: .5; transform: translate(25, 0)}</style><rect x="10" y="20" width="20" height="10" stroke-width="0"/><g><rect x="10" y="20" width="20" height="10" stroke-width="0"/></g>',
      ),
    )
    const page = await createSvgDesignPage(geometry)
    const engine = new FabricEditorEngine(document.createElement('canvas'))
    try {
      await engine.restore(page.snapshot)
      const group = engine.getCanvas().getObjects()[0] as Group
      const [direct, authoredGroupChild] = group.getObjects()
      expect(direct.fill).toBe('rgb(0,0,0)')
      expect(direct.opacity).toBe(1)
      expect(direct.calcTransformMatrix()).toEqual([1, 0, 0, 1, 70, 25])
      expect(authoredGroupChild.fill).toBe('red')
      expect(authoredGroupChild.opacity).toBe(0.5)
      expect(authoredGroupChild.calcTransformMatrix()).toEqual([
        1, 0, 0, 1, 95, 25,
      ])
    } finally {
      await engine.dispose()
    }
  })

  it('applies root attributes and inline transforms outside the viewport mapping', async () => {
    const geometry = prepareSvgNativeImport(
      svg(
        'width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none" transform="scale(9)" fill="blue" style="transform: matrix(2,0,0,2,10,5)"',
      ),
    )
    const page = await createSvgDesignPage(geometry)
    expect(page.snapshot.json.objects).toEqual([
      expect.objectContaining({
        fill: 'blue',
        left: 50,
        top: 45,
        scaleX: 4,
        scaleY: 2,
      }),
    ])
  })

  it('protects the viewport mapping from Fabric case-insensitive CSS selector matching', async () => {
    const geometry = prepareSvgNativeImport(
      svg(
        'id="DRAWING" width="200" height="100" viewBox="0 0 100 100"',
        '<style>#drawing {transform: translate(25, 0)}</style><rect x="10" y="20" width="20" height="10" stroke-width="0"/>',
      ),
    )
    const page = await createSvgDesignPage(geometry)
    expect(page.snapshot.json.objects).toEqual([
      expect.objectContaining({ left: 60, top: 20, scaleX: 1, scaleY: 1 }),
    ])
  })

  it('creates an editable physical-size page and preserves it through project serialization', async () => {
    const geometry = prepareSvgNativeImport(
      svg('width="210mm" height="297mm" viewBox="0 0 210 297"'),
    )
    const dispose = vi.spyOn(FabricEditorEngine.prototype, 'dispose')
    const page = await createSvgDesignPage(geometry, {
      id: 'svg-page',
      name: 'Drawing',
    })
    expect(dispose).toHaveBeenCalledOnce()
    expect(page).toMatchObject({
      id: 'svg-page',
      name: 'Drawing',
      snapshot: { width: 794, height: 1123 },
      background: { kind: 'transparent' },
      physicalSize: { unit: 'mm', widthMm: 210, heightMm: 297, sourceDpi: 96 },
    })
    const object = (page.snapshot.json.objects as JsonObject[])[0]
    expect(object.type).toBe('Rect')
    expect(object.editorLocked).toBe(false)
    expect(object.left).toBeCloseTo((10 * 96) / 25.4, 3)
    expect(object.top).toBeCloseTo((20 * 96) / 25.4, 3)
    expect(object.scaleX).toBeCloseTo(96 / 25.4, 3)
    expect(object.scaleY).toBeCloseTo(96 / 25.4, 3)
    expect(page.snapshot.editorState?.pdfImport).toBeUndefined()
    expect(page.snapshot.json.background).toBe('transparent')
    const project = createProjectDocument({
      canvasSize: { width: page.snapshot.width, height: page.snapshot.height },
      fabricCanvas: page.snapshot.json as JsonObject,
      editorState: page.snapshot.editorState,
      physicalSize: page.physicalSize,
      background: page.background,
    })
    expect(project.pages[0].background).toEqual({ kind: 'transparent' })
    expect(parseProject(serializeProject(project))).toEqual(project)
    expect(serializeProject(project)).not.toContain('<svg')
  })

  it.each([
    [
      'meet',
      '0 0 100 100',
      'xMidYMid meet',
      { left: 60, top: 20, scaleX: 1, scaleY: 1 },
    ],
    [
      'slice',
      '0 0 100 100',
      'xMidYMid slice',
      { left: 20, top: -10, scaleX: 2, scaleY: 2 },
    ],
    [
      'none',
      '0 0 100 100',
      'none',
      { left: 20, top: 20, scaleX: 2, scaleY: 1 },
    ],
    [
      'offset viewBox',
      '10 20 100 100',
      'xMaxYMin meet',
      { left: 100, top: 0, scaleX: 1, scaleY: 1 },
    ],
  ])(
    'retains %s viewport positioning without fitting to the object bounds',
    async (_name, viewBox, aspectRatio, expected) => {
      const geometry = prepareSvgNativeImport(
        svg(
          `width="200px" height="100px" viewBox="${viewBox}" preserveAspectRatio="${aspectRatio}"`,
        ),
      )
      const page = await createSvgDesignPage(geometry)
      expect(page.physicalSize).toBeUndefined()
      expect(page.snapshot.json.objects).toEqual([
        expect.objectContaining(expected),
      ])
    },
  )

  it('preserves sparse artwork margins and multi-object world coordinates after reopening', async () => {
    const geometry = prepareSvgNativeImport(
      svg(
        'width="200" height="100" viewBox="0 0 100 100"',
        '<rect x="0" y="10" width="20" height="20" stroke-width="0"/><rect x="70" y="50" width="20" height="10" stroke-width="0"/>',
      ),
    )
    const page = await createSvgDesignPage(geometry)
    const engine = new FabricEditorEngine(document.createElement('canvas'))
    try {
      await engine.restore(page.snapshot)
      const group = engine.getCanvas().getObjects()[0] as Group
      expect(group).toBeInstanceOf(Group)
      expect(
        group.getObjects().map((object) => object.calcTransformMatrix()),
      ).toEqual([
        [1, 0, 0, 1, 60, 20],
        [1, 0, 0, 1, 130, 55],
      ])
      expect(engine.getDocumentSize()).toEqual({ width: 200, height: 100 })
    } finally {
      await engine.dispose()
    }
  })

  it('rejects an invalid page before allocating its renderer', async () => {
    const geometry = prepareSvgNativeImport(svg('width="200" height="100"'))
    const dispose = vi.spyOn(FabricEditorEngine.prototype, 'dispose')
    await expect(
      createSvgDesignPage({
        ...geometry,
        physicalSize: {
          unit: 'mm',
          widthMm: 210,
          heightMm: 297,
          sourceDpi: 96,
        },
      }),
    ).rejects.toThrow(/does not match/u)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('cleans up a failed renderer without touching an existing document', async () => {
    const live = new FabricEditorEngine(document.createElement('canvas'), {
      width: 123,
      height: 456,
    })
    const selected = live.addRect({ name: 'Existing' })
    const before = live.snapshot()
    const geometry = prepareSvgNativeImport(svg('width="200" height="100"'))
    vi.spyOn(Rect, 'fromElement').mockRejectedValue(
      new Error('Invalid artwork'),
    )
    const dispose = vi.spyOn(FabricEditorEngine.prototype, 'dispose')
    try {
      await expect(createSvgDesignPage(geometry)).rejects.toThrow(
        'Invalid artwork',
      )
      expect(dispose).toHaveBeenCalledOnce()
      expect(live.snapshot()).toEqual(before)
      expect(live.getSelectedLayerIds()).toEqual([selected])
    } finally {
      await live.dispose()
    }
  })

  it('honors cancellation both before allocation and during final cleanup', async () => {
    const geometry = prepareSvgNativeImport(svg('width="200" height="100"'))
    const controller = new AbortController()
    controller.abort()
    const dispose = vi.spyOn(FabricEditorEngine.prototype, 'dispose')
    await expect(
      createSvgDesignPage(geometry, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(dispose).not.toHaveBeenCalled()
    const duringCleanup = new AbortController()
    dispose.mockRestore()
    const realDispose = FabricEditorEngine.prototype.dispose
    vi.spyOn(FabricEditorEngine.prototype, 'dispose').mockImplementation(
      async function (this: FabricEditorEngine) {
        await realDispose.call(this)
        duringCleanup.abort()
      },
    )
    await expect(
      createSvgDesignPage(geometry, { signal: duringCleanup.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
