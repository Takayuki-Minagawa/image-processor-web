import { describe, expect, it, vi } from 'vitest'
import type { EvaluatedPageState } from '../animation/timeline'
import { createPresentationFrameRenderQueue } from './presentationFrameQueue'

const pageState = (localTimeMs: number): EvaluatedPageState => ({
  pageId: 'page-1',
  pageIndex: 0,
  localTimeMs,
  opacity: 1,
  translateXPercent: 0,
  elements: [],
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('presentation frame render queue', () => {
  it('keeps one render active and coalesces waiting requests to the latest', async () => {
    const pending: Array<ReturnType<typeof deferred<string>>> = []
    let active = 0
    let maximumActive = 0
    const renderPage = vi.fn(() => {
      const result = deferred<string>()
      pending.push(result)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      return result.promise.finally(() => {
        active -= 1
      })
    })
    const onFrames = vi.fn()
    const queue = createPresentationFrameRenderQueue(renderPage, onFrames)

    queue.request([pageState(0)])
    queue.request([pageState(100)])
    queue.request([pageState(200)])

    expect(renderPage).toHaveBeenCalledTimes(1)
    pending[0].resolve('frame-0')
    await vi.waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2))
    expect(renderPage).toHaveBeenLastCalledWith('page-1', 200)
    expect(onFrames).toHaveBeenCalledWith([
      expect.objectContaining({ localTimeMs: 0, source: 'frame-0' }),
    ])

    pending[1].resolve('frame-200')
    await vi.waitFor(() => expect(onFrames).toHaveBeenCalledTimes(2))
    expect(onFrames).toHaveBeenLastCalledWith([
      expect.objectContaining({ localTimeMs: 200, source: 'frame-200' }),
    ])
    expect(maximumActive).toBe(1)

    queue.dispose()
  })
})
