import { Ellipse, Group, Rect } from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricEditorEngine } from './fabricEngine'

const engines = new Set<FabricEditorEngine>()

const createEngine = (onChanged = vi.fn()) => {
  const engine = new FabricEditorEngine(document.createElement('canvas'), {
    width: 200,
    height: 100,
    callbacks: { onChanged },
  })
  engines.add(engine)
  return engine
}

const svg = (children: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">${children}</svg>`

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  vi.restoreAllMocks()
})

describe('FabricEditorEngine SVG placement', () => {
  it('keeps a singleton at its native viewport position without a second scale', async () => {
    const engine = createEngine()
    await engine.importSvg(
      svg(
        '<g transform="matrix(2 0 0 3 -10 5)"><rect x="20" y="10" width="30" height="15" stroke-width="0"/></g>',
      ),
      'Native',
      { placement: 'native' },
    )
    const object = engine.getCanvas().getObjects()[0]
    expect(object.getBoundingRect()).toEqual({
      left: 30,
      top: 35,
      width: 60,
      height: 45,
    })
    expect(object.scaleX).toBe(2)
    expect(object.scaleY).toBe(3)
    expect(object.originX).toBe('left')
    expect(object.originY).toBe('top')
  })

  it('keeps all child world transforms when grouping and normalizing origins', async () => {
    const engine = createEngine()
    await engine.importSvg(
      svg(
        '<g transform="translate(50 0)"><rect x="0" y="10" width="20" height="20" stroke-width="0"/><rect x="70" y="50" width="20" height="10" stroke-width="0"/></g>',
      ),
      'Native',
      { placement: 'native' },
    )
    const grouped = engine.getCanvas().getObjects()[0] as Group
    expect(grouped).toBeInstanceOf(Group)
    expect(
      grouped.getObjects().map((object) => object.calcTransformMatrix()),
    ).toEqual([
      [1, 0, 0, 1, 60, 20],
      [1, 0, 0, 1, 130, 55],
    ])
    expect(grouped.getBoundingRect()).toEqual({
      left: 50,
      top: 10,
      width: 90,
      height: 50,
    })
    const before = engine.snapshot()
    await engine.restore(before)
    const restored = engine.getCanvas().getObjects()[0] as Group
    expect(
      restored.getObjects().map((object) => object.calcTransformMatrix()),
    ).toEqual([
      [1, 0, 0, 1, 60, 20],
      [1, 0, 0, 1, 130, 55],
    ])
  })

  it('retains the existing centered 82 percent fit by default', async () => {
    const engine = createEngine()
    await engine.importSvg(
      svg('<rect x="20" y="30" width="400" height="100" stroke-width="0"/>'),
    )
    const bounds = engine.getCanvas().getObjects()[0].getBoundingRect()
    expect(bounds.left).toBeCloseTo(18)
    expect(bounds.top).toBeCloseTo(29.5)
    expect(bounds.width).toBeCloseTo(164)
    expect(bounds.height).toBeCloseTo(41)
  })

  it('cancels after parsing without mutating the document or selection', async () => {
    const changed = vi.fn()
    const engine = createEngine(changed)
    const selected = engine.addRect({ left: 1, top: 2, width: 3, height: 4 })
    const before = engine.snapshot()
    changed.mockClear()
    const controller = new AbortController()
    const object = new Rect({ width: 20, height: 10 })
    const dispose = vi.spyOn(object, 'dispose')
    vi.spyOn(Rect, 'fromElement').mockImplementation(async () => {
      controller.abort()
      return object
    })
    await expect(
      engine.importSvg(svg('<rect width="20" height="10"/>'), 'Native', {
        placement: 'native',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(engine.snapshot()).toEqual(before)
    expect(engine.getSelectedLayerIds()).toEqual([selected])
    expect(changed).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('disposes late successful siblings when another SVG element fails', async () => {
    const engine = createEngine()
    const before = engine.snapshot()
    const object = new Ellipse({ rx: 10, ry: 5 })
    const dispose = vi.spyOn(object, 'dispose')
    let resolve!: (value: Ellipse) => void
    const delayed = new Promise<Ellipse>((complete) => {
      resolve = complete
    })
    vi.spyOn(Rect, 'fromElement').mockRejectedValue(
      new Error('Failed SVG element'),
    )
    vi.spyOn(Ellipse, 'fromElement').mockReturnValue(delayed)
    await expect(
      engine.importSvg(
        svg('<rect width="1" height="1"/><ellipse rx="10" ry="5"/>'),
        'Native',
        {
          placement: 'native',
        },
      ),
    ).rejects.toThrow('Failed SVG element')
    resolve(object)
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    expect(engine.snapshot()).toEqual(before)
  })
})
