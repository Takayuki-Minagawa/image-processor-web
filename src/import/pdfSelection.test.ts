import { describe, expect, it } from 'vitest'
import { estimatePdfSelection, parsePdfPageRange } from './pdfSelection'

describe('PDF page selection', () => {
  it('keeps source order and de-duplicates ranges', () => {
    expect(parsePdfPageRange('3, 1-3, 5', 5)).toEqual([1, 2, 3, 5])
  })
  it.each(['', '0', '6', '3-1', '1,,2', '1.5', '1-', '1e2', '-1'])(
    'rejects invalid input %s',
    (range) => {
      expect(() => parsePdfPageRange(range, 5)).toThrow('range')
    },
  )
  it('limits selections before iterating potentially huge ranges', () => {
    expect(() => parsePdfPageRange('1-1000000000', 1000000000)).toThrow(
      'selection-limit',
    )
    expect(parsePdfPageRange('1-20', 100)).toHaveLength(20)
  })
  it('estimates the raster workload with one rounding step', () => {
    const result = estimatePdfSelection(
      [{ widthPoints: 595.275590551, heightPoints: 841.88976378 }],
      300,
    )
    expect(result.totalPixels).toBe(2480 * 3508)
    expect(result.largestPixels).toBe(result.totalPixels)
    expect(result.memoryMiB).toBe(Math.ceil((2480 * 3508 * 24) / 1024 / 1024))
  })
  it('rejects unsafe dimensions and aggregate workloads, without reducing DPI', () => {
    expect(() =>
      estimatePdfSelection([{ widthPoints: 8193, heightPoints: 1 }], 72),
    ).toThrow('page-size-limit')
    expect(() =>
      estimatePdfSelection([{ widthPoints: 8192, heightPoints: 8192 }], 72),
    ).toThrow('page-size-limit')
    expect(() =>
      estimatePdfSelection(
        Array(3).fill({ widthPoints: 5000, heightPoints: 5000 }),
        72,
      ),
    ).toThrow('selection-limit')
  })
})
