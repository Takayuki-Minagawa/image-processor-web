import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SelectedTextContent } from '../editor/fabricEngine'
import SelectedTextEditor from './SelectedTextEditor'

const selected: SelectedTextContent = {
  id: 'text-1',
  text: 'Original text',
  fontSize: 48,
  fontFamily: 'system-ui',
  locked: false,
}

afterEach(cleanup)

describe('SelectedTextEditor', () => {
  it('keeps a multiline draft and a cleared font size until one explicit commit', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <SelectedTextEditor locale="en" value={selected} onApply={onApply} />,
    )
    const body = screen.getByRole('textbox', { name: 'Text content' })
    const size = screen.getByRole('textbox', { name: 'Font size (px)' })
    await user.clear(body)
    await user.type(body, 'Heading{Enter}Body')
    await user.clear(size)
    expect(size).toHaveValue('')
    expect(onApply).not.toHaveBeenCalled()
    await user.type(size, '32.5')
    await user.click(screen.getByRole('button', { name: 'Apply text changes' }))
    expect(onApply).toHaveBeenCalledExactlyOnceWith({
      text: 'Heading\nBody',
      fontSize: 32.5,
    })
  })

  it('explains invalid sizes and discards drafts with Escape', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <SelectedTextEditor locale="en" value={selected} onApply={onApply} />,
    )
    const size = screen.getByRole('textbox', { name: 'Font size (px)' })
    await user.clear(size)
    await user.type(size, '-')
    await user.click(screen.getByRole('button', { name: 'Apply text changes' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('6 to 512')
    expect(size).toHaveAttribute('aria-invalid', 'true')
    await user.click(size)
    await user.keyboard('{Escape}')
    expect(size).toHaveValue('48')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not commit Japanese composition with Ctrl+Enter', () => {
    const onApply = vi.fn()
    render(
      <SelectedTextEditor locale="ja" value={selected} onApply={onApply} />,
    )
    const body = screen.getByRole('textbox', { name: '本文' })
    fireEvent.compositionStart(body)
    fireEvent.change(body, { target: { value: '日本語' } })
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.compositionEnd(body)
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true, keyCode: 229 })
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true })
    expect(onApply).toHaveBeenCalledExactlyOnceWith({
      text: '日本語',
      fontSize: 48,
    })
  })

  it('refreshes drafts when selection or the committed text changes after undo', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const { rerender } = render(
      <SelectedTextEditor locale="en" value={selected} onApply={onApply} />,
    )
    const body = screen.getByRole('textbox', { name: 'Text content' })
    await user.clear(body)
    await user.type(body, 'Unsaved draft')
    rerender(
      <SelectedTextEditor
        locale="en"
        value={{ ...selected, id: 'text-2', text: 'Other layer' }}
        onApply={onApply}
      />,
    )
    expect(body).toHaveValue('Other layer')
    rerender(
      <SelectedTextEditor
        locale="en"
        value={{ ...selected, id: 'text-2', text: 'Restored', fontSize: 24 }}
        onApply={onApply}
      />,
    )
    expect(body).toHaveValue('Restored')
    expect(screen.getByRole('textbox', { name: 'Font size (px)' })).toHaveValue(
      '24',
    )
  })

  it('disables editing when the selected layer is locked or the editor is busy', () => {
    const onApply = vi.fn()
    const { rerender } = render(
      <SelectedTextEditor
        locale="en"
        value={{ ...selected, locked: true }}
        onApply={onApply}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Text content' })).toBeDisabled()
    expect(screen.getByText('Unlock the layer to edit its text.')).toBeVisible()
    rerender(
      <SelectedTextEditor
        locale="en"
        value={selected}
        disabled
        onApply={onApply}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Text content' })).toBeDisabled()
  })
})
