import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PdfSession } from '../import/pdf'
import type { PdfPageInfo } from '../import/pdfGeometry'
import { createPdfComparison, type ComparisonCapture } from './pdfComparison'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const setup = (
  options: {
    failDecode?: number
    abortDecode?: number
    controller?: AbortController
  } = {},
) => {
  const fixtures = new Map<string, HTMLCanvasElement>()
  const makePng = (colors: readonly string[]) => {
    const canvas = document.createElement('canvas')
    canvas.width = colors.length
    canvas.height = 1
    const context = canvas.getContext('2d')!
    colors.forEach((color, index) => {
      context.fillStyle = color
      context.fillRect(index, 0, 1, 1)
    })
    const url = canvas.toDataURL('image/png')
    fixtures.set(url, canvas)
    return url
  }
  const current: ComparisonCapture = {
    dataUrl: makePng(['#ff0000', 'transparent']),
    width: 2,
    height: 1,
    documentWidth: 200,
    documentHeight: 100,
    name: 'Current page',
    physicalSize: { unit: 'mm', widthMm: 200, heightMm: 100, sourceDpi: 25.4 },
    sourcePageNumber: 1,
  }
  const referenceUrl = makePng(['#ff0000', '#0000ff'])
  const info: PdfPageInfo = {
    pageNumber: 5,
    widthMm: 200,
    heightMm: 100,
    widthPoints: (200 * 72) / 25.4,
    heightPoints: (100 * 72) / 25.4,
    rotation: 90,
  }
  const session: PdfSession = {
    pageCount: 5,
    getPageInfo: vi.fn(async () => info),
    renderPage: vi.fn(async (_page, dpi) => ({
      ...info,
      width: 2,
      height: 1,
      dpi,
      dataUrl: referenceUrl,
    })),
    thumbnail: vi.fn(),
    destroy: vi.fn(),
  }
  const created: HTMLCanvasElement[] = []
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const element = create(tag, options)
    if (tag === 'canvas') created.push(element as HTMLCanvasElement)
    return element
  })
  const encoded = new Map<string, number[]>()
  const encode = HTMLCanvasElement.prototype.toDataURL
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    function (this: HTMLCanvasElement, ...args) {
      const url = encode.apply(this, args)
      encoded.set(url, [
        ...this.getContext('2d')!.getImageData(0, 0, this.width, this.height)
          .data,
      ])
      return url
    },
  )
  let decodeCount = 0
  vi.stubGlobal(
    'Image',
    class {
      constructor() {
        const canvas = document.createElement('canvas')
        const index = ++decodeCount
        Object.defineProperty(canvas, 'src', {
          set(source: string) {
            if (!source) {
              canvas.width = 0
              canvas.height = 0
              return
            }
            const fixture = fixtures.get(source)!
            canvas.width = fixture.width
            canvas.height = fixture.height
            canvas.getContext('2d')!.drawImage(fixture, 0, 0)
            queueMicrotask(() => {
              if (options.abortDecode === index) options.controller!.abort()
              else
                canvas.dispatchEvent(
                  new Event(options.failDecode === index ? 'error' : 'load'),
                )
            })
          },
        })
        return canvas
      }
    },
  )
  return { current, session, info, created, encoded }
}

