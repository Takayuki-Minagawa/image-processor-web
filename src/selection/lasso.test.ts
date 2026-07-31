import { describe, expect, it } from 'vitest'
import { appendDistinctLassoPoint, clientPointToDocumentPoint } from './lasso'
import { SelectionMask } from './mask'
import { traceSelectionBoundary } from './marchingAnts'

describe('lasso document coordinates', () => {
  it('maps rendered pointer positions into document space and clamps edges', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 }

    expect(clientPointToDocumentPoint(110, 70, rect, 1000, 400)).toEqual({
      x: 500,
      y: 200,
    })
    expect(clientPointToDocumentPoint(-30, 200, rect, 1000, 400)).toEqual({
      x: 0,
      y: 400,
    })
  })

  it('coalesces nearby pointer samples without mutating the source points', () => {
    const source = [{ x: 1, y: 1 }]
    expect(appendDistinctLassoPoint(source, { x: 1.2, y: 1.2 }, 1)).toEqual(
      source,
    )
    expect(appendDistinctLassoPoint(source, { x: 3, y: 4 }, 1)).toEqual([
      ...source,
      { x: 3, y: 4 },
    ])
    expect(source).toEqual([{ x: 1, y: 1 }])
  })
})

describe('marching-ants boundary tracing', () => {
  it('traces the selected pixel edges and reports preview sampling metadata', () => {
    const mask = SelectionMask.fromBytes(
      3,
      2,
      new Uint8Array([0, 255, 0, 0, 0, 0]),
    )
    const boundary = traceSelectionBoundary(mask)

    expect(boundary.path).toContain('M1 0H2')
    expect(boundary.path).toContain('M2 0V1')
    expect(boundary.path).toContain('M2 1H1')
    expect(boundary.path).toContain('M1 1V0')
    expect(boundary).toMatchObject({
      segmentCount: 4,
      sampleStep: 1,
      truncated: false,
    })
  })

  it('bounds SVG work for large or complex masks', () => {
    const boundary = traceSelectionBoundary(
      SelectionMask.fromBytes(
        4,
        4,
        new Uint8Array([
          255, 0, 255, 0, 0, 255, 0, 255, 255, 0, 255, 0, 0, 255, 0, 255,
        ]),
      ),
      { maximumSegments: 3, maximumSampleCells: 4 },
    )

    expect(boundary.segmentCount).toBe(3)
    expect(boundary.sampleStep).toBe(2)
    expect(boundary.truncated).toBe(true)
  })
})
