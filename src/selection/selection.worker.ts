import { createSelectionWorkerMessageHandler } from './workerHandler'
import type {
  SelectionWorkerRequest,
  SelectionWorkerResponse,
} from './workerProtocol'

interface WorkerScope {
  postMessage(message: SelectionWorkerResponse, transfer?: Transferable[]): void
  addEventListener(
    type: 'message',
    listener: (event: { data: SelectionWorkerRequest }) => void,
  ): void
}

const scope = globalThis as unknown as WorkerScope
const handleMessage = createSelectionWorkerMessageHandler((response) => {
  scope.postMessage(
    response,
    response.ok ? [response.mask.data.buffer] : undefined,
  )
})

scope.addEventListener('message', (event) => {
  handleMessage(event.data)
})
