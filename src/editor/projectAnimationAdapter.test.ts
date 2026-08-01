import { describe, expect, it } from 'vitest'
import { createProjectPage } from './designDocument'
import {
  presentationPageToProjectTimeline,
  projectPageToPresentationPage,
} from './projectAnimationAdapter'

describe('project animation adapter', () => {
  it('maps the v4 per-layer envelope to the shared animation evaluator and back', () => {
    const page = createProjectPage({
      id: 'page-1',
      name: 'Animated',
      canvasSize: { width: 1280, height: 720 },
      fabricCanvas: {
        objects: [{ type: 'Rect', editorId: 'hero' }],
      },
      timeline: {
        durationMs: 2_000,
        transition: { type: 'fade', durationMs: 250 },
        elements: {
          hero: [
            {
              id: 'hero-enter',
              phase: 'enter',
              effect: 'fade',
              start: { mode: 'with-page', delayMs: 100 },
              durationMs: 400,
            },
          ],
        },
      },
    })

    const presentation = projectPageToPresentationPage(page)
    expect(presentation).toMatchObject({
      id: 'page-1',
      durationMs: 2_000,
      transitionToNext: { type: 'fade', durationMs: 250 },
      animations: [{ id: 'hero-enter', elementId: 'hero' }],
    })
    expect(presentationPageToProjectTimeline(presentation)).toEqual(
      page.timeline,
    )
  })

  it('uses a deterministic duration for a static page', () => {
    const page = createProjectPage({
      id: 'static',
      canvasSize: { width: 100, height: 100 },
    })
    const presentation = projectPageToPresentationPage(page)
    expect(presentation.durationMs).toBe(3_000)
    expect(presentation).not.toHaveProperty('animations')
  })
})
