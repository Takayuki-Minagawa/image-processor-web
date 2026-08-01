import { describe, expect, it } from 'vitest'
import { History } from './history'

describe('History', () => {
  it('supports undo and redo around an initial state', () => {
    const history = new History<string>()
    history.push('blank')
    history.push('rectangle')
    history.push('rotated rectangle')

    expect(history.current()).toBe('rotated rectangle')
    expect(history.undo()).toBe('rectangle')
    expect(history.undo()).toBe('blank')
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBe('rectangle')
    expect(history.canRedo).toBe(true)
  })

  it('suppresses structurally equal consecutive snapshots', () => {
    const history = new History<{ objects: unknown[] }>()
    expect(history.push({ objects: [{ id: 1, left: 10 }] })).toBe(true)
    expect(history.push({ objects: [{ left: 10, id: 1 }] })).toBe(false)
    expect(history.size).toBe(1)
  })

  it('tracks repeated object comparisons as pairs', () => {
    type Branch = {
      value: number
      parent?: { first: Branch; second: Branch }
    }

    const shared: Branch = { value: 1 }
    const left = { first: shared, second: shared }
    shared.parent = left

    const first: Branch = { value: 1 }
    const second: Branch = { value: 1 }
    const right = { first, second }
    first.parent = right
    second.parent = right

    const history = new History<typeof left>()
    expect(history.push(left)).toBe(true)
    expect(history.push(right)).toBe(false)
    expect(history.size).toBe(1)
  })

  it('discards the redo branch after a new commit', () => {
    const history = new History<number>()
    history.push(0)
    history.push(1)
    history.push(2)
    history.undo()

    history.push(3)

    expect(history.entries()).toEqual([0, 1, 3])
    expect(history.current()).toBe(3)
    expect(history.canRedo).toBe(false)
    expect(history.redo()).toBeUndefined()
  })

  it('replaces navigation state without adding an undo step or dropping redo', () => {
    const history = new History<{ page: string; value: number }>()
    history.push({ page: 'one', value: 0 })
    history.push({ page: 'one', value: 1 })
    history.undo()

    expect(history.replaceCurrent({ page: 'two', value: 0 })).toBe(true)
    expect(history.size).toBe(2)
    expect(history.current()).toEqual({ page: 'two', value: 0 })
    expect(history.redo()).toEqual({ page: 'one', value: 1 })
  })

  it('retains at most 100 snapshots by default', () => {
    const history = new History<number>()
    for (let value = 0; value < 105; value += 1) {
      history.push(value)
    }

    expect(history.limit).toBe(100)
    expect(history.size).toBe(100)
    expect(history.entries()[0]).toBe(5)

    for (let count = 0; count < 99; count += 1) {
      history.undo()
    }
    expect(history.current()).toBe(5)
    expect(history.canUndo).toBe(false)
  })

  it('supports a custom limit and equality strategy', () => {
    const history = new History<{ revision: number; label: string }>({
      limit: 2,
      equals: (left, right) => left.revision === right.revision,
    })
    history.push({ revision: 1, label: 'before' })
    history.push({ revision: 1, label: 'renamed' })
    history.push({ revision: 2, label: 'middle' })
    history.push({ revision: 3, label: 'after' })

    expect(history.entries().map(({ revision }) => revision)).toEqual([2, 3])
  })

  it('can reset to a new baseline or become empty', () => {
    const history = new History<number>()
    history.push(1)
    history.push(2)

    history.reset(10)
    expect(history.entries()).toEqual([10])
    expect(history.canUndo).toBe(false)

    history.clear()
    expect(history.current()).toBeUndefined()
    expect(history.index).toBe(-1)
    expect(history.size).toBe(0)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid limit %s', (limit) => {
    expect(() => new History({ limit })).toThrow(RangeError)
  })
})
