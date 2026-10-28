// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  PDF_LIMITS,
  pdfPageInfoFromViewport,
  pdfRasterDimensions,
} from './pdfGeometry'

function geometryPdf(pageDictionary: string): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << >> ${pageDictionary} >>`,
  ]
  let content = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(content.length)
    content += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = content.length
  content += 'xref\n0 4\n0000000000 65535 f \n'
  content += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  content += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(content)
}

describe('PDF physical geometry with the pinned PDF.js display API', () => {
  it.each([0, 90, 180, 270])(
    'applies offset CropBox, UserUnit and %i degree rotation exactly once',
    async (rotation) => {
      const task = getDocument({
        data: geometryPdf(
          `/MediaBox [0 0 400 600] /CropBox [30 50 230 350] /Rotate ${rotation} /UserUnit 2`,
        ),
      })
      try {
        const document = await task.promise
        const page = await document.getPage(1)
        const viewport = page.getViewport({ scale: 1 })
        const info = pdfPageInfoFromViewport(1, viewport, page.rotate)
        const sideways = rotation === 90 || rotation === 270
        expect(info.widthPoints).toBe(sideways ? 600 : 400)
        expect(info.heightPoints).toBe(sideways ? 400 : 600)
        expect(info.widthMm).toBeCloseTo((info.widthPoints * 25.4) / 72, 10)
        expect(info.heightMm).toBeCloseTo((info.heightPoints * 25.4) / 72, 10)
        const corners = [
          viewport.convertToViewportPoint(30, 50),
          viewport.convertToViewportPoint(230, 350),
        ]
        expect(Math.min(...corners.map(([x]) => x))).toBe(0)
        expect(Math.min(...corners.map(([, y]) => y))).toBe(0)
        expect(Math.max(...corners.map(([x]) => x))).toBe(info.widthPoints)
        expect(Math.max(...corners.map(([, y]) => y))).toBe(info.heightPoints)
        expect(pdfRasterDimensions(info, 150)).toEqual({
          width: Math.round((info.widthPoints * 150) / 72),
          height: Math.round((info.heightPoints * 150) / 72),
        })
      } finally {
        await task.destroy()
      }
    },
  )

  it('uses the intersection of a CropBox extending beyond MediaBox', async () => {
    const task = getDocument({
      data: geometryPdf('/MediaBox [0 0 400 600] /CropBox [-20 50 500 700]'),
    })
    try {
      const page = await (await task.promise).getPage(1)
      expect(page.view).toEqual([0, 50, 400, 600])
      const info = pdfPageInfoFromViewport(
        1,
        page.getViewport({ scale: 1 }),
        page.rotate,
      )
      expect(info.widthPoints).toBe(400)
      expect(info.heightPoints).toBe(550)
    } finally {
      await task.destroy()
    }
  })

  it('retains unrounded millimetres while rounding only raster pixels', () => {
    const info = pdfPageInfoFromViewport(
      1,
      { width: (210 * 72) / 25.4, height: (297 * 72) / 25.4 },
      0,
    )
    expect(info.widthMm).toBeCloseTo(210, 12)
    expect(info.heightMm).toBeCloseTo(297, 12)
    expect(pdfRasterDimensions(info, 150)).toEqual({
      width: 1240,
      height: 1754,
    })
    expect(pdfRasterDimensions(info, 300)).toEqual({
      width: 2480,
      height: 3508,
    })
  })

  it('rejects unsafe dimensions instead of reducing DPI', () => {
    for (const [widthPoints, heightPoints, dpi] of [
      [8193, 1, 72],
      [8192, 4097, 72],
      [1, 1, Number.POSITIVE_INFINITY],
      [1, 1, 0],
      [Number.NaN, 1, 72],
    ]) {
      expect(() =>
        pdfRasterDimensions({ widthPoints, heightPoints }, dpi),
      ).toThrow('page-size-limit')
    }
    expect(
      pdfRasterDimensions({ widthPoints: 8192, heightPoints: 4096 }, 72),
    ).toEqual({ width: 8192, height: 4096 })
    expect(PDF_LIMITS.maxSelectedPages).toBe(20)
  })
})
