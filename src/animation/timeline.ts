export type AnimationEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export type ElementAnimationPhase = 'enter' | 'emphasis' | 'exit'

export type ElementAnimationEffect =
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom'
  | 'wipe-left'
  | 'wipe-right'
  | 'pulse'

export type AnimationStart =
  | { mode: 'with-page'; delayMs?: number }
  | { mode: 'after-previous'; delayMs?: number }

export interface ElementAnimationClip {
  id: string
  elementId: string
  phase: ElementAnimationPhase
  effect: ElementAnimationEffect
  start: AnimationStart
  durationMs: number
  easing?: AnimationEasing
  distancePx?: number
}

export interface ResolvedElementAnimationClip extends ElementAnimationClip {
  startMs: number
  endMs: number
}

export interface EvaluatedElementState {
  elementId: string
  visible: boolean
  opacity: number
  translateX: number
  translateY: number
  scaleX: number
  scaleY: number
  clipProgress: number
  clipDirection?: 'left' | 'right'
  activeClipIds: string[]
}

export type PageTransitionType = 'none' | 'fade' | 'slide-left' | 'slide-right'

export interface PageTransition {
  type: PageTransitionType
  durationMs: number
  easing?: AnimationEasing
}

export interface PresentationPage {
  id: string
  durationMs: number
  transitionToNext?: PageTransition
  elementIds?: readonly string[]
  animations?: readonly ElementAnimationClip[]
}

export interface ResolvedPresentationPage extends PresentationPage {
  index: number
  startMs: number
  endMs: number
  resolvedAnimations: readonly ResolvedElementAnimationClip[]
}

export interface ResolvedPresentationTimeline {
  pages: readonly ResolvedPresentationPage[]
  totalDurationMs: number
}

export interface EvaluatedPageState {
  pageId: string
  pageIndex: number
  localTimeMs: number
  opacity: number
  translateXPercent: number
  elements: EvaluatedElementState[]
}

export interface EvaluatedPresentationState {
  timeMs: number
  totalDurationMs: number
  pages: EvaluatedPageState[]
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const assertNonNegativeFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number.`)
  }
}

const assertPositiveFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`)
  }
}

export const evaluateEasing = (
  easing: AnimationEasing,
  progress: number,
): number => {
  const value = clamp01(progress)
  switch (easing) {
    case 'linear':
      return value
    case 'ease-in':
      return value * value
    case 'ease-out':
      return 1 - (1 - value) ** 2
    case 'ease-in-out':
      return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2
  }
}

/** Resolves relative starts in stable clip order without renderer state. */
export const resolveAnimationSchedule = (
  clips: readonly ElementAnimationClip[],
): ResolvedElementAnimationClip[] => {
  const ids = new Set<string>()
  let previousEndMs = 0
  return clips.map((clip, index) => {
    if (!clip.id || !clip.elementId) {
      throw new TypeError(
        `Animation clip ${index + 1} needs an id and elementId.`,
      )
    }
    if (ids.has(clip.id)) {
      throw new TypeError(`Animation clip id "${clip.id}" is duplicated.`)
    }
    ids.add(clip.id)
    assertPositiveFinite(clip.durationMs, `Animation clip ${clip.id} duration`)
    const delayMs = clip.start.delayMs ?? 0
    assertNonNegativeFinite(delayMs, `Animation clip ${clip.id} delay`)
    if (clip.distancePx !== undefined) {
      assertNonNegativeFinite(
        clip.distancePx,
        `Animation clip ${clip.id} distance`,
      )
    }

    const startMs =
      (clip.start.mode === 'after-previous' ? previousEndMs : 0) + delayMs
    const resolved = { ...clip, startMs, endMs: startMs + clip.durationMs }
    previousEndMs = resolved.endMs
    return resolved
  })
}

const neutralElementState = (elementId: string): EvaluatedElementState => ({
  elementId,
  visible: true,
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1,
  clipProgress: 1,
  activeClipIds: [],
})

const phaseAmount = (
  phase: ElementAnimationPhase,
  progress: number,
): number => {
  switch (phase) {
    case 'enter':
      return 1 - progress
    case 'exit':
      return progress
    case 'emphasis':
      return Math.sin(Math.PI * progress)
  }
}

