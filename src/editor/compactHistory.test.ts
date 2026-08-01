import { describe, expect, it } from 'vitest'
import { CompactHistory } from './compactHistory'

const dataUrl = (character: string, length = 2_048): string =>
  `data:image/png;base64,${character.repeat(length)}`

describe('CompactHistory', () => {
  it('deduplicates embedded image payloads across snapshots', () => {
    const image = dataUrl('A')
    const history = new CompactHistory<{
      json: { objects: Array<{ left: number; src: string }> }
    }>({ assetThreshold: 64 })

    for (let left = 0; left < 100; left += 1) {
      history.push({ json: { objects: [{ left, src: image }] } })
    }

    expect(history.size).toBe(100)
    expect(history.stats().uniqueAssets).toBe(1)
    expect(history.stats().assetCharacters).toBe(image.length)
    expect(history.stats().estimatedBytes).toBeLessThan(image.length * 20)
    expect(history.current()?.json.objects[0]).toEqual({ left: 99, src: image })
  })

  it('preserves branching undo, redo, limits, and reset', () => {
    const history = new CompactHistory<{ value: number; src: string }>({
      limit: 2,
      assetThreshold: 64,
    })
    const image = dataUrl('B')
    history.push({ value: 1, src: image })
    history.push({ value: 2, src: image })
    expect(history.undo()?.value).toBe(1)
    expect(history.redo()?.value).toBe(2)
    history.push({ value: 3, src: image })
    expect(history.entries().map(({ value }) => value)).toEqual([2, 3])

    history.reset({ value: 4, src: image })
    expect(history.entries()).toEqual([{ value: 4, src: image }])
    expect(history.stats().uniqueAssets).toBe(1)
  })

  it('replaces the hydrated current entry without growing history', () => {
    const history = new CompactHistory<{ page: string; src: string }>({
      assetThreshold: 64,
    })
    const image = dataUrl('C')
    history.push({ page: 'one', src: image })

    expect(history.replaceCurrent({ page: 'two', src: image })).toBe(true)
    expect(history.size).toBe(1)
    expect(history.current()).toEqual({ page: 'two', src: image })
    expect(history.stats().uniqueAssets).toBe(1)
  })

  it('prunes assets that fall outside the bounded history window', () => {
    const history = new CompactHistory<{ value: number; src: string }>({
      limit: 2,
      assetThreshold: 64,
    })
    const first = dataUrl('D')
    const second = dataUrl('E')
    const third = dataUrl('F')

    history.push({ value: 1, src: first })
    history.push({ value: 2, src: second })
    history.push({ value: 3, src: third })

    expect(history.entries()).toEqual([
      { value: 2, src: second },
      { value: 3, src: third },
    ])
    expect(history.stats().uniqueAssets).toBe(2)
    expect(history.stats().assetCharacters).toBe(second.length + third.length)
  })

  it('prunes abandoned redo assets and replaced current assets', () => {
    const history = new CompactHistory<{ value: number; src: string }>({
      limit: 3,
      assetThreshold: 64,
    })
    const first = dataUrl('G')
    const second = dataUrl('H')
    const abandoned = dataUrl('I')
    const branch = dataUrl('J')
    const replacement = dataUrl('K')

    history.push({ value: 1, src: first })
    history.push({ value: 2, src: second })
    history.push({ value: 3, src: abandoned })
    history.undo()
    history.push({ value: 4, src: branch })
    expect(history.stats().uniqueAssets).toBe(3)

    history.replaceCurrent({ value: 5, src: replacement })
    expect(history.entries()).toEqual([
      { value: 1, src: first },
      { value: 2, src: second },
      { value: 5, src: replacement },
    ])
    expect(history.stats().uniqueAssets).toBe(3)
    expect(history.stats().assetCharacters).toBe(
      first.length + second.length + replacement.length,
    )
  })

  it('rejects cyclic and non-JSON snapshots', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const history = new CompactHistory<unknown>()
    expect(() => history.push(cyclic)).toThrow(/cycles/u)
    expect(() => history.push({ value: BigInt(1) })).toThrow(/JSON-compatible/u)
  })
})
