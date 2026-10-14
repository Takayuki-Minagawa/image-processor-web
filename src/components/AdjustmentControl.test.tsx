import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdjustmentControl from './AdjustmentControl'

afterEach(cleanup)

const renderControl = (
  overrides: Partial<ComponentProps<typeof AdjustmentControl>> = {},
) => {
  const onChange = vi.fn()
  const props = {
    label: 'Brightness',
    value: 0.4,
    locale: 'en' as const,
    onChange,
    ...overrides,
  }
  const result = render(<AdjustmentControl {...props} />)
  return {
    ...result,
    props,
    onChange,
    slider: screen.getByRole('slider', { name: props.label }),
    input: screen.getByRole('spinbutton'),
  }
}

describe('AdjustmentControl', () => {
  it('uses the displayed brightness scale for both named inputs', () => {
    const { slider, input, onChange } = renderControl()
    expect(slider).toHaveValue('40')
    expect(slider).toHaveAttribute('aria-valuetext', '40')
    expect(slider).toHaveAttribute('min', '-100')
    expect(slider).toHaveAttribute('max', '100')
    expect(slider).toHaveAttribute('step', 'any')
    expect(slider).toHaveAccessibleDescription('-100 to 100')
    expect(input).toHaveAccessibleName('Brightness (number)')
    expect(input).toHaveValue('40')
    expect(input).toHaveAttribute('aria-valuemin', '-100')
    expect(input).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByRole('status')).toHaveTextContent('40')

    fireEvent.change(slider, { target: { value: '50' } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(0.5)
  })

  it('commits a displayed numeric value of 40 as internal brightness 0.4', async () => {
    const { input, onChange } = renderControl({ value: 0 })
    const user = userEvent.setup()
    await user.clear(input)
    await user.type(input, '40')
    expect(onChange).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(0.4)
  })

  it('keeps slider, value output, and number synchronized after a commit and Undo', async () => {
    const { input, slider, onChange, props, rerender } = renderControl()
    const user = userEvent.setup()
    await user.clear(input)
    await user.type(input, '-25{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(-0.25)
    rerender(<AdjustmentControl {...props} value={-0.25} />)
    expect(slider).toHaveValue('-25')
    expect(slider).toHaveAttribute('aria-valuetext', '-25')
    expect(screen.getByRole('status')).toHaveTextContent('-25')

    rerender(<AdjustmentControl {...props} value={0.4} />)
    expect(slider).toHaveValue('40')
    expect(input).toHaveValue('40')
    expect(screen.getByRole('status')).toHaveTextContent('40')
  })

  it('rejects an out-of-range number without changing the filter', () => {
    const { input, onChange } = renderControl()
    fireEvent.change(input, { target: { value: '101' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(
      '-100 to 100 Enter a number from -100 to 100.',
    )
  })

  it('maps the full displayed gamma range back to engine values', () => {
    const { slider, input, onChange } = renderControl({
      label: 'Gamma',
      value: 1,
      min: 0.1,
      max: 2.2,
    })
    expect(slider).toHaveValue('100')
    expect(slider).toHaveAttribute('min', '10')
    expect(slider).toHaveAttribute('max', '220')
    expect(input).toHaveValue('100')
    fireEvent.change(slider, { target: { value: '10' } })
    expect(onChange).toHaveBeenLastCalledWith(0.1)
    fireEvent.change(input, { target: { value: '220' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(2.2)
  })

  it('exposes pixelate in pixels with an unscaled range and Japanese labels', () => {
    const { slider, input, onChange } = renderControl({
      label: 'ピクセレート',
      value: 1,
      min: 1,
      max: 64,
      step: 1,
      integer: true,
      scale: 1,
      unit: 'px',
      locale: 'ja',
    })
    expect(slider).toHaveValue('1')
    expect(slider).toHaveAttribute('aria-valuetext', '1px')
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '64')
    expect(slider).toHaveAttribute('step', '1')
    expect(slider).toHaveAccessibleDescription('1〜64px')
    expect(input).toHaveAccessibleName('ピクセレート（数値）')
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(12)
  })

  it('rejects fractional pixel sizes instead of displaying an unapplied value', () => {
    const { slider, input, onChange } = renderControl({
      label: 'Pixelate',
      value: 1,
      min: 1,
      max: 64,
      scale: 1,
      step: 1,
      integer: true,
      unit: 'px',
    })
    fireEvent.change(input, { target: { value: '1.1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('1 to 64px Enter a whole number.')
    expect(slider).toHaveValue('1')
  })

  it.each([40.5, 40.123456789])(
    'keeps a precise numeric adjustment %s identical in every control',
    (displayed) => {
      const { input, slider, onChange, props, rerender } = renderControl({
        value: 0,
      })
      fireEvent.change(input, { target: { value: String(displayed) } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onChange).toHaveBeenCalledExactlyOnceWith(displayed / 100)
      rerender(<AdjustmentControl {...props} value={displayed / 100} />)
      expect(slider).toHaveAttribute('step', 'any')
      expect(slider).toHaveValue(String(displayed))
      expect(slider).toHaveAttribute('aria-valuetext', String(displayed))
      expect(input).toHaveValue(String(displayed))
      expect(screen.getByRole('status')).toHaveTextContent(String(displayed))
    },
  )

  it('moves a continuous slider by the configured increment without discarding its fraction', () => {
    const { slider, onChange, props, rerender } = renderControl({
      value: 0.405,
    })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(0.415)
    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(0.415)
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(0.395)
    fireEvent.keyDown(slider, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(0.395)

    rerender(<AdjustmentControl {...props} value={0.999} />)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    rerender(<AdjustmentControl {...props} value={-0.999} />)
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(-1)
  })

  it('labels opacity and maps percentages without rounding artifacts', () => {
    const { slider, input, onChange } = renderControl({
      label: '不透明度',
      value: 0.29,
      min: 0,
      max: 1,
      unit: '%',
      locale: 'ja',
    })
    expect(slider).toHaveValue('29')
    expect(slider).toHaveAttribute('aria-valuetext', '29%')
    expect(input).toHaveValue('29')
    fireEvent.change(slider, { target: { value: '100' } })
    expect(onChange).toHaveBeenLastCalledWith(1)
  })
})
