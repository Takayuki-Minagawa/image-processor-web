import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { SelectionPoint } from './algorithms'
import { appendDistinctLassoPoint, clientPointToDocumentPoint } from './lasso'
import { SelectionMask } from './mask'
import MarchingAntsOverlay from './MarchingAntsOverlay'

export interface LassoSelectionCanvasProps {
  documentWidth: number
  documentHeight: number
  previewImage?: ImageData
  selectionMask?: SelectionMask
  disabled?: boolean
  onComplete(
    points: readonly SelectionPoint[],
    modifier?: 'add' | 'subtract',
  ): void
  onIncomplete?(): void
}

const PREVIEW_MAX_WIDTH = 640
const PREVIEW_MAX_HEIGHT = 320

const previewDimensions = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const scale = Math.min(PREVIEW_MAX_WIDTH / width, PREVIEW_MAX_HEIGHT / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function LassoSelectionCanvas({
  documentWidth,
  documentHeight,
  previewImage,
  selectionMask,
  disabled = false,
  onComplete,
  onIncomplete,
}: LassoSelectionCanvasProps) {
  const descriptionId = useId()
  const [points, setPoints] = useState<SelectionPoint[]>([])
  const pointsRef = useRef<SelectionPoint[]>([])
  const activePointerRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const preview = previewDimensions(documentWidth, documentHeight)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (!previewImage) return

    let cancelled = false
    let bitmap: ImageBitmap | undefined
    const draw = (source: CanvasImageSource): void => {
      if (cancelled) return
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
    }

    if (typeof globalThis.createImageBitmap === 'function') {
      void globalThis
        .createImageBitmap(previewImage)
        .then((created) => {
          bitmap = created
          draw(created)
        })
        .catch(() => undefined)
    } else {
      const source = document.createElement('canvas')
      source.width = previewImage.width
      source.height = previewImage.height
      const sourceContext = source.getContext('2d')
      if (sourceContext) {
        const frame = sourceContext.createImageData(
          previewImage.width,
          previewImage.height,
        )
        frame.data.set(previewImage.data)
        sourceContext.putImageData(frame, 0, 0)
        draw(source)
      }
    }

    return () => {
      cancelled = true
      bitmap?.close()
    }
  }, [preview.height, preview.width, previewImage])

  const updatePoints = (next: SelectionPoint[]): void => {
    pointsRef.current = next
    setPoints(next)
  }

  const pointFromEvent = (
    event: PointerEvent<HTMLCanvasElement>,
  ): SelectionPoint =>
    clientPointToDocumentPoint(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
      documentWidth,
      documentHeight,
    )

  const begin = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    activePointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
    updatePoints([pointFromEvent(event)])
  }

  const extend = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (
      disabled ||
      activePointerRef.current === null ||
      event.pointerId !== activePointerRef.current
    ) {
      return
    }
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const minimumDistance = Math.max(
      documentWidth / rect.width,
      documentHeight / rect.height,
    )
    updatePoints(
      appendDistinctLassoPoint(
        pointsRef.current,
        pointFromEvent(event),
        minimumDistance,
      ),
    )
  }

  const finish = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (
      activePointerRef.current === null ||
      event.pointerId !== activePointerRef.current
    ) {
      return
    }
    event.preventDefault()
    const completed = appendDistinctLassoPoint(
      pointsRef.current,
      pointFromEvent(event),
    )
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    activePointerRef.current = null
    updatePoints([])
    if (completed.length >= 3) {
      onComplete(
        completed,
        event.altKey ? 'subtract' : event.shiftKey ? 'add' : undefined,
      )
    } else {
      onIncomplete?.()
    }
  }

  const cancel = (): void => {
    activePointerRef.current = null
    updatePoints([])
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    if (event.key !== 'Escape' || pointsRef.current.length === 0) return
    event.preventDefault()
    cancel()
  }

  const polyline = points.map(({ x, y }) => `${x},${y}`).join(' ')

  return (
    <>
      <p id={descriptionId} className="lasso-canvas-instructions">
        画像上をポインターで囲み、離すと選択します。Shift
        で追加、Altで除外、Escで描画中の線を取り消せます。キーボードでは下の座標入力を使用できます。
      </p>
      <div
        className="lasso-canvas-shell"
        style={{
          aspectRatio: `${documentWidth} / ${documentHeight}`,
          width: `${preview.width}px`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="lasso-canvas"
          width={preview.width}
          height={preview.height}
          role="img"
          aria-label="なげなわ描画領域"
          aria-describedby={descriptionId}
          aria-disabled={disabled}
          aria-keyshortcuts="Escape"
          tabIndex={disabled ? -1 : 0}
          onPointerDown={begin}
          onPointerMove={extend}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onKeyDown={handleKeyDown}
        >
          なげなわ選択はポインター操作に対応しています。キーボードでは座標入力を使用してください。
        </canvas>
        <MarchingAntsOverlay mask={selectionMask} />
        {polyline ? (
          <svg
            className="lasso-live-overlay"
            viewBox={`0 0 ${documentWidth} ${documentHeight}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline points={polyline} />
          </svg>
        ) : null}
      </div>
    </>
  )
}

export default LassoSelectionCanvas
