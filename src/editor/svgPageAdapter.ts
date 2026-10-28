import type { SvgNativeGeometry } from '../import/svgGeometry'
import { createProjectPage } from './designDocument'
import { FabricEditorEngine, type EditorSnapshot } from './fabricEngine'
import type { JsonObject, ProjectPagePhysicalSize } from './types'

export interface SvgDesignPage {
  id: string
  name: string
  snapshot: EditorSnapshot
  background: { kind: 'transparent' }
  physicalSize?: ProjectPagePhysicalSize
}

/** Prepares a native vector page without changing the active document. */
export const createSvgDesignPage = async (
  geometry: SvgNativeGeometry,
  options: { id?: string; name?: string; signal?: AbortSignal } = {},
): Promise<SvgDesignPage> => {
  const { signal } = options
  signal?.throwIfAborted()
  const page = createProjectPage({
    id: options.id,
    name: options.name ?? 'SVG',
    canvasSize: { width: geometry.width, height: geometry.height },
    physicalSize: geometry.physicalSize,
    background: { kind: 'transparent' },
  })
  const canvas = document.createElement('canvas')
  const engine = new FabricEditorEngine(canvas, {
    width: geometry.width,
    height: geometry.height,
    backgroundColor: 'transparent',
  })
  let prepared: SvgDesignPage
  try {
    await engine.importSvg(geometry.source, page.name, {
      placement: 'native',
      signal,
    })
    signal?.throwIfAborted()
    const snapshot = engine.snapshot()
    const validated = createProjectPage({
      ...page,
      fabricCanvas: snapshot.json as JsonObject,
      layerTree: undefined,
      editorState: snapshot.editorState,
    })
    prepared = {
      id: validated.id,
      name: validated.name,
      snapshot: {
        json: validated.fabricCanvas,
        width: validated.canvasSize.width,
        height: validated.canvasSize.height,
        editorState: validated.editorState,
      },
      background: { kind: 'transparent' },
      ...(validated.physicalSize
        ? { physicalSize: validated.physicalSize }
        : {}),
    }
  } finally {
    await engine.dispose()
    canvas.width = 0
    canvas.height = 0
  }
  signal?.throwIfAborted()
  return prepared
}
