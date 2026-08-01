import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdvancedStudioPanel } from './AdvancedStudioPanel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const sourceImage = (): ImageData => {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Test canvas is unavailable.')
  }
  const image = context.createImageData(2, 1)
  image.data.set([16, 32, 48, 255, 64, 96, 128, 255])
  return image
}

describe('AdvancedStudioPanel filter preview', () => {
  it('renders the advanced child tools in English when locale is en', () => {
    render(
      <AdvancedStudioPanel
        locale="en"
        documentWidth={2}
        documentHeight={1}
        getDocumentImageData={vi.fn(async () => sourceImage())}
        onSelectionMask={vi.fn()}
        onBackgroundResult={vi.fn()}
        onScriptCommands={vi.fn()}
        onApplyFilters={vi.fn()}
        onAddAdvancedAdjustment={vi.fn()}
        onUpdateAdvancedAdjustment={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Advanced filters' }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Advanced tools' }),
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Selection' })).toBeVisible()
    expect(
      screen.getByRole('img', { name: 'Lasso drawing area' }),
    ).toBeVisible()
  })

  it('uses the current document image and the CPU fallback for a real filtered preview', async () => {
    const getDocumentImageData = vi.fn(async () => sourceImage())
    render(
      <AdvancedStudioPanel
        documentWidth={2}
        documentHeight={1}
        getDocumentImageData={getDocumentImageData}
        advancedAdjustment={{
          id: 'adjustment-preview',
          operations: [{ id: 'invert', params: { amount: 1 } }],
        }}
        onSelectionMask={vi.fn()}
        onBackgroundResult={vi.fn()}
        onScriptCommands={vi.fn()}
        onApplyFilters={vi.fn()}
        onAddAdvancedAdjustment={vi.fn()}
        onUpdateAdvancedAdjustment={vi.fn()}
      />,
    )

    await waitFor(
      () =>
        expect(
          screen.getByAltText('フィルター適用後のプレビュー'),
        ).toBeVisible(),
      { timeout: 2_000 },
    )
    const before =
      screen.getByAltText<HTMLImageElement>('フィルター適用前のプレビュー')
    const after =
      screen.getByAltText<HTMLImageElement>('フィルター適用後のプレビュー')
    expect(getDocumentImageData).toHaveBeenCalled()
    expect(before.src).toMatch(/^data:image\/png;base64,/u)
    expect(after.src).toMatch(/^data:image\/png;base64,/u)
    expect(after.src).not.toBe(before.src)
  })
})
