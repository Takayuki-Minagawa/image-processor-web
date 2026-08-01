import type {
  ElementAnimationClip,
  PresentationPage,
} from '../animation/timeline'
import { flattenLayerTree } from './layerTree'
import type {
  ProjectElementAnimation,
  ProjectPage,
  ProjectPageTimeline,
} from './types'

export const DEFAULT_STATIC_PAGE_DURATION_MS = 3_000

/** Converts the persisted v4 envelope to the renderer-neutral evaluator API. */
export const projectPageToPresentationPage = (
  page: ProjectPage,
): PresentationPage => {
  const elementIds = flattenLayerTree(page.layerTree).map(({ node }) => node.id)
  const animations: ElementAnimationClip[] = []
  if (page.timeline) {
    Object.entries(page.timeline.elements).forEach(
      ([elementId, elementAnimations]) => {
        elementAnimations.forEach((animation) => {
          animations.push({ ...animation, elementId })
        })
      },
    )
  }
  return {
    id: page.id,
    durationMs: page.timeline?.durationMs ?? DEFAULT_STATIC_PAGE_DURATION_MS,
    ...(page.timeline?.transition === undefined
      ? {}
      : { transitionToNext: page.timeline.transition }),
    elementIds,
    ...(animations.length === 0 ? {} : { animations }),
  }
}

/** Converts evaluator input back to the normalized per-element project map. */
export const presentationPageToProjectTimeline = (
  page: PresentationPage,
): ProjectPageTimeline => {
  const elements: Record<string, ProjectElementAnimation[]> = {}
  page.animations?.forEach(({ elementId, ...animation }) => {
    const target = elements[elementId] ?? []
    target.push(animation)
    elements[elementId] = target
  })
  return {
    durationMs: page.durationMs,
    ...(page.transitionToNext === undefined
      ? {}
      : { transition: page.transitionToNext }),
    elements,
  }
}
