import type { BackgroundModelDescriptor } from './modelCache'

/**
 * Lightweight U²-Net checkpoint pinned to an immutable Hugging Face revision.
 * The model is Apache-2.0 and is downloaded only after explicit user consent.
 */
export const DEFAULT_BACKGROUND_MODEL: BackgroundModelDescriptor =
  Object.freeze({
    id: 'u2netp',
    version: '7fc34de',
    sizeBytes: 4_574_861,
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    downloadUrl:
      'https://huggingface.co/Heliosoph/u2net-onnx/resolve/7fc34deee10329bc039c10a73b98090d0c6f5c59/u2netp.onnx',
  })

export const DEFAULT_BACKGROUND_MODEL_LABEL = 'U²-Net Portable（Apache-2.0）'

export const DEFAULT_BACKGROUND_MODEL_ONNX_OPTIONS = Object.freeze({
  inputName: 'input.1',
  outputName: '1959',
  inputSize: 320,
  outputActivation: 'probability' as const,
})
