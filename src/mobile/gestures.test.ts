import { describe, expect, it } from 'vitest'
import {
  applyTwoPointerGesture,
  calculateTwoPointerGesture,
  longPressShouldOpenContextMenu,
} from './gestures'

describe('two-pointer gestures', () => {
  it('combines pinch zoom and two-finger pan independent of pointer order', () => {
    const gesture = calculateTwoPointerGesture(
      [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 100, y: 0 },
      ],
      [
        { id: 2, x: 130, y: 20 },
        { id: 1, x: 10, y: 20 },
      ],
    )

    expect(gesture).toEqual({
      scale: 1.2,
      panX: 20,
      panY: 20,
      anchorX: 50,
      anchorY: 0,
      previousDistance: 100,
      currentDistance: 120,
    })
  })

  it('zooms around the gesture centroid and honors zoom limits', () => {
    const gesture = {
      scale: 1.2,
      panX: 20,
      panY: 20,
      anchorX: 50,
      anchorY: 0,
      previousDistance: 100,
      currentDistance: 120,
    }

    expect(
      applyTwoPointerGesture({ zoom: 2, panX: 10, panY: 20 }, gesture, {
        minimumZoom: 0.1,
        maximumZoom: 4,
      }),
    ).toEqual({ zoom: 2.4, panX: 22, panY: 44 })
    expect(
      applyTwoPointerGesture({ zoom: 2, panX: 10, panY: 20 }, gesture, {
        minimumZoom: 0.1,
        maximumZoom: 2.1,
      }),
    ).toEqual({ zoom: 2.1, panX: 28, panY: 41 })
  })

  it('rejects pointer replacement and zero-distance pinches', () => {
    expect(() =>
      calculateTwoPointerGesture(
        [
          { id: 1, x: 0, y: 0 },
          { id: 2, x: 10, y: 0 },
        ],
        [
          { id: 1, x: 0, y: 0 },
          { id: 3, x: 10, y: 0 },
        ],
      ),
    ).toThrow('pointer ids changed')
    expect(() =>
      calculateTwoPointerGesture(
        [
          { id: 1, x: 5, y: 5 },
          { id: 2, x: 5, y: 5 },
        ],
        [
          { id: 1, x: 0, y: 0 },
          { id: 2, x: 10, y: 0 },
        ],
      ),
    ).toThrow('positive finite')
  })
})

describe('long-press context-menu gesture', () => {
  it('accepts a stationary touch or pen after the delay', () => {
    expect(
      longPressShouldOpenContextMenu({
        pointerType: 'touch',
        elapsedMs: 500,
        movementPx: 8,
      }),
    ).toBe(true)
    expect(
      longPressShouldOpenContextMenu({
        pointerType: 'pen',
        elapsedMs: 700,
        movementPx: 4,
      }),
    ).toBe(true)
  })

  it('rejects mouse, drag, early release, cancellation, and non-primary input', () => {
    expect(
      longPressShouldOpenContextMenu({
        pointerType: 'mouse',
        elapsedMs: 600,
        movementPx: 0,
      }),
    ).toBe(false)
    expect(
      longPressShouldOpenContextMenu({
        pointerType: 'touch',
        elapsedMs: 600,
        movementPx: 11,
      }),
    ).toBe(false)
    expect(
      longPressShouldOpenContextMenu({
        pointerType: 'touch',
        elapsedMs: 499,
        movementPx: 0,
      }),
    ).toBe(false)
    expect(
      longPressShouldOpenContextMenu({
        pointerType: 'touch',
        elapsedMs: 600,
        movementPx: 0,
        cancelled: true,
      }),
    ).toBe(false)
    expect(
      longPressShouldOpenContextMenu({
        pointerType: 'pen',
        elapsedMs: 600,
        movementPx: 0,
        primaryButton: false,
      }),
    ).toBe(false)
  })
})
