import type { EvaluatedPageState } from '../animation/timeline'

export type RenderedPresentationFrame = EvaluatedPageState & { source: string }

export interface PresentationFrameRenderQueue {
  request(states: readonly EvaluatedPageState[]): void
  dispose(): void
}

/**
 * Keeps one expensive Fabric render active and coalesces all waiting requests
 * to the latest playhead state. Completed frames remain visible while the next
 * state renders, preventing slow pages from starving the preview.
 */
export const createPresentationFrameRenderQueue = (
  renderPage: (pageId: string, timeMs?: number) => Promise<string>,
  onFrames: (frames: RenderedPresentationFrame[]) => void,
): PresentationFrameRenderQueue => {
  let pending: readonly EvaluatedPageState[] | undefined
  let rendering = false
  let disposed = false

  const drain = async (): Promise<void> => {
    if (rendering || disposed) return
    rendering = true
    try {
      while (!disposed && pending) {
        const states = pending
        pending = undefined
        try {
          const rendered: RenderedPresentationFrame[] = []
          for (const state of states) {
            rendered.push({
              ...state,
              source: await renderPage(state.pageId, state.localTimeMs),
            })
          }
          if (!disposed) onFrames(rendered)
        } catch {
          // Keep the last completed frame and continue with any newer request.
        }
      }
    } finally {
      rendering = false
      if (!disposed && pending) void drain()
    }
  }

  return {
    request(states) {
      if (disposed) return
      pending = states
      void drain()
    },
    dispose() {
      disposed = true
      pending = undefined
    },
  }
}
