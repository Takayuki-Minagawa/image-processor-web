import type {
  OnnxInferenceSessionLike,
  OnnxNumericData,
  OnnxSessionFactory,
  OnnxSessionFactoryLoader,
  OnnxTensorLike,
} from './onnxSegmentation'

type RuntimeTensorData =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array

interface RuntimeTensorLike {
  readonly data: unknown
  readonly dims: readonly number[]
}

interface RuntimeInferenceSessionLike {
  run(
    feeds: Readonly<Record<string, RuntimeTensorLike>>,
  ): Promise<Readonly<Record<string, RuntimeTensorLike>>>
}

/**
 * Structural runtime boundary kept intentionally smaller than
 * onnxruntime-web's public API. Tests can inject this shape without loading the
 * native WASM/WebGPU bundles.
 */
export interface OnnxRuntimeModuleLike {
  readonly Tensor: new (
    type: 'float32',
    data: Float32Array,
    dims: readonly number[],
  ) => RuntimeTensorLike
  readonly InferenceSession: {
    create(
      model: Uint8Array,
      options: Readonly<Record<string, unknown>>,
    ): Promise<RuntimeInferenceSessionLike>
  }
}

export type OnnxRuntimeImporter = () => Promise<OnnxRuntimeModuleLike>
export type WebGpuCapabilityProbe = () => boolean | Promise<boolean>

export interface OnnxRuntimeLoaderOptions {
  importWebGpuRuntime?: OnnxRuntimeImporter
  importWasmRuntime?: OnnxRuntimeImporter
  supportsWebGpu?: WebGpuCapabilityProbe
  webGpuSessionOptions?: Readonly<Record<string, unknown>>
  wasmSessionOptions?: Readonly<Record<string, unknown>>
}

const importWebGpuRuntime = async (): Promise<OnnxRuntimeModuleLike> =>
  (await import('onnxruntime-web/webgpu')) as unknown as OnnxRuntimeModuleLike

const importWasmRuntime = async (): Promise<OnnxRuntimeModuleLike> =>
  (await import('onnxruntime-web/wasm')) as unknown as OnnxRuntimeModuleLike

const browserSupportsWebGpu = (): boolean => {
  const navigatorWithGpu = globalThis.navigator as
    (Navigator & { gpu?: unknown }) | undefined
  return navigatorWithGpu?.gpu !== undefined
}

const isRuntimeModule = (
  candidate: OnnxRuntimeModuleLike,
): candidate is OnnxRuntimeModuleLike =>
  typeof candidate === 'object' &&
  candidate !== null &&
  typeof candidate.Tensor === 'function' &&
  typeof candidate.InferenceSession?.create === 'function'

const checkedRuntime = (
  candidate: OnnxRuntimeModuleLike,
  backend: 'WebGPU' | 'WASM',
): OnnxRuntimeModuleLike => {
  if (!isRuntimeModule(candidate)) {
    throw new TypeError(
      `The dynamically imported ONNX Runtime ${backend} module is invalid.`,
    )
  }
  return candidate
}

const checkedDims = (
  candidate: readonly number[],
  dataLength: number,
  label: string,
): readonly number[] => {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new TypeError(`${label} dimensions must be a non-empty array.`)
  }
  let elements = 1
  const dims = candidate.map((dimension) => {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new RangeError(`${label} dimensions must be positive integers.`)
    }
    elements *= dimension
    if (!Number.isSafeInteger(elements)) {
      throw new RangeError(`${label} dimensions exceed the safe size limit.`)
    }
    return dimension
  })
  if (elements !== dataLength) {
    throw new RangeError(
      `${label} dimensions describe ${elements} values, but the tensor contains ${dataLength}.`,
    )
  }
  return Object.freeze(dims)
}

const checkedInputTensor = (
  tensor: OnnxTensorLike,
  name: string,
): { data: Float32Array; dims: readonly number[] } => {
  if (
    typeof tensor !== 'object' ||
    tensor === null ||
    !(tensor.data instanceof Float32Array)
  ) {
    throw new TypeError(`ONNX input "${name}" must contain Float32Array data.`)
  }
  return {
    data: tensor.data,
    dims: checkedDims(tensor.dims, tensor.data.length, `ONNX input "${name}"`),
  }
}

const isRuntimeTensorData = (value: unknown): value is RuntimeTensorData =>
  value instanceof Float32Array ||
  value instanceof Float64Array ||
  value instanceof Int8Array ||
  value instanceof Uint8Array ||
  value instanceof Uint8ClampedArray ||
  value instanceof Int16Array ||
  value instanceof Uint16Array ||
  value instanceof Int32Array ||
  value instanceof Uint32Array

const checkedOutputTensor = (
  tensor: RuntimeTensorLike,
  name: string,
): OnnxTensorLike => {
  if (
    typeof tensor !== 'object' ||
    tensor === null ||
    !isRuntimeTensorData(tensor.data)
  ) {
    throw new TypeError(
      `ONNX output "${name}" must contain a supported numeric typed array.`,
    )
  }
  return {
    data: tensor.data as OnnxNumericData,
    dims: checkedDims(tensor.dims, tensor.data.length, `ONNX output "${name}"`),
  }
}

