import { IText, Textbox } from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FabricEditorEngine,
  type FabricEditorCallbacks,
  type EditorSnapshot,
} from './fabricEngine'
import { CompactHistory } from './compactHistory'

const engines = new Set<FabricEditorEngine>()
const createEngine = (callbacks: FabricEditorCallbacks = {}) => {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const engine = new FabricEditorEngine(canvas, {
    width: 600,
    height: 400,
    callbacks,
  })
  engines.add(engine)
  return engine
}

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
})

describe('FabricEditorEngine selected text content', () => {
  it('commits body and size once and restores both through undo and redo', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    const id = engine.addText('Before', { fontSize: 48, fontFamily: 'serif' })
    engine.setSelectedTextStyle({ stroke: '#ffffff', strokeWidth: 2 })
    const history = new CompactHistory<EditorSnapshot>()
    history.push(engine.snapshot())
    onChanged.mockClear()

    expect(
      engine.setSelectedTextContent({
        text: 'After\nSecond line',
        fontSize: 32.5,
      }),
    ).toBe(true)
    history.push(engine.snapshot())
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('text-changed')
    expect(engine.getSelectedTextContent()).toEqual({
      id,
      text: 'After\nSecond line',
      fontSize: 32.5,
      fontFamily: 'serif',
      locked: false,
    })
    expect(engine.getSelectedTextStyle()).toMatchObject({
      stroke: '#ffffff',
      strokeWidth: 2,
    })

    await engine.restore(history.undo()!)
    engine.selectLayer(id)
    expect(engine.getSelectedTextContent()).toMatchObject({
      text: 'Before',
      fontSize: 48,
    })
    await engine.restore(history.redo()!)
    engine.selectLayer(id)
    expect(engine.getSelectedTextContent()).toMatchObject({
      text: 'After\nSecond line',
      fontSize: 32.5,
    })
  })

  it('preserves wrapping width and accepts intentionally empty text', () => {
    const engine = createEngine()
    engine.addText('Wrapped', { layoutMode: 'wrap', width: 180 })
    const text = engine.getCanvas().getActiveObject() as Textbox
    expect(text).toBeInstanceOf(Textbox)
    expect(
      engine.setSelectedTextContent({ text: 'Updated\ncontent', fontSize: 24 }),
    ).toBe(true)
    expect(text.width).toBe(180)
    expect(engine.setSelectedTextContent({ text: '', fontSize: 24 })).toBe(true)
    expect(engine.getSelectedTextContent()?.text).toBe('')
  })

  it('does not rewrite the newlines used by vertical text', () => {
    const engine = createEngine()
    engine.addText('縦書き', { vertical: true })
    expect(engine.getSelectedTextContent()?.text).toBe('縦\n書\nき')
    expect(
      engine.setSelectedTextContent({ text: '文\n字', fontSize: 36 }),
    ).toBe(true)
    expect(engine.getSelectedTextContent()?.text).toBe('文\n字')
    expect(
      (engine.snapshot().json.objects as Array<Record<string, unknown>>)[0],
    ).toMatchObject({
      editorVerticalText: true,
      text: '文\n字',
    })
  })

  it('rejects invalid or unchanged updates without a history event', () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    engine.addText('Original')
    onChanged.mockClear()
    for (const fontSize of [0, 5, 513, NaN, Infinity]) {
      expect(engine.setSelectedTextContent({ text: 'Changed', fontSize })).toBe(
        false,
      )
    }
    expect(
      engine.setSelectedTextContent({ text: 'Original', fontSize: 48 }),
    ).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()
    engine.addRect()
    expect(engine.getSelectedTextContent()).toBeNull()
    expect(
      engine.setSelectedTextContent({ text: 'Changed', fontSize: 24 }),
    ).toBe(false)
  })

  it('protects selected text inside a locked group', () => {
    const engine = createEngine()
    const textId = engine.addText('Protected')
    engine.addRect()
    engine.selectLayer(textId, true)
    const groupId = engine.groupSelection()!
    engine.selectLayer(textId)
    engine.setLayerLocked(groupId, true)
    expect(engine.getSelectedTextContent()).toMatchObject({ locked: true })
    expect(
      engine.setSelectedTextContent({ text: 'Changed', fontSize: 24 }),
    ).toBe(false)
    expect(engine.getSelectedTextContent()?.text).toBe('Protected')
  })

  it('updates text dimensions and exits canvas editing before applying a form draft', () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    engine.addText('Small', { fontSize: 12 })
    const text = engine.getCanvas().getActiveObject() as IText
    const oldWidth = text.width
    text.enterEditing()
    onChanged.mockClear()
    expect(
      engine.setSelectedTextContent({
        text: 'A much longer text',
        fontSize: 48,
      }),
    ).toBe(true)
    expect(text.isEditing).toBe(false)
    expect(text.width).toBeGreaterThan(oldWidth)
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('text-changed')
  })
})
