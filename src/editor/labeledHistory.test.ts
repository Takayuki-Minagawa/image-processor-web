import { describe, expect, it } from 'vitest'
import { LabeledHistory, type HistoryLabel } from './labeledHistory'

describe('LabeledHistory', () => {
  it('moves the current label with undo and redo, including the initial state', () => {
    const history = new LabeledHistory<number>()
    history.reset(0, 'New document', '09:00')
    history.push(1, 'Add rectangle', '09:01')
    history.push(2, 'Add ellipse', '09:02')
    const [initial, rectangle, ellipse] = history.labels

    expect(history.currentLabel).toEqual(ellipse)
    expect(history.undo()).toBe(1)
    expect(history.currentLabel).toEqual(rectangle)
    expect(history.undo()).toBe(0)
    expect(history.currentLabel).toEqual(initial)
    expect(history.undo()).toBeUndefined()
    expect(history.currentLabel).toEqual(initial)
    expect(history.redo()).toBe(1)
    expect(history.currentLabel).toEqual(rectangle)
    expect(history.redo()).toBe(2)
    expect(history.redo()).toBeUndefined()
    expect(history.currentLabel).toEqual(ellipse)
  })

  it('discards abandoned labels when editing after undo', () => {
    const history = new LabeledHistory<number>()
    history.reset(0, 'New document', '09:00')
    history.push(1, 'Rectangle', '09:01')
    history.push(2, 'Ellipse', '09:02')
    history.push(3, 'Text', '09:03')
    const originalIds = history.labels.map(({ id }) => id)
    history.undo()
    history.undo()

    history.push(4, 'Image', '09:04')

    expect(history.entries()).toEqual([0, 1, 4])
    expect(history.labels.map(({ label }) => label)).toEqual([
      'New document',
      'Rectangle',
      'Image',
    ])
    expect(history.labels.slice(0, 2).map(({ id }) => id)).toEqual(
      originalIds.slice(0, 2),
    )
    expect(originalIds).not.toContain(history.currentLabel?.id)
    expect(history.canRedo).toBe(false)
  })

  it('does not add labels or remove redo for duplicate snapshots', () => {
    const history = new LabeledHistory<{ left: number; top: number }>()
    history.reset({ left: 0, top: 0 }, 'New document', '09:00')
    history.push({ left: 10, top: 20 }, 'Move layer', '09:01')
    history.undo()
    const labels = history.labels
    const initial = history.currentLabel

    expect(
      history.push({ top: 0, left: 0 }, 'Duplicate operation', '09:02'),
    ).toBe(false)
    expect(history.labels).toEqual(labels)
    expect(history.currentLabel).toEqual(initial)
    expect(history.canRedo).toBe(true)
    expect(history.redo()).toEqual({ left: 10, top: 20 })
    expect(history.currentLabel?.label).toBe('Move layer')
  })

  it('retains labels for all 100 checkpoints and removes matching oldest entries', () => {
    const history = new LabeledHistory<number>()
    for (let revision = 0; revision < 105; revision += 1) {
      history.push(revision, `Revision ${revision}`, String(revision))
    }

    expect(history.limit).toBe(100)
    expect(history.labels).toHaveLength(history.size)
    expect(history.labels[0]).toMatchObject({ label: 'Revision 5', time: '5' })
    expect(history.entries()[0]).toBe(5)
    while (history.canUndo) history.undo()
    expect(history.current()).toBe(5)
    expect(history.currentLabel).toEqual(history.labels[0])
    expect(history.canRedo).toBe(true)

    history.push(200, 'New branch', '10:00')
    expect(history.entries()).toEqual([5, 200])
    expect(history.labels.map(({ label }) => label)).toEqual([
      'Revision 5',
      'New branch',
    ])
  })

  it('preserves label identity and redo while replacing navigation state', () => {
    const history = new LabeledHistory<{ page: string; revision: number }>()
    history.reset({ page: 'one', revision: 0 }, 'New document', '09:00')
    history.push({ page: 'one', revision: 1 }, 'Add layer', '09:01')
    history.undo()
    const labels = history.labels
    const initial = history.currentLabel

    expect(history.replaceCurrent({ page: 'two', revision: 0 })).toBe(true)
    expect(history.current()).toEqual({ page: 'two', revision: 0 })
    expect(history.currentLabel).toEqual(initial)
    expect(history.labels).toEqual(labels)
    expect(history.redo()).toEqual({ page: 'one', revision: 1 })
    expect(history.currentLabel?.label).toBe('Add layer')
  })

  it('resets labels for a new document without reusing previous checkpoint IDs', () => {
    const history = new LabeledHistory<number>()
    history.reset(0, 'New document', '09:00')
    history.push(1, 'Add layer', '09:01')
    const previousIds = history.labels.map(({ id }) => id)

    history.reset(10, 'Open project', '10:00')

    expect(history.entries()).toEqual([10])
    expect(history.labels).toEqual([
      { id: history.currentLabel?.id, label: 'Open project', time: '10:00' },
    ])
    expect(previousIds).not.toContain(history.currentLabel?.id)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)

    history.reset()
    expect(history.labels).toEqual([])
    expect(history.currentLabel).toBeUndefined()
    expect(history.current()).toBeUndefined()
    expect(history.index).toBe(-1)
  })

  it('keeps compact image storage and leaves labels intact after a rejected snapshot', () => {
    const image = `data:image/png;base64,${'A'.repeat(2_048)}`
    const history = new LabeledHistory<unknown>({ limit: 2 })
    history.push({ left: 0, src: image }, 'Import image', '09:00')
    history.push({ left: 10, src: image }, 'Move image', '09:01')
    const labels = history.labels
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(() => history.push(cyclic, 'Rejected operation', '09:02')).toThrow(
      /cycles/u,
    )
    expect(history.labels).toEqual(labels)
    expect(history.currentLabel?.label).toBe('Move image')
    expect(history.stats().uniqueAssets).toBe(1)
    expect(history.stats().assetCharacters).toBe(image.length)

    history.clear()
    expect(history.labels).toEqual([])
    expect(history.stats().uniqueAssets).toBe(0)
  })

  it('keeps its timeline intact when the caller changes the returned labels array', () => {
    const history = new LabeledHistory<number>()
    history.reset(0, 'New document', '09:00')
    const labels = history.labels as HistoryLabel[]
    labels.pop()

    expect(history.labels).toHaveLength(1)
    expect(history.currentLabel?.label).toBe('New document')
  })
})
