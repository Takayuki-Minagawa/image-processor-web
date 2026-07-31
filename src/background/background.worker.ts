import { createBackgroundWorkerMessageHandler } from './workerHandler'
import { createBackgroundOnnxModelLoader } from './modelLoader'
import { loadOnnxRuntimeWebSessionFactory } from './onnxRuntime'
import type { BackgroundSegmentationAdapter } from './segmentation'
import type {
  BackgroundRemovalJob,
  BackgroundWorkerRequest,
  BackgroundWorkerResponse,
} from './workerProtocol'

interface WorkerScope {
  postMessage(
    message: BackgroundWorkerResponse,
    transfer?: Transferable[],
  ): void
  addEventListener(
    type: 'message',
    listener: (event: { data: BackgroundWorkerRequest }) => void,
  ): void
}

const scope = globalThis as unknown as WorkerScope
const modelAdapters = new Map<string, BackgroundSegmentationAdapter>()

const resolveModelAdapter = async (
  job: BackgroundRemovalJob,
): Promise<BackgroundSegmentationAdapter | undefined> => {
  const request = job.model
  if (!request) return undefined
  if (!request.consentGranted) {
    throw new DOMException(
      'Background model download requires explicit consent.',
      'NotAllowedError',
    )
  }
  const key = `${request.descriptor.id}@${request.descriptor.version}:${request.descriptor.sha256}`
  const cached = modelAdapters.get(key)
  if (cached) return cached

  const loader = createBackgroundOnnxModelLoader({
    descriptor: request.descriptor,
    loadSessionFactory: loadOnnxRuntimeWebSessionFactory,
    ...(request.onnx ? { onnx: request.onnx } : {}),
  })
  await loader.grantConsent()
  const adapter: BackgroundSegmentationAdapter = {
    id: key,
    async segment(image, context) {
      const loaded = await loader.load(context)
      return loaded.segment(image, context)
    },
  }
  modelAdapters.set(key, adapter)
  return adapter
}

const handleMessage = createBackgroundWorkerMessageHandler(
  (response) => {
    if (response.type === 'result' && response.ok) {
      scope.postMessage(response, [
        response.result.mask.buffer,
        response.result.rgba.buffer,
      ])
      return
    }
    scope.postMessage(response)
  },
  undefined,
  resolveModelAdapter,
)

scope.addEventListener('message', (event) => {
  handleMessage(event.data)
})
