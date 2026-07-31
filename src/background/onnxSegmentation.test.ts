import { describe, expect, it, vi } from 'vitest'
import {
  bilinearUpsampleMask,
  createOnnxSegmentationAdapter,
  rgbaToNchw,
  type OnnxInferenceSessionLike,
  type OnnxSessionFactory,
  type OnnxTensorLike,
} from './onnxSegmentation'

const opaqueImage = (width: number, height: number) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4).fill(255),
})

describe('ONNX segmentation adapter', () => {
  it('bilinearly resizes RGBA into normalized planar NCHW data', () => {
    const input = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        255, 128, 0, 255,
        // Hidden red is discarded because this pixel is transparent.
        255, 0, 0, 0,
      ]),
    }
    const tensor = rgbaToNchw(input, {
      inputSize: { width: 2, height: 1 },
      mean: [0, 0, 0],
      standardDeviation: [1, 1, 1],
      alphaBackground: [0, 0, 255],
    })

    expect(tensor.dims).toEqual([1, 3, 1, 2])
    expect(tensor.data[0]).toBe(1)
    expect(tensor.data[1]).toBe(0)
    expect(tensor.data[2]).toBeCloseTo(128 / 255, 6)
    expect([...tensor.data.slice(3)]).toEqual([0, 0, 1])
  })

  it('upsamples a probability plane with center-aligned bilinear sampling', () => {
    const output = bilinearUpsampleMask(
      new Float32Array([0, 1, 1, 0]),
      2,
      2,
      3,
      3,
    )

    expect([...output]).toEqual([0, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0])
  })

  it('loads the injected runtime lazily and restores NCHW output to source size', async () => {
    const run = vi.fn(
      async (
        feeds: Readonly<Record<string, OnnxTensorLike>>,
      ): Promise<Readonly<Record<string, OnnxTensorLike>>> => {
        expect(feeds.model_input.dims).toEqual([1, 3, 2, 2])
        return {
          subject_mask: {
            data: new Float32Array([0, 1, 1, 0]),
            dims: [1, 1, 2, 2],
          },
        }
      },
    )
    const session: OnnxInferenceSessionLike = { run }
    const createSession = vi.fn(async (bytes: Uint8Array) => {
      expect([...bytes]).toEqual([1, 2, 3])
      bytes[0] = 99
      return session
    })
    const createTensor = vi.fn(
      (data: Float32Array, dims: readonly number[]): OnnxTensorLike => ({
        data,
        dims,
      }),
    )
    const factory: OnnxSessionFactory = { createSession, createTensor }
    const loadSessionFactory = vi.fn(async () => factory)
    const progress = vi.fn()
    const adapter = createOnnxSegmentationAdapter({
      id: 'subject-lite@1.0.0',
      modelBytes: new Uint8Array([1, 2, 3]),
      loadSessionFactory,
      inputName: 'model_input',
      outputName: 'subject_mask',
      inputSize: 2,
      mean: [0, 0, 0],
      standardDeviation: [1, 1, 1],
    })

    expect(loadSessionFactory).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()

    const first = await adapter.segment(opaqueImage(3, 3), {
      reportProgress: progress,
    })
    const second = await adapter.segment(opaqueImage(3, 3), {})

    expect([...first]).toEqual([0, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0])
    expect([...second]).toEqual([...first])
    expect(loadSessionFactory).toHaveBeenCalledOnce()
    expect(createSession).toHaveBeenCalledOnce()
    expect(createTensor).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenLastCalledWith(1, 'compose')
  })

  it('selects a configured channel from CHW output and can apply sigmoid', async () => {
    const factory: OnnxSessionFactory = {
      createTensor: (data, dims) => ({ data, dims }),
      createSession: async () => ({
        run: async () => ({
          logits: {
            data: new Float32Array([10, 10, 0, Math.log(3)]),
            dims: [2, 1, 2],
          },
        }),
      }),
    }
    const adapter = createOnnxSegmentationAdapter({
      id: 'two-channel',
      modelBytes: new Uint8Array([1]),
      loadSessionFactory: async () => factory,
      inputSize: 1,
      outputName: 'logits',
      outputChannel: 1,
      outputActivation: 'sigmoid',
    })

    const mask = await adapter.segment(opaqueImage(2, 1), {})
    expect(mask[0]).toBeCloseTo(0.5, 6)
    expect(mask[1]).toBeCloseTo(0.75, 6)
  })

  it('rejects missing outputs and cancellation without loading the runtime', async () => {
    const loadSessionFactory = vi.fn(async (): Promise<OnnxSessionFactory> => ({
      createTensor: (data, dims) => ({ data, dims }),
      createSession: async () => ({
        run: async () => ({}),
      }),
    }))
    const adapter = createOnnxSegmentationAdapter({
      id: 'cancel-test',
      modelBytes: new Uint8Array([1]),
      loadSessionFactory,
    })
    const controller = new AbortController()
    controller.abort()

    await expect(
      adapter.segment(opaqueImage(1, 1), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(loadSessionFactory).not.toHaveBeenCalled()

    await expect(adapter.segment(opaqueImage(1, 1), {})).rejects.toThrow(
      'ONNX output "output" was not returned.',
    )
  })
})
