import { describe, expect, it, vi } from 'vitest'
import {
  createOnnxRuntimeSessionFactoryLoader,
  type OnnxRuntimeModuleLike,
} from './onnxRuntime'

const runtimeModule = (
  createSession: OnnxRuntimeModuleLike['InferenceSession']['create'],
) => {
  class Tensor {
    readonly data: Float32Array
    readonly dims: readonly number[]

    constructor(
      readonly type: 'float32',
      data: Float32Array,
      dims: readonly number[],
    ) {
      this.data = data
      this.dims = dims
    }
  }

  return {
    Tensor,
    InferenceSession: { create: createSession },
  } satisfies OnnxRuntimeModuleLike
}

const echoSession = () => ({
  run: vi.fn(async (feeds) => ({
    output: {
      data: new Float32Array([feeds.input.data[0] as number]),
      dims: [1],
    },
  })),
})

describe('onnxruntime-web bridge', () => {
  it('loads WebGPU lazily, selects its EP, and converts tensor boundaries', async () => {
    const session = echoSession()
    const create = vi.fn(async () => session)
    const importWebGpuRuntime = vi.fn(async () => runtimeModule(create))
    const importWasmRuntime = vi.fn(async () =>
      runtimeModule(vi.fn(async () => echoSession())),
    )
    const loadFactory = createOnnxRuntimeSessionFactoryLoader({
      supportsWebGpu: () => true,
      importWebGpuRuntime,
      importWasmRuntime,
      webGpuSessionOptions: { graphOptimizationLevel: 'all' },
    })

    expect(importWebGpuRuntime).not.toHaveBeenCalled()
    const factory = await loadFactory()
    expect(importWebGpuRuntime).not.toHaveBeenCalled()
    const inference = await factory.createSession(new Uint8Array([1, 2, 3]))
    const input = factory.createTensor(new Float32Array([0.75]), [1])
    await expect(inference.run({ input })).resolves.toMatchObject({
      output: { dims: [1] },
    })

    expect(importWebGpuRuntime).toHaveBeenCalledOnce()
    expect(importWasmRuntime).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), {
      graphOptimizationLevel: 'all',
      executionProviders: ['webgpu'],
    })
    expect(session.run.mock.calls[0][0].input).toBeInstanceOf(
      (await importWebGpuRuntime.mock.results[0].value).Tensor,
    )
  })

  it('uses WASM without importing WebGPU when the API is unavailable', async () => {
    const wasmCreate = vi.fn(async () => echoSession())
    const importWebGpuRuntime = vi.fn()
    const importWasmRuntime = vi.fn(async () => runtimeModule(wasmCreate))
    const factory = await createOnnxRuntimeSessionFactoryLoader({
      supportsWebGpu: () => false,
      importWebGpuRuntime,
      importWasmRuntime,
    })()

    await factory.createSession(new Uint8Array([7]))

    expect(importWebGpuRuntime).not.toHaveBeenCalled()
    expect(importWasmRuntime).toHaveBeenCalledOnce()
    expect(wasmCreate).toHaveBeenCalledWith(new Uint8Array([7]), {
      executionProviders: ['wasm'],
    })
  })

  it('falls back to WASM after WebGPU session creation fails and stays there', async () => {
    const gpuError = new Error('unsupported WebGPU operator')
    const webGpuCreate = vi.fn(async () => {
      throw gpuError
    })
    const wasmCreate = vi.fn(async () => echoSession())
    const importWebGpuRuntime = vi.fn(async () => runtimeModule(webGpuCreate))
    const importWasmRuntime = vi.fn(async () => runtimeModule(wasmCreate))
    const factory = await createOnnxRuntimeSessionFactoryLoader({
      supportsWebGpu: async () => true,
      importWebGpuRuntime,
      importWasmRuntime,
    })()

    await factory.createSession(new Uint8Array([1]))
    await factory.createSession(new Uint8Array([2]))

    expect(webGpuCreate).toHaveBeenCalledOnce()
    expect(wasmCreate).toHaveBeenCalledTimes(2)
    expect(importWebGpuRuntime).toHaveBeenCalledOnce()
    expect(importWasmRuntime).toHaveBeenCalledOnce()
  })

  it('reports both backend failures and allows a failed loader probe to retry', async () => {
    const loadFactory = createOnnxRuntimeSessionFactoryLoader({
      supportsWebGpu: () => true,
      importWebGpuRuntime: async () =>
        runtimeModule(
          vi.fn(async () => {
            throw new Error('gpu failed')
          }),
        ),
      importWasmRuntime: async () =>
        runtimeModule(
          vi.fn(async () => {
            throw new Error('wasm failed')
          }),
        ),
    })
    const factory = await loadFactory()

    await expect(factory.createSession(new Uint8Array([1]))).rejects.toThrow(
      'both WebGPU and WASM',
    )

    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('probe failed'))
      .mockResolvedValue(false)
    const retryingLoader = createOnnxRuntimeSessionFactoryLoader({
      supportsWebGpu: probe,
      importWasmRuntime: async () =>
        runtimeModule(vi.fn(async () => echoSession())),
    })
    await expect(retryingLoader()).rejects.toThrow('probe failed')
    await expect(retryingLoader()).resolves.toBeDefined()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed input shapes and unsupported runtime output types', async () => {
    const runtime = runtimeModule(
      vi.fn(async () => ({
        run: async () => ({
          output: {
            data: new BigInt64Array([1n]),
            dims: [1],
          },
        }),
      })),
    )
    const factory = await createOnnxRuntimeSessionFactoryLoader({
      supportsWebGpu: () => false,
      importWasmRuntime: async () => runtime,
    })()

    expect(() => factory.createTensor(new Float32Array([1, 2]), [1])).toThrow(
      'describe 1 values',
    )
    const inference = await factory.createSession(new Uint8Array([1]))
    await expect(
      inference.run({
        input: { data: new Float32Array([1]), dims: [1] },
      }),
    ).rejects.toThrow('supported numeric typed array')
  })
})
