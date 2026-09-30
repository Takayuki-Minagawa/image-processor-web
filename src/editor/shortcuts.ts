import type { EditorTool } from './fabricEngine'

export interface EditorInputContext {
  busy: boolean
  modalOpen: boolean
}

interface EditorInputEvent {
  target: EventTarget | null
  defaultPrevented: boolean
  isComposing?: boolean
}

export type EditorShortcut =
  | { action: 'undo' | 'redo' | 'save' | 'open' | 'copy' | 'cut' }
  | { action: 'group' | 'ungroup' | 'duplicate' | 'select-all' | 'delete' }
  | { action: 'zoom-in' | 'zoom-out' | 'zoom-100' | 'help' }
  | { action: 'tool'; tool: EditorTool }
  | { action: 'nudge'; dx: number; dy: number }

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (
    target.closest(
      'input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"], [role="tab"], [role="menuitem"], [role="option"]',
    )
  ) {
    return true
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true
  const editable = target.closest('[contenteditable]')
  return (
    editable !== null && editable.getAttribute('contenteditable') !== 'false'
  )
}

/** Global canvas commands must not consume input owned by another control. */
export function shouldIgnoreEditorInput(
  event: EditorInputEvent,
  context: EditorInputContext,
): boolean {
  return (
    event.defaultPrevented ||
    Boolean(event.isComposing) ||
    context.busy ||
    context.modalOpen ||
    isEditableTarget(event.target)
  )
}

export function resolveEditorShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'code'
    | 'keyCode'
    | 'ctrlKey'
    | 'metaKey'
    | 'altKey'
    | 'shiftKey'
    | 'isComposing'
    | 'defaultPrevented'
    | 'target'
  >,
  context: EditorInputContext,
): EditorShortcut | null {
  // keyCode 229 also covers browsers' final IME keydown before compositionend.
  if (event.keyCode === 229 || shouldIgnoreEditorInput(event, context))
    return null
  const key = event.key.toLowerCase()
  const modifier = (event.metaKey || event.ctrlKey) && !event.altKey
  if (modifier) {
    switch (key) {
      case 'z':
        return { action: event.shiftKey ? 'redo' : 'undo' }
      case 'y':
        return { action: 'redo' }
      case 's':
        return { action: 'save' }
      case 'o':
        return { action: 'open' }
      case 'c':
        return { action: 'copy' }
      case 'x':
        return { action: 'cut' }
      case 'g':
        return { action: event.shiftKey ? 'ungroup' : 'group' }
      case 'a':
        return event.shiftKey ? null : { action: 'select-all' }
      case 'd':
        return event.shiftKey ? null : { action: 'duplicate' }
      default:
        return null
    }
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  const distance = event.shiftKey ? 10 : 1
  switch (key) {
    case 'arrowleft':
      return { action: 'nudge', dx: -distance, dy: 0 }
    case 'arrowright':
      return { action: 'nudge', dx: distance, dy: 0 }
    case 'arrowup':
      return { action: 'nudge', dx: 0, dy: -distance }
    case 'arrowdown':
      return { action: 'nudge', dx: 0, dy: distance }
    case 'delete':
    case 'backspace':
      return { action: 'delete' }
    case 'v':
      return event.shiftKey ? null : { action: 'tool', tool: 'select' }
    case 'b':
      return event.shiftKey ? null : { action: 'tool', tool: 'brush' }
    case 'e':
      return event.shiftKey ? null : { action: 'tool', tool: 'eraser' }
    case 'h':
      return event.shiftKey ? null : { action: 'tool', tool: 'pan' }
    case '+':
    case '=':
      return { action: 'zoom-in' }
    case '-':
      return { action: 'zoom-out' }
    case '0':
      return { action: 'zoom-100' }
  }
  if (
    key === '?' ||
    (event.shiftKey && (event.code === 'Slash' || key === '/'))
  ) {
    return { action: 'help' }
  }
  return null
}
