import {
  DEFAULT_BACKGROUND_MODEL,
  DEFAULT_BACKGROUND_MODEL_LABEL,
  DEFAULT_BACKGROUND_MODEL_ONNX_OPTIONS,
} from '../background/defaultModel'
import type { BackgroundOnnxModelLoader } from '../background/modelLoader'
import type { MacroRepositoryEntry } from '../automation'
import type { FilterOperation, PixelBuffer } from '../editor/filters/types'
import type { SelectionMask } from '../selection/mask'
import type { EditorScriptCommand } from '../scripting/types'
import {
  AdvancedFilterPanel,
  type AdvancedFilterPanelStatus,
  type AdvancedFilterPreview,
} from './AdvancedFilterPanel'
import {
  AdvancedToolsPanel,
  type AdvancedBackgroundModel,
  type AdvancedToolsStatus,
} from './AdvancedToolsPanel'

let defaultBackgroundModelLoader: Promise<BackgroundOnnxModelLoader> | undefined

const FILTER_PREVIEW_MAX_DIMENSION = 256

const throwIfPreviewAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new DOMException('Filter preview was cancelled.', 'AbortError')
  }
}

const resizePreviewSource = (source: ImageData): ImageData => {
  const scale = Math.min(
    1,
    FILTER_PREVIEW_MAX_DIMENSION / Math.max(source.width, source.height),
  )
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = source.width
  sourceCanvas.height = source.height
  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) {
    throw new Error('プレビュー元画像を作成できませんでした。')
  }
  sourceContext.putImageData(source, 0, 0)

  const previewCanvas = document.createElement('canvas')
  previewCanvas.width = width
  previewCanvas.height = height
  const previewContext = previewCanvas.getContext('2d', {
    willReadFrequently: true,
  })
  if (!previewContext) {
    throw new Error('フィルタープレビュー用Canvasを作成できませんでした。')
  }
  previewContext.imageSmoothingEnabled = true
  previewContext.imageSmoothingQuality = 'high'
  previewContext.drawImage(sourceCanvas, 0, 0, width, height)
  return previewContext.getImageData(0, 0, width, height)
}

const renderAdvancedFilterPreview = async (
  getDocumentImageData: () => Promise<ImageData>,
  operations: readonly FilterOperation[],
  signal: AbortSignal,
): Promise<AdvancedFilterPreview> => {
  if (operations.length > 64) {
    throw new RangeError('プレビューできるフィルターは64件までです。')
  }
  throwIfPreviewAborted(signal)
  const before = resizePreviewSource(await getDocumentImageData())
  throwIfPreviewAborted(signal)
  const input: PixelBuffer = {
    width: before.width,
    height: before.height,
    data: new Uint8ClampedArray(before.data),
  }
  let filtered = input
  if (operations.length > 0) {
    if (typeof Worker === 'undefined') {
      const { applyFilterChainCpu } = await import('../editor/filters/cpu')
      filtered = applyFilterChainCpu(input, operations)
    } else {
      const { SelectionFilterClient } =
        await import('../editor/filters/selectionFilterClient')
      const client = new SelectionFilterClient()
      try {
        filtered = await client.run(
          { image: input, operations },
          { signal, transferOwnership: true },
        )
      } finally {
        client.dispose()
      }
    }
  }
  throwIfPreviewAborted(signal)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('フィルタープレビュー画像を作成できませんでした。')
  }
  const after = context.createImageData(filtered.width, filtered.height)
  after.data.set(filtered.data)
  return { before, after }
}

const getDefaultBackgroundModelLoader =
  (): Promise<BackgroundOnnxModelLoader> => {
    defaultBackgroundModelLoader ??= Promise.all([
      import('../background/modelLoader'),
      import('../background/onnxRuntime'),
    ]).then(
      ([
        { createBackgroundOnnxModelLoader },
        { loadOnnxRuntimeWebSessionFactory },
      ]) =>
        createBackgroundOnnxModelLoader({
          descriptor: DEFAULT_BACKGROUND_MODEL,
          loadSessionFactory: loadOnnxRuntimeWebSessionFactory,
          onnx: DEFAULT_BACKGROUND_MODEL_ONNX_OPTIONS,
        }),
    )
    return defaultBackgroundModelLoader
  }

const ADVANCED_BACKGROUND_MODEL: AdvancedBackgroundModel = {
  id: `${DEFAULT_BACKGROUND_MODEL.id}@${DEFAULT_BACKGROUND_MODEL.version}`,
  label: DEFAULT_BACKGROUND_MODEL_LABEL,
  sizeBytes: DEFAULT_BACKGROUND_MODEL.sizeBytes,
  workerModel: {
    descriptor: { ...DEFAULT_BACKGROUND_MODEL },
    onnx: { ...DEFAULT_BACKGROUND_MODEL_ONNX_OPTIONS },
  },
  async load(context) {
    const loader = await getDefaultBackgroundModelLoader()
    await loader.grantConsent()
    return loader.load(context)
  },
  async revoke(removeCachedModel = false) {
    await (await getDefaultBackgroundModelLoader()).revoke(removeCachedModel)
  },
}

export interface AdvancedStudioPanelProps {
  documentWidth: number
  documentHeight: number
  getDocumentImageData(): Promise<ImageData>
  selectionMask?: SelectionMask
  onSelectionMask(mask: SelectionMask | undefined): void
  onBackgroundResult(result: ImageData, mask: SelectionMask): void
  onScriptCommands(commands: EditorScriptCommand[]): void
  onMacroRegistered?(entry: MacroRepositoryEntry): void
  onApplyFilters(operations: FilterOperation[]): void | Promise<void>
  advancedAdjustment?: {
    id: string
    operations: readonly FilterOperation[]
  }
  onAddAdvancedAdjustment(operations: FilterOperation[]): void | Promise<void>
  onUpdateAdvancedAdjustment(
    id: string,
    operations: FilterOperation[],
  ): void | Promise<void>
  onStatus?(status: AdvancedFilterPanelStatus | AdvancedToolsStatus): void
}

export function AdvancedStudioPanel({
  documentWidth,
  documentHeight,
  getDocumentImageData,
  selectionMask,
  onSelectionMask,
  onBackgroundResult,
  onScriptCommands,
  onMacroRegistered,
  onApplyFilters,
  advancedAdjustment,
  onAddAdvancedAdjustment,
  onUpdateAdvancedAdjustment,
  onStatus,
}: AdvancedStudioPanelProps) {
  return (
    <>
      <AdvancedFilterPanel
        initialOperations={advancedAdjustment?.operations}
        editingAdjustmentId={advancedAdjustment?.id}
        renderPreview={(operations, signal) =>
          renderAdvancedFilterPreview(getDocumentImageData, operations, signal)
        }
        onApply={onApplyFilters}
        onAddAdjustment={onAddAdvancedAdjustment}
        onUpdateAdjustment={onUpdateAdvancedAdjustment}
        onStatus={onStatus}
      />
      <AdvancedToolsPanel
        documentWidth={documentWidth}
        documentHeight={documentHeight}
        getDocumentImageData={getDocumentImageData}
        selectionMask={selectionMask}
        backgroundModel={ADVANCED_BACKGROUND_MODEL}
        onSelectionMask={onSelectionMask}
        onBackgroundResult={onBackgroundResult}
        onScriptCommands={onScriptCommands}
        onMacroRegistered={onMacroRegistered}
        onStatus={onStatus}
      />
    </>
  )
}

export default AdvancedStudioPanel
