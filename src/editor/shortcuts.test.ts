import { afterEach, describe, expect, it } from 'vitest'
import {
  isEditableTarget,
  resolveEditorShortcut,
  shouldIgnoreEditorInput,
} from './shortcuts'

const idle = { busy: false, modalOpen: false }
const shortcut = (key: string, options: KeyboardEventInit = {}) =>
  resolveEditorShortcut(new KeyboardEvent('keydown', { key, ...options }), idle)

afterEach(() => document.body.replaceChildren())

describe('editor shortcut resolution', () => {
  it.each(['ctrlKey', 'metaKey'] as const)(
    'supports selection shortcuts with %s',
    (modifier) => {
      expect(shortcut('a', { [modifier]: true })).toEqual({
        action: 'select-all',
      })
      expect(shortcut('D', { [modifier]: true })).toEqual({
        action: 'duplicate',
      })
      expect(shortcut('g', { [modifier]: true, shiftKey: true })).toEqual({
        action: 'ungroup',
      })
      expect(shortcut('z', { [modifier]: true, shiftKey: true })).toEqual({
        action: 'redo',
      })
    },
  )

  it.each([
    ['ArrowLeft', -1, 0],
    ['ArrowRight', 1, 0],
    ['ArrowUp', 0, -1],
    ['ArrowDown', 0, 1],
  ] as const)('moves in document pixels with %s', (key, dx, dy) => {
    expect(shortcut(key)).toEqual({ action: 'nudge', dx, dy })
    expect(shortcut(key, { shiftKey: true })).toEqual({
      action: 'nudge',
      dx: dx * 10,
      dy: dy * 10,
    })
  })

  it('leaves unsupported modifiers and native paste to the browser', () => {
    expect(shortcut('ArrowRight', { altKey: true })).toBeNull()
    expect(shortcut('ArrowLeft', { ctrlKey: true })).toBeNull()
    expect(shortcut('d', { ctrlKey: true, shiftKey: true })).toBeNull()
    expect(shortcut('a', { ctrlKey: true, altKey: true })).toBeNull()
    expect(shortcut('v', { ctrlKey: true })).toBeNull()
    expect(shortcut('b', { shiftKey: true })).toBeNull()
  })

  it('preserves ordinary tool, history and zoom shortcuts', () => {
    expect(shortcut('v')).toEqual({ action: 'tool', tool: 'select' })
    expect(shortcut('z', { ctrlKey: true })).toEqual({ action: 'undo' })
    expect(shortcut('y', { ctrlKey: true })).toEqual({ action: 'redo' })
    expect(shortcut('+')).toEqual({ action: 'zoom-in' })
    expect(shortcut('?', { shiftKey: true })).toEqual({ action: 'help' })
  })
})

describe('global editor input guards', () => {
  it.each(['input', 'textarea', 'select'])(
    'protects native %s controls',
    (tag) => {
      const target = document.createElement(tag)
      document.body.append(target)
      const event = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
      })
      target.dispatchEvent(event)
      expect(resolveEditorShortcut(event, idle)).toBeNull()
      expect(
        shouldIgnoreEditorInput({ target, defaultPrevented: false }, idle),
      ).toBe(true)
    },
  )

  it('protects editable descendants and custom keyboard controls', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    editor.append(child)
    expect(isEditableTarget(child)).toBe(true)
    editor.setAttribute('contenteditable', 'false')
    expect(isEditableTarget(child)).toBe(false)
    editor.setAttribute('role', 'slider')
    expect(isEditableTarget(child)).toBe(true)
  })

  it('protects dialogs, busy operations, IME and already-handled input', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Delete',
      cancelable: true,
    })
    expect(resolveEditorShortcut(event, { ...idle, busy: true })).toBeNull()
    expect(
      resolveEditorShortcut(event, { ...idle, modalOpen: true }),
    ).toBeNull()
    expect(shortcut('Delete', { isComposing: true })).toBeNull()
    expect(shortcut('Delete', { keyCode: 229 })).toBeNull()
    event.preventDefault()
    expect(resolveEditorShortcut(event, idle)).toBeNull()
    expect(shouldIgnoreEditorInput(event, idle)).toBe(true)
  })
})
