import { useMemo } from 'react'
import { SelectionMask } from './mask'
import {
  traceSelectionBoundary,
  type SelectionBoundaryOptions,
} from './marchingAnts'

export interface MarchingAntsOverlayProps extends SelectionBoundaryOptions {
  mask?: SelectionMask
  className?: string
}

/**
 * Reusable selection-boundary visualization. It is presentation-only and
 * never changes or owns the underlying SelectionMask.
 */
export function MarchingAntsOverlay({
  mask,
  className,
  threshold,
  maximumSegments,
  maximumSampleCells,
}: MarchingAntsOverlayProps) {
  const boundary = useMemo(
    () =>
      mask
        ? traceSelectionBoundary(mask, {
            threshold,
            maximumSegments,
            maximumSampleCells,
          })
        : undefined,
    [mask, maximumSampleCells, maximumSegments, threshold],
  )

  if (!mask || !boundary?.path) return null

  const classes = ['marching-ants-overlay', className].filter(Boolean).join(' ')
  return (
    <svg
      className={classes}
      viewBox={`0 0 ${mask.width} ${mask.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-sample-step={boundary.sampleStep}
      data-truncated={boundary.truncated ? 'true' : 'false'}
    >
      <path className="marching-ants-shadow" d={boundary.path} />
      <path className="marching-ants-dashes" d={boundary.path} />
    </svg>
  )
}

export default MarchingAntsOverlay