const wrapSession = (
  runtime: OnnxRuntimeModuleLike,
  session: RuntimeInferenceSessionLike,
): OnnxInferenceSessionLike => ({
  async run(
    feeds: Readonly<Record<string, OnnxTensorLike>>,
  ): Promise<Readonly<Record<string, OnnxTensorLike>>> {
    if (typeof feeds !== 'object' || feeds === null || Array.isArray(feeds)) {
      throw new TypeError('ONNX feeds must be a named tensor record.')
    }
    const runtimeFeeds: Record<string, RuntimeTensorLike> = {}
    for (const [name, tensor] of Object.entries(feeds)) {
      const checked = checkedInputTensor(tensor, name)
      runtimeFeeds[name] = new runtime.Tensor(
        'float32',
        checked.data,
        checked.dims,
      )
    }
    const runtimeOutputs = await session.run(runtimeFeeds)
    if (
      typeof runtimeOutputs !== 'object' ||
      runtimeOutputs === null ||
      Array.isArray(runtimeOutputs)
    ) {
      throw new TypeError('ONNX Runtime returned an invalid output record.')
    }
    return Object.fromEntries(
      Object.entries(runtimeOutputs).map(([name, tensor]) => [
        name,
        checkedOutputTensor(tensor, name),
      ]),
    )
  },
})

const createSession = async (
  runtime: OnnxRuntimeModuleLike,
  backend: 'webgpu' | 'wasm',
  modelBytes: Uint8Array,
  sessionOptions: Readonly<Record<string, unknown>> | undefined,
): Promise<OnnxInferenceSessionLike> => {
  const session = await runtime.InferenceSession.create(
    new Uint8Array(modelBytes),
    {
      ...sessionOptions,
      executionProviders: [backend],
    },
  )
  if (
    typeof session !== 'object' ||
    session === null ||
    typeof session.run !== 'function'
  ) {
    throw new TypeError(
      `ONNX Runtime ${backend} returned an invalid inference session.`,
    )
  }
  return wrapSession(runtime, session)
}

/**
 * Creates a memoized, dynamically imported ONNX Runtime bridge.
 *
 * WebGPU is attempted only when the browser exposes the API. A failed WebGPU
 * import or session creation permanently switches this loader instance to the
 * WASM backend, avoiding repeated GPU failures for later models.
 */
export const createOnnxRuntimeSessionFactoryLoader = (
  options: OnnxRuntimeLoaderOptions = {},
): OnnxSessionFactoryLoader => {
  const importGpu = options.importWebGpuRuntime ?? importWebGpuRuntime
  const importWasm = options.importWasmRuntime ?? importWasmRuntime
  const supportsGpu = options.supportsWebGpu ?? browserSupportsWebGpu
  let factoryPromise: Promise<OnnxSessionFactory> | undefined

  return () => {
    if (!factoryPromise) {
      factoryPromise = Promise.resolve()
        .then(async () => {
          let webGpuEnabled = await supportsGpu()
          let webGpuRuntimePromise: Promise<OnnxRuntimeModuleLike> | undefined
          let wasmRuntimePromise: Promise<OnnxRuntimeModuleLike> | undefined

          const loadWebGpu = (): Promise<OnnxRuntimeModuleLike> => {
            webGpuRuntimePromise ??= importGpu().then((runtime) =>
              checkedRuntime(runtime, 'WebGPU'),
            )
            return webGpuRuntimePromise
          }
          const loadWasm = (): Promise<OnnxRuntimeModuleLike> => {
            wasmRuntimePromise ??= importWasm().then((runtime) =>
              checkedRuntime(runtime, 'WASM'),
            )
            return wasmRuntimePromise
          }

          return {
            createTensor(
              data: Float32Array,
              dims: readonly number[],
            ): OnnxTensorLike {
              if (!(data instanceof Float32Array)) {
                throw new TypeError(
                  'ONNX input tensors must contain Float32Array data.',
                )
              }
              return {
                data,
                dims: checkedDims(dims, data.length, 'ONNX input tensor'),
              }
            },
            async createSession(
              modelBytes: Uint8Array,
            ): Promise<OnnxInferenceSessionLike> {
              if (
                !(modelBytes instanceof Uint8Array) ||
                modelBytes.length === 0
              ) {
                throw new TypeError('The ONNX model must contain bytes.')
              }
              let webGpuFailure: unknown
              if (webGpuEnabled) {
                try {
                  return await createSession(
                    await loadWebGpu(),
                    'webgpu',
                    modelBytes,
                    options.webGpuSessionOptions,
                  )
                } catch (error) {
                  webGpuFailure = error
                  webGpuEnabled = false
                }
              }
              try {
                return await createSession(
                  await loadWasm(),
                  'wasm',
                  modelBytes,
                  options.wasmSessionOptions,
                )
              } catch (wasmFailure) {
                if (webGpuFailure !== undefined) {
                  throw new AggregateError(
                    [webGpuFailure, wasmFailure],
                    'ONNX Runtime failed to create both WebGPU and WASM sessions.',
                    { cause: wasmFailure },
                  )
                }
                throw wasmFailure
              }
            },
          } satisfies OnnxSessionFactory
        })
        .catch((error: unknown) => {
          factoryPromise = undefined
          throw error
        })
    }
    return factoryPromise
  }
}

/**
 * Default production loader used by model configuration and Worker code.
 * The two explicit dynamic-import specifiers let Vite emit the runtime outside
 * the initial application chunk.
 */
export const loadOnnxRuntimeWebSessionFactory: OnnxSessionFactoryLoader =
  createOnnxRuntimeSessionFactoryLoader()
