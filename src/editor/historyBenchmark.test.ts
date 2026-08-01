import { describe, expect, it } from 'vitest'
import { benchmarkFourKHistory } from './historyBenchmark'

describe('ADR-003 history migration benchmark', () => {
  it('keeps repeated 4K assets near one copy instead of 100 copies', () => {
    const result = benchmarkFourKHistory({ sampleAssetBytes: 2_048 })
    expect(result.scenario).toContain('20 layers')
    expect(result.snapshotEstimateBytes).toBeGreaterThan(8_000_000_000)
    expect(result.compactEstimateBytes).toBeLessThan(100_000_000)
    expect(result.reductionRatio).toBeGreaterThan(90)
    expect(result.decision).toBe('compact-snapshot')
  })
})
