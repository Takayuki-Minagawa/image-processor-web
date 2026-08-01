import { benchmarkFourKHistory } from '../src/editor/historyBenchmark.ts'

const result = benchmarkFourKHistory()
console.log(JSON.stringify(result, null, 2))