const applyClip = (
  state: EvaluatedElementState,
  clip: ResolvedElementAnimationClip,
  timeMs: number,
): void => {
  const rawProgress = clamp01(
    (timeMs - clip.startMs) / (clip.endMs - clip.startMs),
  )
  const progress = evaluateEasing(clip.easing ?? 'ease-in-out', rawProgress)
  const amount = phaseAmount(clip.phase, progress)
  const distance = clip.distancePx ?? 64

  if (clip.phase === 'enter' && timeMs < clip.startMs) state.visible = false
  if (clip.phase === 'enter' && timeMs >= clip.startMs) state.visible = true
  if (clip.phase === 'exit' && timeMs >= clip.endMs) state.visible = false
  if (timeMs >= clip.startMs && timeMs < clip.endMs) {
    state.activeClipIds.push(clip.id)
  }

  switch (clip.effect) {
    case 'fade':
      state.opacity *= clip.phase === 'emphasis' ? 1 - amount * 0.2 : 1 - amount
      break
    case 'slide-left':
    case 'slide-right':
    case 'slide-up':
    case 'slide-down': {
      const horizontal =
        clip.effect === 'slide-left' || clip.effect === 'slide-right'
      const direction =
        clip.effect === 'slide-left' || clip.effect === 'slide-up' ? -1 : 1
      const offset =
        clip.phase === 'enter'
          ? -direction * amount * distance
          : direction * amount * distance
      if (horizontal) state.translateX += offset
      else state.translateY += offset
      break
    }
    case 'zoom': {
      const scale =
        clip.phase === 'emphasis' ? 1 + amount * 0.08 : 1 - amount * 0.2
      state.scaleX *= scale
      state.scaleY *= scale
      break
    }
    case 'wipe-left':
    case 'wipe-right':
      state.clipProgress = Math.min(
        state.clipProgress,
        clip.phase === 'emphasis' ? 1 : 1 - amount,
      )
      state.clipDirection = clip.effect === 'wipe-left' ? 'left' : 'right'
      break
    case 'pulse': {
      const scale = 1 + amount * 0.1
      state.scaleX *= scale
      state.scaleY *= scale
      break
    }
  }
}

/** Evaluates all transforms at one page-local timestamp. */
export const evaluateElementAnimations = (
  elementIds: readonly string[],
  schedule: readonly ResolvedElementAnimationClip[],
  timeMs: number,
): EvaluatedElementState[] => {
  assertNonNegativeFinite(timeMs, 'Animation time')
  const orderedIds = [...elementIds]
  for (const clip of schedule) {
    if (!orderedIds.includes(clip.elementId)) orderedIds.push(clip.elementId)
  }

  return orderedIds.map((elementId) => {
    const state = neutralElementState(elementId)
    for (const clip of schedule) {
      if (clip.elementId === elementId) applyClip(state, clip, timeMs)
    }
    state.opacity = clamp01(state.opacity)
    state.clipProgress = clamp01(state.clipProgress)
    return state
  })
}

const transitionDuration = (page: PresentationPage): number =>
  page.transitionToNext?.type === 'none'
    ? 0
    : (page.transitionToNext?.durationMs ?? 0)

/**
 * Shortens adjacent transitions proportionally so no page can overlap both of
 * its neighbours at once. Only durations are reduced; page and animation
 * timing otherwise remains unchanged.
 */
export const normalizePresentationTransitions = (
  pages: readonly PresentationPage[],
): PresentationPage[] => {
  const normalized = pages.map((page, index) => {
    const transition = page.transitionToNext
    if (!transition || index === pages.length - 1) return { ...page }
    const durationMs =
      transition.type === 'none'
        ? 0
        : Math.min(
            transition.durationMs,
            page.durationMs,
            pages[index + 1].durationMs,
          )
    return {
      ...page,
      transitionToNext: { ...transition, durationMs },
    }
  })

  for (let index = 1; index < normalized.length - 1; index += 1) {
    const incoming = transitionDuration(normalized[index - 1])
    const outgoing = transitionDuration(normalized[index])
    const adjacentDuration = incoming + outgoing
    if (adjacentDuration <= normalized[index].durationMs) continue

    const scale = normalized[index].durationMs / adjacentDuration
    const normalizedIncoming = incoming * scale
    const normalizedOutgoing = normalized[index].durationMs - normalizedIncoming
    const incomingTransition = normalized[index - 1].transitionToNext
    const outgoingTransition = normalized[index].transitionToNext
    if (incomingTransition && incomingTransition.type !== 'none') {
      normalized[index - 1] = {
        ...normalized[index - 1],
        transitionToNext: {
          ...incomingTransition,
          durationMs: normalizedIncoming,
        },
      }
    }
    if (outgoingTransition && outgoingTransition.type !== 'none') {
      normalized[index] = {
        ...normalized[index],
        transitionToNext: {
          ...outgoingTransition,
          durationMs: normalizedOutgoing,
        },
      }
    }
  }

  return normalized
}

/**
 * Page durations include their transition overlap. Adjacent transition
 * durations may not overlap each other, so at most two pages are ever active.
 */
