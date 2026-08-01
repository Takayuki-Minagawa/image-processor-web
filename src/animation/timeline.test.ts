import { describe, expect, it } from 'vitest'
import {
  evaluateEasing,
  evaluateElementAnimations,
  evaluatePresentationTimeline,
  resolveAnimationSchedule,
  resolvePresentationTimeline,
  type ElementAnimationClip,
} from './timeline'

describe('element animation timeline', () => {
  const clips: ElementAnimationClip[] = [
    {
      id: 'title-in',
      elementId: 'title',
      phase: 'enter',
      effect: 'fade',
      start: { mode: 'with-page', delayMs: 100 },
      durationMs: 400,
      easing: 'linear',
    },
    {
      id: 'photo-in',
      elementId: 'photo',
      phase: 'enter',
      effect: 'slide-left',
      start: { mode: 'after-previous', delayMs: 50 },
      durationMs: 500,
      easing: 'linear',
      distancePx: 64,
    },
  ]

  it('resolves with-page and after-previous timing deterministically', () => {
    const schedule = resolveAnimationSchedule(clips)

    expect(
      schedule.map(({ id, startMs, endMs }) => ({ id, startMs, endMs })),
    ).toEqual([
      { id: 'title-in', startMs: 100, endMs: 500 },
      { id: 'photo-in', startMs: 550, endMs: 1050 },
    ])
  })

  it('evaluates visibility and transforms from a page-local clock', () => {
    const schedule = resolveAnimationSchedule(clips)

    expect(evaluateElementAnimations(['title', 'photo'], schedule, 0)).toEqual([
      expect.objectContaining({
        elementId: 'title',
        visible: false,
        opacity: 0,
      }),
      expect.objectContaining({
        elementId: 'photo',
        visible: false,
        translateX: 64,
      }),
    ])
    expect(
      evaluateElementAnimations(['title'], schedule, 300)[0],
    ).toMatchObject({
      visible: true,
      opacity: 0.5,
      activeClipIds: ['title-in'],
    })
    expect(
      evaluateElementAnimations(['photo'], schedule, 800)[0],
    ).toMatchObject({
      visible: true,
      translateX: 32,
      activeClipIds: ['photo-in'],
    })
    expect(
      evaluateElementAnimations(['title', 'photo'], schedule, 1_100),
    ).toEqual([
      expect.objectContaining({ opacity: 1, visible: true }),
      expect.objectContaining({ translateX: 0, visible: true }),
    ])
  })

  it('composes emphasis and exit states without Fabric.js', () => {
    const schedule = resolveAnimationSchedule([
      {
        id: 'pulse',
        elementId: 'badge',
        phase: 'emphasis',
        effect: 'pulse',
        start: { mode: 'with-page' },
        durationMs: 1_000,
        easing: 'linear',
      },
      {
        id: 'leave',
        elementId: 'badge',
        phase: 'exit',
        effect: 'fade',
        start: { mode: 'after-previous' },
        durationMs: 500,
        easing: 'linear',
      },
    ])

    const emphasized = evaluateElementAnimations(['badge'], schedule, 500)[0]
    expect(emphasized.scaleX).toBeCloseTo(1.1)
    expect(emphasized.visible).toBe(true)

    const leaving = evaluateElementAnimations(['badge'], schedule, 1_250)[0]
    expect(leaving.opacity).toBeCloseTo(0.5)
    expect(leaving.visible).toBe(true)

    const left = evaluateElementAnimations(['badge'], schedule, 1_500)[0]
    expect(left.opacity).toBe(0)
    expect(left.visible).toBe(false)
  })

  it('clamps easing and rejects ambiguous clip schedules', () => {
    expect(evaluateEasing('ease-in', -1)).toBe(0)
    expect(evaluateEasing('ease-out', 2)).toBe(1)
    expect(evaluateEasing('ease-in-out', 0.25)).toBe(0.125)
    expect(() => resolveAnimationSchedule([...clips, clips[0]])).toThrow(
      'duplicated',
    )
  })
})

describe('page transition timeline', () => {
  const timeline = resolvePresentationTimeline([
    {
      id: 'cover',
      durationMs: 3_000,
      transitionToNext: {
        type: 'fade',
        durationMs: 1_000,
        easing: 'linear',
      },
    },
    {
      id: 'details',
      durationMs: 2_000,
      transitionToNext: {
        type: 'slide-left',
        durationMs: 500,
        easing: 'linear',
      },
    },
    { id: 'end', durationMs: 1_000 },
  ])

  it('overlaps adjacent pages and calculates the total duration', () => {
    expect(
      timeline.pages.map(({ id, startMs, endMs }) => ({
        id,
        startMs,
        endMs,
      })),
    ).toEqual([
      { id: 'cover', startMs: 0, endMs: 3_000 },
      { id: 'details', startMs: 2_000, endMs: 4_000 },
      { id: 'end', startMs: 3_500, endMs: 4_500 },
    ])
    expect(timeline.totalDurationMs).toBe(4_500)
  })

  it('evaluates fade and slide transitions from the shared playhead', () => {
    expect(evaluatePresentationTimeline(timeline, 2_500).pages).toEqual([
      expect.objectContaining({
        pageId: 'cover',
        localTimeMs: 2_500,
        opacity: 0.5,
      }),
      expect.objectContaining({
        pageId: 'details',
        localTimeMs: 500,
        opacity: 0.5,
      }),
    ])

    expect(evaluatePresentationTimeline(timeline, 3_750).pages).toEqual([
      expect.objectContaining({
        pageId: 'details',
        translateXPercent: -50,
      }),
      expect.objectContaining({ pageId: 'end', translateXPercent: 50 }),
    ])
  })

  it('clamps preview and export clocks to identical endpoints', () => {
    expect(evaluatePresentationTimeline(timeline, -50)).toMatchObject({
      timeMs: 0,
      pages: [expect.objectContaining({ pageId: 'cover' })],
    })
    expect(evaluatePresentationTimeline(timeline, 9_000)).toMatchObject({
      timeMs: 4_500,
      pages: [
        expect.objectContaining({
          pageId: 'end',
          localTimeMs: 1_000,
        }),
      ],
    })
  })

  it('normalizes adjacent transitions so at most two pages are active', () => {
    const normalized = resolvePresentationTimeline([
      {
        id: 'one',
        durationMs: 250,
        transitionToNext: { type: 'fade', durationMs: 250 },
      },
      {
        id: 'two',
        durationMs: 250,
        transitionToNext: { type: 'fade', durationMs: 250 },
      },
      { id: 'three', durationMs: 250 },
    ])

    expect(normalized.pages[0].transitionToNext?.durationMs).toBe(125)
    expect(normalized.pages[1].transitionToNext?.durationMs).toBe(125)
    expect(evaluatePresentationTimeline(normalized, 250).pages).toHaveLength(2)
  })
})
