import { describe, expect, it, vi } from 'vitest'
import {
  applySubjectMask,
  deterministicSubjectMask,
  removeBackground,
  type BackgroundSegmentationAdapter,
} from './segmentation'
import { SelectionMask } from '../selection/mask'

const borderedSubject = () => ({
  width: 3,
  height: 3,
  data: new Uint8ClampedArray([
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255,
  ]),
})

describe('background segmentation', () => {
  it('deterministically separates a subject from its border color', () => {
    const image = borderedSubject()
    const first = deterministicSubjectMask(image, {
      backgroundTolerance: 4,
      edgeSoftness: 8,
    })
    const second = deterministicSubjectMask(image, {
      backgroundTolerance: 4,
      edgeSoftness: 8,
    })

    expect([...first.toBytes()]).toEqual([0, 0, 0, 0, 255, 0, 0, 0, 0])
    expect(first.equals(second)).toBe(true)
  })

  it('multiplies existing alpha by the subject mask', () => {
    const image = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 200, 40, 50, 60, 100]),
    }
    const mask = SelectionMask.fromBytes(2, 1, new Uint8Array([255, 128]))

    expect([...applySubjectMask(image, mask)]).toEqual([
      10, 20, 30, 200, 40, 50, 60, 50,
    ])
    expect([...image.data]).toEqual([10, 20, 30, 200, 40, 50, 60, 100])
  })

  it('normalizes an optional model adapter output into an 8-bit mask', async () => {
    const adapter: BackgroundSegmentationAdapter = {
      id: 'test-adapter',
      segment: vi.fn(async () => new Float32Array([0, 0.49, 0.51, 1])),
    }
    const image = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16).fill(255),
    }

    const result = await removeBackground(
      image,
      { modelThreshold: 0.5, modelSoftness: 0 },
      {},
      adapter,
    )
    expect(result.source).toBe('model')
    expect([...result.mask.toBytes()]).toEqual([0, 0, 255, 255])
  })

  it('uses the deterministic fallback only when explicitly allowed', async () => {
    const adapter: BackgroundSegmentationAdapter = {
      id: 'broken',
      segment: vi.fn(async () => {
        throw new Error('inference failed')
      }),
    }
    await expect(
      removeBackground(borderedSubject(), {}, {}, adapter),
    ).rejects.toThrow('inference failed')

    const result = await removeBackground(
      borderedSubject(),
      {
        fallbackOnModelError: true,
        backgroundTolerance: 4,
        edgeSoftness: 8,
      },
      {},
      adapter,
    )
    expect(result.source).toBe('deterministic-fallback')
    expect(result.warning).toContain('inference failed')
  })

  it('reports progress and respects cancellation', async () => {
    const progress = vi.fn()
    const controller = new AbortController()
    controller.abort()

    await expect(
      removeBackground(
        borderedSubject(),
        {},
        { signal: controller.signal, reportProgress: progress },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
