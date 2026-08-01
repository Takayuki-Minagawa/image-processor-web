import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react'
import type { ProjectPageTransition } from '../editor/types'
import {
  evaluatePresentationTimeline,
  resolvePresentationTimeline,
} from '../animation/timeline'
import { designStudioCopy } from '../i18n.design'
import type { AppLocale } from '../uiPreferences'
import {
  createPresentationFrameRenderQueue,
  type PresentationFrameRenderQueue,
  type RenderedPresentationFrame,
} from './presentationFrameQueue'
import './PresentationPreview.css'

export interface PresentationPreviewPage {
  id: string
  name: string
  durationMs: number
  transition?: ProjectPageTransition
  animated?: boolean
}

export interface PresentationPreviewProps {
  locale: AppLocale
  pages: readonly PresentationPreviewPage[]
  renderPage: (pageId: string, timeMs?: number) => Promise<string>
  onClose: () => void
}

export default function PresentationPreview({
  locale,
  pages,
  renderPage,
  onClose,
}: PresentationPreviewProps) {
  const copy = designStudioCopy(locale).motion
  const rootRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef(0)
  const playbackAnchorRef = useRef({ wallTimeMs: performance.now(), timeMs: 0 })
  const renderPageRef = useRef(renderPage)
  const frameQueueRef = useRef<PresentationFrameRenderQueue | null>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [frames, setFrames] = useState<RenderedPresentationFrame[]>([])

  const timeline = useMemo(
    () =>
      resolvePresentationTimeline(
        pages.map((page, index) => ({
          id: page.id,
          durationMs: page.durationMs,
          ...(index < pages.length - 1 && page.transition
            ? { transitionToNext: page.transition }
            : {}),
        })),
      ),
    [pages],
  )
  const evaluated = useMemo(
    () => evaluatePresentationTimeline(timeline, playheadMs),
    [playheadMs, timeline],
  )
  const activeState = evaluated.pages.at(-1)
  const pageIndex = activeState?.pageIndex ?? 0
  const activePage = pages[pageIndex]

  const setTimelinePosition = useCallback((timeMs: number) => {
    const next = Math.max(0, timeMs)
    playheadRef.current = next
    playbackAnchorRef.current = {
      wallTimeMs: performance.now(),
      timeMs: next,
    }
    setPlayheadMs(next)
  }, [])

  useEffect(() => {
    setTimelinePosition(0)
  }, [setTimelinePosition, timeline])

  useEffect(() => {
    renderPageRef.current = renderPage
  }, [renderPage])

  useEffect(() => {
    const queue = createPresentationFrameRenderQueue(
      (pageId, timeMs) => renderPageRef.current(pageId, timeMs),
      setFrames,
    )
    frameQueueRef.current = queue
    return () => {
      if (frameQueueRef.current === queue) frameQueueRef.current = null
      queue.dispose()
    }
  }, [])

  useEffect(() => {
    frameQueueRef.current?.request(evaluated.pages)
  }, [evaluated.pages])

  const move = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = Math.min(
        pages.length - 1,
        Math.max(0, pageIndex + direction),
      )
      setTimelinePosition(timeline.pages[nextIndex].startMs)
    },
    [pageIndex, pages.length, setTimelinePosition, timeline.pages],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      ) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        move(-1)
      }
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        move(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, onClose])

  useEffect(() => {
    if (!playing) return
    playbackAnchorRef.current = {
      wallTimeMs: performance.now(),
      timeMs: playheadRef.current,
    }
    const timer = globalThis.setInterval(() => {
      const anchor = playbackAnchorRef.current
      const elapsed = performance.now() - anchor.wallTimeMs
      const next = (anchor.timeMs + elapsed) % timeline.totalDurationMs
      playheadRef.current = next
      setPlayheadMs(next)
    }, 100)
    return () => globalThis.clearInterval(timer)
  }, [playing, timeline.totalDurationMs])

  if (!activePage) return null
  return (
    <div
      className="presentation-preview"
      role="dialog"
      aria-modal="true"
      aria-label={activePage.name}
      ref={rootRef}
    >
      <header>
        <strong>{activePage.name}</strong>
        <span>
          {pageIndex + 1} / {pages.length}
        </span>
        <button
          type="button"
          aria-label={copy.fullscreen}
          onClick={() => void rootRef.current?.requestFullscreen()}
        >
          <Maximize2 aria-hidden="true" />
        </button>
        <button type="button" aria-label={copy.close} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <main>
        {frames.length > 0 ? (
          frames.map((frame) => (
            <img
              key={frame.pageId}
              src={frame.source}
              alt={frame.pageId === activePage.id ? activePage.name : ''}
              style={{
                opacity: frame.opacity,
                transform: `translateX(${frame.translateXPercent}%)`,
                zIndex: frame.pageIndex + 1,
              }}
            />
          ))
        ) : (
          <p role="status">{copy.loading}</p>
        )}
      </main>
      <footer>
        <button
          type="button"
          aria-label={copy.previous}
          disabled={pageIndex === 0}
          onClick={() => move(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying((current) => {
              if (!current) {
                playbackAnchorRef.current = {
                  wallTimeMs: performance.now(),
                  timeMs: playheadRef.current,
                }
              }
              return !current
            })
          }}
        >
          {playing ? copy.stop : copy.preview}
        </button>
        <button
          type="button"
          aria-label={copy.next}
          disabled={pageIndex === pages.length - 1}
          onClick={() => move(1)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </footer>
    </div>
  )
}
