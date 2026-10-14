import { useState, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NumericInput from './NumericInput'

afterEach(cleanup)

const renderInput = (
  overrides: Partial<ComponentProps<typeof NumericInput>> = {},
) => {
  const onCommit = vi.fn()
  const props = {
    label: 'Width',
    value: 240,
    locale: 'en' as const,
    onCommit,
    ...overrides,
  }
  const result = render(<NumericInput {...props} />)
  return {
    ...result,
    onCommit,
    props,
    input: screen.getByRole('spinbutton', { name: props.label }),
  }
}

describe('NumericInput', () => {
  it('keeps empty, sign, and decimal drafts until the user commits a number', async () => {
    const { input, onCommit } = renderInput({ label: 'X' })
    const user = userEvent.setup()
    await user.clear(input)
    expect(input).toHaveValue('')

    await user.type(input, '-')
    expect(input).toHaveValue('-')
    await user.type(input, '.')
    expect(input).toHaveValue('-.')
    await user.type(input, '5')
    expect(input).toHaveValue('-.5')
    expect(onCommit).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')
    expect(input).toHaveValue('-0.5')
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(-0.5)
  })

  it('commits on blur and does not commit twice after Enter updates the model', async () => {
    const onCommit = vi.fn()
    function ControlledInput() {
      const [value, setValue] = useState(240)
      return (
        <NumericInput
          label="Width"
          value={value}
          locale="en"
          onCommit={(next) => {
            onCommit(next)
            setValue(next)
          }}
        />
      )
    }
    render(<ControlledInput />)
    const input = screen.getByRole('spinbutton', { name: 'Width' })
    const user = userEvent.setup()
    await user.clear(input)
    await user.type(input, '320{Enter}')
    await user.tab()
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(320)
    expect(input).toHaveAttribute('aria-valuenow', '320')

    await user.clear(input)
    await user.type(input, '400')
    await user.tab()
    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(onCommit).toHaveBeenLastCalledWith(400)
  })

  it('cancels a draft and prevents Escape from reaching an enclosing dialog', async () => {
    const onCommit = vi.fn()
    const parentKeyDown = vi.fn()
    render(
      <div onKeyDown={parentKeyDown}>
        <NumericInput
          label="Width"
          value={240}
          locale="en"
          onCommit={onCommit}
        />
      </div>,
    )
    const input = screen.getByRole('spinbutton', { name: 'Width' })
    const user = userEvent.setup()
    await user.clear(input)
    await user.type(input, '999')
    parentKeyDown.mockClear()
    await user.keyboard('{Escape}')
    await user.tab()

    expect(input).toHaveValue('240')
    expect(onCommit).not.toHaveBeenCalled()
    expect(parentKeyDown).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: 'Escape' }),
    )
  })

  it.each(['', '-', '.', 'not a number', 'Infinity'])(
    'keeps the model unchanged and explains an invalid draft %j',
    (draft) => {
      const { input, onCommit } = renderInput()
      fireEvent.change(input, { target: { value: draft } })
      fireEvent.blur(input)

      expect(input).toHaveValue(draft)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription('Enter a valid number.')
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Enter a valid number.',
      )
      expect(onCommit).not.toHaveBeenCalled()
    },
  )

  it.each([
    { min: 1, max: 10, draft: '0', message: 'Enter a number from 1 to 10.' },
    {
      min: 1,
      max: undefined,
      draft: '-1',
      message: 'Enter a number of at least 1.',
    },
    {
      min: undefined,
      max: 10,
      draft: '11',
      message: 'Enter a number no greater than 10.',
    },
  ])('validates bounds and recovers after an error: $message', (testCase) => {
    const { input, onCommit } = renderInput({
      value: 5,
      min: testCase.min,
      max: testCase.max,
    })
    fireEvent.change(input, { target: { value: testCase.draft } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(testCase.message)
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '6' } })
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(6)
  })

  it('replaces a pending draft and its error when Undo supplies an external value', () => {
    const { input, onCommit, props, rerender } = renderInput({ min: 1 })
    fireEvent.change(input, { target: { value: '-' } })
    fireEvent.blur(input)
    expect(input).toHaveAttribute('aria-invalid', 'true')

    rerender(<NumericInput {...props} value={120} />)

    expect(input).toHaveValue('120')
    expect(input).toHaveAttribute('aria-valuenow', '120')
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('leaves composing Enter and arrow keys to the IME', () => {
    const { input, onCommit } = renderInput()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '300' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'ArrowUp', isComposing: true })
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(input).toHaveValue('300')
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(300)
  })

  it('increments decimal drafts with arrow keys and stays within bounds', () => {
    const { input, onCommit } = renderInput({
      value: 0.2,
      min: 0,
      max: 1,
      step: 0.1,
    })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('0.3')
    expect(onCommit).toHaveBeenLastCalledWith(0.3)

    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('1')
    expect(onCommit).toHaveBeenLastCalledWith(1)

    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('0')
    expect(onCommit).toHaveBeenLastCalledWith(0)
  })

  it('explains integer-only fields and recovers to an integer with arrow keys', () => {
    const { input, onCommit } = renderInput({
      value: 1,
      min: 1,
      integer: true,
      locale: 'ja',
    })
    fireEvent.change(input, { target: { value: '1.1' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('整数を入力してください。')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('2')
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('announces Japanese validation together with any existing description', () => {
    render(
      <>
        <small id="size-unit">単位: px</small>
        <NumericInput
          label="幅"
          value={240}
          min={1}
          locale="ja"
          describedBy="size-unit"
          onCommit={vi.fn()}
        />
      </>,
    )
    const input = screen.getByRole('spinbutton', { name: '幅' })
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(input).toHaveAccessibleDescription(
      '単位: px 1以上の数値を入力してください。',
    )
  })
})
