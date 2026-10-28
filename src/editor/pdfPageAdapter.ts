import { assertSafeImageDimensions } from '../lib/imageSafety'
import { createProjectPage } from './designDocument'
import { FabricEditorEngine, type EditorSnapshot } from './fabricEngine'
import { inspectEmbeddedImageDataUrl } from './snapshotValidation'
import type {
  JsonObject,
  ProjectPagePhysicalSize,
  ProjectPdfImportMetadata,
} from './types'

export interface PdfRasterPage {
  dataUrl: string
  width: number
  height: number
  widthMm: number
  heightMm: number
  pageNumber: number
  rotation: ProjectPdfImportMetadata['rotation']
  dpi: number
}

export interface PdfDesignPage {
  id: string
  name: string
  snapshot: EditorSnapshot
  physicalSize: ProjectPagePhysicalSize
}

/**
 * Prepares an independent, locked page before the application commits its
 * document transaction. The active canvas and its history are never touched.
 */
export const createPdfDesignPage = async (
  raster: PdfRasterPage,
  options: { id?: string; name?: string; signal?: AbortSignal } = {},
): Promise<PdfDesignPage> => {
  const { signal } = options
  signal?.throwIfAborted()
  assertSafeImageDimensions(raster)
  const declared = inspectEmbeddedImageDataUrl(raster.dataUrl).dimensions
  if (declared.width !== raster.width || declared.height !== raster.height) {
    throw new RangeError('PDF raster dimensions do not match the image.')
  }
  const pdfImport: ProjectPdfImportMetadata = {
    kind: 'rasterized-pdf',
    pageNumber: raster.pageNumber,
    widthMm: raster.widthMm,
    heightMm: raster.heightMm,
    rotation: raster.rotation,
    dpi: raster.dpi,
  }
  const physicalSize: ProjectPagePhysicalSize = {
    unit: 'mm',
    widthMm: raster.widthMm,
    heightMm: raster.heightMm,
    sourceDpi: raster.dpi,
  }
  // Validate geometry and metadata before allocating a Fabric canvas.
  const page = createProjectPage({
    id: options.id,
    name: options.name ?? `PDF ${raster.pageNumber}`,
    canvasSize: { width: raster.width, height: raster.height },
    editorState: { pdfImport },
    physicalSize,
    background: { kind: 'color', color: '#ffffff' },
  })
  const canvas = document.createElement('canvas')
  const engine = new FabricEditorEngine(canvas, {
    width: raster.width,
    height: raster.height,
    backgroundColor: '#ffffff',
  })
  let prepared: PdfDesignPage
  try {
    const layerId = await engine.importImage(raster.dataUrl, page.name, {
      signal,
    })
    signal?.throwIfAborted()
    const image = engine.getCanvas().getObjects()[0]
    if (image.width !== raster.width || image.height !== raster.height) {
      throw new RangeError('The decoded PDF raster dimensions are incorrect.')
    }
    engine.setLayerLocked(layerId, true)
    const snapshot = engine.snapshot()
    const validated = createProjectPage({
      ...page,
      fabricCanvas: snapshot.json as JsonObject,
      layerTree: undefined,
      editorState: { ...snapshot.editorState, pdfImport },
    })
    signal?.throwIfAborted()
    prepared = {
      id: validated.id,
      name: validated.name,
      snapshot: {
        json: validated.fabricCanvas,
        width: raster.width,
        height: raster.height,
        editorState: validated.editorState,
      },
      physicalSize,
    }
  } finally {
    await engine.dispose()
    canvas.width = 0
    canvas.height = 0
  }
  signal?.throwIfAborted()
  return prepared
}
