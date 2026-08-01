/// <reference lib="webworker" />

import { createMediaExportWorkerMessageHandler } from './workerHandler'
import type { MediaExportWorkerRequest } from './workerProtocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
const handle = createMediaExportWorkerMessageHandler((response) => {
  if (response.type === 'result') {
    scope.postMessage(response, [response.data.buffer])
  } else {
    scope.postMessage(response)
  }
})

scope.addEventListener(
  'message',
  (event: MessageEvent<MediaExportWorkerRequest>) => {
    handle(event.data)
  },
)

export {}
