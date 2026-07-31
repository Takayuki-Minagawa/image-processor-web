import { describe, expect, it } from 'vitest'
import { validateBackgroundModelDescriptor } from './modelCache'
import {
  DEFAULT_BACKGROUND_MODEL,
  DEFAULT_BACKGROUND_MODEL_ONNX_OPTIONS,
} from './defaultModel'

describe('default background model metadata', () => {
  it('pins a validated HTTPS descriptor and the inspected U²-Net tensor names', () => {
    expect(validateBackgroundModelDescriptor(DEFAULT_BACKGROUND_MODEL)).toEqual(
      DEFAULT_BACKGROUND_MODEL,
    )
    expect(DEFAULT_BACKGROUND_MODEL.downloadUrl).toContain(
      `/resolve/${'7fc34deee10329bc039c10a73b98090d0c6f5c59'}/`,
    )
    expect(DEFAULT_BACKGROUND_MODEL_ONNX_OPTIONS).toMatchObject({
      inputName: 'input.1',
      outputName: '1959',
      inputSize: 320,
    })
  })
})
