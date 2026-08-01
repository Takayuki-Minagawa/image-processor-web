import { CompactHistory } from './compactHistory.ts'

export interface HistoryBenchmarkOptions {
  layerCount?: number
  operationCount?: number
  sampleAssetBytes?: number
  estimatedAssetBytes?: number
}

export interface HistoryBenchmarkResult {
  scenario: string
  elapsedMilliseconds: number
  snapshotEstimateBytes: number
  compactEstimateBytes: number
  reductionRatio: number
  decision: 'compact-snapshot'
}

const createAsset = (index: number, bytes: number): string => {
  const marker = `${index.toString(36)}-`
  return `data:image/png;base64,${marker.repeat(Math.ceil(bytes / marker.length)).slice(0, bytes)}`
}

/** Measures the ADR-003 migration trigger without allocating the full 4K set. */
export function benchmarkFourKHistory(
  options: HistoryBenchmarkOptions = {},
): HistoryBenchmarkResult {
  const layerCount = options.layerCount ?? 20
  const operationCount = options.operationCount ?? 100
  const sampleAssetBytes = options.sampleAssetBytes ?? 32 * 1_024
  // A conservative compressed 4K layer estimate; transparent/design layers
  // are often smaller, while photographs are commonly larger.
  const estimatedAssetBytes = options.estimatedAssetBytes ?? 4 * 1_024 * 1_024
  const assets = Array.from({ length: layerCount }, (_, index) =>
    createAsset(index, sampleAssetBytes),
  )
  const history = new CompactHistory<unknown>({ limit: operationCount })
  const started = performance.now()

  for (let operation = 0; operation < operationCount; operation += 1) {
    history.push({
      width: 3_840,
      height: 2_160,
      json: {
        objects: assets.map((src, index) => ({
          id: `layer-${index}`,
          src,
          left: index === operation % layerCount ? operation : index * 8,
          top: index * 5,
        })),
      },
    })
  }

  const elapsedMilliseconds = performance.now() - started
  const compact = history.stats()
  const structuralBytes = compact.structuralCharacters * 2
  const compactEstimateBytes =
    layerCount * estimatedAssetBytes + structuralBytes
  const snapshotEstimateBytes =
    layerCount * estimatedAssetBytes * operationCount + structuralBytes

  return {
    scenario: `3840x2160, ${layerCount} layers, ${operationCount} operations`,
    elapsedMilliseconds,
    snapshotEstimateBytes,
    compactEstimateBytes,
    reductionRatio: snapshotEstimateBytes / compactEstimateBytes,
    decision: 'compact-snapshot',
  }
}