export const resolvePresentationTimeline = (
  pages: readonly PresentationPage[],
): ResolvedPresentationTimeline => {
  if (pages.length === 0) {
    throw new RangeError('A presentation must contain at least one page.')
  }
  const ids = new Set<string>()
  pages.forEach((page, index) => {
    if (!page.id || ids.has(page.id)) {
      throw new TypeError(`Presentation page ${index + 1} needs a unique id.`)
    }
    ids.add(page.id)
    assertPositiveFinite(page.durationMs, `Page ${page.id} duration`)
    if (page.transitionToNext) {
      assertNonNegativeFinite(
        page.transitionToNext.durationMs,
        `Page ${page.id} transition duration`,
      )
      if (
        page.transitionToNext.type !== 'none' &&
        page.transitionToNext.durationMs === 0
      ) {
        throw new RangeError(
          `Page ${page.id} transition duration must be positive.`,
        )
      }
    }
  })
  if (transitionDuration(pages.at(-1)!) > 0) {
    throw new RangeError('The last page cannot transition to a missing page.')
  }

  const normalizedPages = normalizePresentationTransitions(pages)

  for (let index = 0; index < normalizedPages.length; index += 1) {
    const incoming =
      index === 0 ? 0 : transitionDuration(normalizedPages[index - 1])
    const outgoing = transitionDuration(normalizedPages[index])
    if (incoming + outgoing > normalizedPages[index].durationMs) {
      throw new RangeError(
        `Page ${normalizedPages[index].id} is too short for its adjacent transitions.`,
      )
    }
  }

  const resolved: ResolvedPresentationPage[] = []
  let startMs = 0
  normalizedPages.forEach((page, index) => {
    const endMs = startMs + page.durationMs
    resolved.push({
      ...page,
      index,
      startMs,
      endMs,
      resolvedAnimations: resolveAnimationSchedule(page.animations ?? []),
    })
    startMs = endMs - transitionDuration(page)
  })

  return {
    pages: resolved,
    totalDurationMs: resolved.at(-1)!.endMs,
  }
}

const applyTransition = (
  outgoing: EvaluatedPageState,
  incoming: EvaluatedPageState,
  transition: PageTransition,
  rawProgress: number,
): void => {
  const progress = evaluateEasing(
    transition.easing ?? 'ease-in-out',
    rawProgress,
  )
  switch (transition.type) {
    case 'none':
      return
    case 'fade':
      outgoing.opacity *= 1 - progress
      incoming.opacity *= progress
      return
    case 'slide-left':
      outgoing.translateXPercent -= progress * 100
      incoming.translateXPercent += (1 - progress) * 100
      return
    case 'slide-right':
      outgoing.translateXPercent += progress * 100
      incoming.translateXPercent -= (1 - progress) * 100
      return
  }
}

/** Evaluates page transitions and per-element presets from the same clock. */
export const evaluatePresentationTimeline = (
  timeline: ResolvedPresentationTimeline,
  timeMs: number,
): EvaluatedPresentationState => {
  if (!Number.isFinite(timeMs)) {
    throw new RangeError('Presentation time must be finite.')
  }
  const clampedTime = Math.min(timeline.totalDurationMs, Math.max(0, timeMs))
  const lastIndex = timeline.pages.length - 1
  const states = timeline.pages
    .filter(
      (page) =>
        clampedTime >= page.startMs &&
        (clampedTime < page.endMs ||
          (page.index === lastIndex && clampedTime === page.endMs)),
    )
    .map<EvaluatedPageState>((page) => {
      const localTimeMs = Math.min(
        page.durationMs,
        Math.max(0, clampedTime - page.startMs),
      )
      return {
        pageId: page.id,
        pageIndex: page.index,
        localTimeMs,
        opacity: 1,
        translateXPercent: 0,
        elements: evaluateElementAnimations(
          page.elementIds ?? [],
          page.resolvedAnimations,
          localTimeMs,
        ),
      }
    })

  for (let index = 0; index < timeline.pages.length - 1; index += 1) {
    const page = timeline.pages[index]
    const transition = page.transitionToNext
    const durationMs = transitionDuration(page)
    if (!transition || durationMs === 0) continue
    const transitionStart = page.endMs - durationMs
    if (clampedTime < transitionStart || clampedTime >= page.endMs) continue
    const outgoing = states.find((state) => state.pageIndex === index)
    const incoming = states.find((state) => state.pageIndex === index + 1)
    if (outgoing && incoming) {
      applyTransition(
        outgoing,
        incoming,
        transition,
        (clampedTime - transitionStart) / durationMs,
      )
    }
  }

  return {
    timeMs: clampedTime,
    totalDurationMs: timeline.totalDurationMs,
    pages: states,
  }
}