describe('PDF original-page comparison', () => {
  it('compares the selected PDF page on white and produces opaque RGB absolute differences', async () => {
    const { current, session, created, encoded } = setup()
    const before = structuredClone(current)
    const result = await createPdfComparison(
      current,
      session,
      5,
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      alignment: 'matched',
      currentWidth: 2,
      currentHeight: 1,
      referenceWidth: 2,
      referenceHeight: 1,
    })
    expect(encoded.get(result.currentUrl)).toEqual([
      255, 0, 0, 255, 255, 255, 255, 255,
    ])
    expect(encoded.get(result.referenceUrl)).toEqual([
      255, 0, 0, 255, 0, 0, 255, 255,
    ])
    expect(encoded.get(result.differenceUrl!)).toEqual([
      0, 0, 0, 255, 255, 255, 0, 255,
    ])
    expect(session.getPageInfo).toHaveBeenCalledWith(5)
    expect(session.renderPage).toHaveBeenCalledWith(
      5,
      0.254,
      expect.any(AbortSignal),
    )
    expect(session.destroy).not.toHaveBeenCalled()
    expect(
      created.every((canvas) => canvas.width === 0 && canvas.height === 0),
    ).toBe(true)
    expect(current).toEqual(before)
  })

  it.each([
    [200.1, 100, 'matched'],
    [200.11, 100, 'size-mismatch'],
    [200, 100.11, 'size-mismatch'],
    [100, 200, 'size-mismatch'],
  ] as const)(
    'classifies current physical dimensions %s × %s as %s',
    async (widthMm, heightMm, alignment) => {
      const { current, session } = setup()
      current.physicalSize = { ...current.physicalSize!, widthMm, heightMm }
      const result = await createPdfComparison(
        current,
        session,
        5,
        new AbortController().signal,
      )
      expect(result.alignment).toBe(alignment)
      expect(Boolean(result.differenceUrl)).toBe(alignment === 'matched')
    },
  )

  it('does not treat drastically different tiny physical pages as matching', async () => {
    const { current, session, info } = setup()
    current.physicalSize = {
      ...current.physicalSize!,
      widthMm: 0.01,
      heightMm: 0.01,
    }
    info.widthMm = 0.1
    info.heightMm = 0.1
    const result = await createPdfComparison(
      current,
      session,
      5,
      new AbortController().signal,
    )
    expect(result.alignment).toBe('size-mismatch')
    expect(result.differenceUrl).toBeUndefined()
  })

  it('keeps unknown-size pages side by side without inferring size from source page metadata', async () => {
    const { current, session, info } = setup()
    delete current.physicalSize
    const result = await createPdfComparison(
      current,
      session,
      5,
      new AbortController().signal,
    )
    expect(result.alignment).toBe('unknown-size')
    expect(result.differenceUrl).toBeUndefined()
    expect(session.renderPage).toHaveBeenCalledWith(
      5,
      (1_600 / info.widthPoints) * 72,
      expect.any(AbortSignal),
    )
  })

  it.each([
    { width: 1_601 },
    { height: 0 },
    { width: 1 },
    { dataUrl: 'https://example.com/source.png' },
    { dataUrl: `data:image/png;base64,${'A'.repeat(16 * 1024 * 1024)}` },
  ])(
    'rejects unsafe or inconsistent current previews before reading the PDF',
    async (update) => {
      const { current, session } = setup()
      await expect(
        createPdfComparison(
          { ...current, ...update },
          session,
          5,
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      expect(session.getPageInfo).not.toHaveBeenCalled()
      expect(session.renderPage).not.toHaveBeenCalled()
    },
  )

  it('rejects an already cancelled request before reading the PDF', async () => {
    const { current, session } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(
      createPdfComparison(current, session, 5, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.getPageInfo).not.toHaveBeenCalled()
  })

  it('rejects cancellation after PDF rendering before decoding previews', async () => {
    const { current, session, created } = setup()
    const controller = new AbortController()
    const render = session.renderPage
    session.renderPage = vi.fn(
      async (...args: Parameters<PdfSession['renderPage']>) => {
        const result = await render(...args)
        controller.abort()
        return result
      },
    )
    await expect(
      createPdfComparison(current, session, 5, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(created).toEqual([])
  })

  it.each(['abort', 'error'] as const)(
    'releases decoded images and canvases when the reference image ends in %s',
    async (failure) => {
      const controller = new AbortController()
      const { current, session, created } = setup({
        controller,
        ...(failure === 'abort' ? { abortDecode: 2 } : { failDecode: 2 }),
      })
      await expect(
        createPdfComparison(current, session, 5, controller.signal),
      ).rejects.toMatchObject({
        name: failure === 'abort' ? 'AbortError' : 'TypeError',
      })
      expect(created.length).toBeGreaterThan(0)
      expect(
        created.every((canvas) => canvas.width === 0 && canvas.height === 0),
      ).toBe(true)
    },
  )
})
