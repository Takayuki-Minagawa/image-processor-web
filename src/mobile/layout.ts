export type ResponsiveEditorMode = 'handset' | 'tablet' | 'desktop'
export type PrimaryPointerAccuracy = 'coarse' | 'fine'

export interface EditorViewportProfile {
  width: number
  height: number
  pointer: PrimaryPointerAccuracy
}

export interface ResponsiveEditorLayout {
  mode: ResponsiveEditorMode
  toolRailPlacement: 'bottom' | 'left'
  inspectorPresentation: 'bottom-sheet' | 'docked'
  assetPanelPresentation: 'bottom-sheet' | 'docked'
  dialogPresentation: 'fullscreen' | 'centered'
  minimumInteractiveSizePx: number
}

export const HANDSET_MAX_WIDTH = 599
export const DESKTOP_MIN_WIDTH = 1_180
export const TABLET_MAX_SHORT_SIDE = 1_024
export const MINIMUM_TOUCH_TARGET_PX = 44
export const MINIMUM_FINE_POINTER_TARGET_PX = 32

const assertViewportDimension = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`)
  }
}

/**
 * Coarse-pointer landscape phones stay in handset mode by considering their
 * short side. iPad-class viewports use the tablet bottom-sheet composition.
 */
export const classifyResponsiveEditorMode = (
  profile: EditorViewportProfile,
): ResponsiveEditorMode => {
  assertViewportDimension(profile.width, 'Viewport width')
  assertViewportDimension(profile.height, 'Viewport height')
  const shortestSide = Math.min(profile.width, profile.height)
  if (
    profile.width <= HANDSET_MAX_WIDTH ||
    (profile.pointer === 'coarse' && shortestSide <= HANDSET_MAX_WIDTH)
  ) {
    return 'handset'
  }
  if (profile.pointer === 'coarse' && shortestSide <= TABLET_MAX_SHORT_SIDE) {
    return 'tablet'
  }
  if (profile.width < DESKTOP_MIN_WIDTH) return 'tablet'
  return 'desktop'
}

export const resolveResponsiveEditorLayout = (
  profile: EditorViewportProfile,
): ResponsiveEditorLayout => {
  const mode = classifyResponsiveEditorMode(profile)
  const minimumInteractiveSizePx =
    profile.pointer === 'coarse'
      ? MINIMUM_TOUCH_TARGET_PX
      : MINIMUM_FINE_POINTER_TARGET_PX
  if (mode === 'desktop') {
    return {
      mode,
      toolRailPlacement: 'left',
      inspectorPresentation: 'docked',
      assetPanelPresentation: 'docked',
      dialogPresentation: 'centered',
      minimumInteractiveSizePx,
    }
  }
  return {
    mode,
    toolRailPlacement: 'bottom',
    inspectorPresentation: 'bottom-sheet',
    assetPanelPresentation: 'bottom-sheet',
    dialogPresentation: mode === 'handset' ? 'fullscreen' : 'centered',
    minimumInteractiveSizePx,
  }
}

export const interactiveTargetIsLargeEnough = (
  width: number,
  height: number,
  pointer: PrimaryPointerAccuracy,
): boolean => {
  if (![width, height].every(Number.isFinite)) return false
  const minimum =
    pointer === 'coarse'
      ? MINIMUM_TOUCH_TARGET_PX
      : MINIMUM_FINE_POINTER_TARGET_PX
  return width >= minimum && height >= minimum
}
