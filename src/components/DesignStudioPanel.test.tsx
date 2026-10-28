import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTableModel, updateTableCell } from '../tables'
import {
  BUILTIN_ASSET_DRAG_MIME_TYPE,
  readBuiltinAssetDragPayload,
} from '../assets'
import DesignStudioPanel, {
  type DesignStudioPanelProps,
} from './DesignStudioPanel'
import type { ExportPresetSettings } from '../export/presets'

vi.mock('./ExportPresetControls', () => ({
  default: ({
    settings,
    onApply,
    disabled,
  }: {
    settings: ExportPresetSettings
    onApply: (value: ExportPresetSettings) => void
    disabled?: boolean
  }) => (
    <fieldset disabled={disabled} data-testid="pdf-preset-controls">
      <output data-testid="pdf-preset-settings">
        {JSON.stringify(settings)}
      </output>
      <button
        type="button"
        onClick={() =>
          onApply({
            kind: 'pdf',
            dpi: 150,
            bleedMm: 3,
            cropMarks: true,
            pdfCompression: 'jpeg',
            jpegQuality: 0.8,
          })
        }
      >
        Apply PDF fixture
      </button>
      <button
        type="button"
        onClick={() =>
          onApply({
            kind: 'pdf',
            dpi: 300,
            bleedMm: 0,
            cropMarks: true,
            pdfCompression: 'lossless',
            jpegQuality: 0.94,
          })
        }
      >
        Apply no-bleed fixture
      </button>
    </fieldset>
  ),
}))

const originalDocumentFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
const originalQueryLocalFonts = Object.getOwnPropertyDescriptor(
  window,
  'queryLocalFonts',
)

const props = (
  overrides: Partial<DesignStudioPanelProps> = {},
): DesignStudioPanelProps => ({
  locale: 'en',
  busy: false,
  pages: [
    {
      id: 'page-1',
      name: 'Page 1',
      width: 1080,
      height: 1080,
      durationMs: 3000,
    },
  ],
  activePageId: 'page-1',
  selectedLayerIds: [],
  gridBoundaries: [],
  onAddPage: vi.fn(),
  onDuplicatePage: vi.fn(),
  onDeletePage: vi.fn(),
  onSelectPage: vi.fn(),
  onReorderPage: vi.fn(),
  onMagicResize: vi.fn(),
  onBackground: vi.fn(),
  onInsertAsset: vi.fn(),
  onMoveGridBoundary: vi.fn(),
  onImportUserAsset: vi.fn(),
  userAssets: [],
  onUseUserAsset: vi.fn(),
  onRemoveUserAsset: vi.fn(),
  onGroup: vi.fn(),
  onUngroup: vi.fn(),
  onClip: vi.fn(),
  onReleaseClip: vi.fn(),
  onApplyMask: vi.fn(),
  onSetMaskEnabled: vi.fn(),
  onRemoveMask: vi.fn(),
  onRasterizeMask: vi.fn(),
  onInsertText: vi.fn(),
  onSetFont: vi.fn(),
  userFonts: [],
  onImportUserFont: vi.fn(),
  onRemoveUserFont: vi.fn(),
  onTextEffect: vi.fn(),
  onApplyTemplate: vi.fn(),
  onImportTemplate: vi.fn(),
  onExportTemplate: vi.fn(),
  onSaveBrand: vi.fn(),
  savedBrands: [],
  activeBrandId: undefined,
  onSelectBrand: vi.fn(),
  onRemoveBrand: vi.fn(),
  onInsertChart: vi.fn(),
  onInsertTable: vi.fn(),
  selectedData: undefined,
  onUpdateData: vi.fn(),
  onTimeline: vi.fn(),
  onPreviewMotion: vi.fn(),
  onExport: vi.fn(),
  onCancelExport: vi.fn(),
  ...overrides,
})

afterEach(() => {
  cleanup()
  if (originalDocumentFonts) {
    Object.defineProperty(document, 'fonts', originalDocumentFonts)
  } else {
    Reflect.deleteProperty(document, 'fonts')
  }
  if (originalQueryLocalFonts) {
    Object.defineProperty(window, 'queryLocalFonts', originalQueryLocalFonts)
  } else {
    Reflect.deleteProperty(window, 'queryLocalFonts')
  }
})

describe('DesignStudioPanel', () => {
  it('commits one grid boundary change when a range drag ends', async () => {
    const onMoveGridBoundary = vi.fn()
    render(
      <DesignStudioPanel
        {...props({
          gridBoundaries: [
            {
              id: 'x:left:right',
              groupId: 'grid',
              axis: 'x',
              position: 0.5,
              minimum: 0.1,
              maximum: 0.9,
              beforeCellIds: ['left'],
              afterCellIds: ['right'],
              gap: 0.02,
            },
          ],
          onMoveGridBoundary,
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Elements' }))
    const slider = screen.getByRole('slider', { name: 'Grid boundary 1' })

    fireEvent.change(slider, { target: { value: '0.7' } })
    expect(onMoveGridBoundary).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider)

    expect(onMoveGridBoundary).toHaveBeenCalledOnce()
    expect(onMoveGridBoundary).toHaveBeenCalledWith('x:left:right', 0.7)
  })

  it('starts a bounded built-in asset drag without changing click insertion', async () => {
    const user = userEvent.setup()
    const onInsertAsset = vi.fn()
    render(<DesignStudioPanel {...props({ onInsertAsset })} />)
    await user.click(screen.getByRole('button', { name: 'Elements' }))
    const star = screen.getByRole('button', { name: /Star/u })
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      getData: (type: string) => values.get(type) ?? '',
      setData: (type: string, value: string) => values.set(type, value),
    }

    fireEvent.dragStart(star, { dataTransfer })

    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(values.get(BUILTIN_ASSET_DRAG_MIME_TYPE)?.length).toBeLessThan(193)
    expect(readBuiltinAssetDragPayload(dataTransfer)).toMatchObject({
      assetId: 'shape-star',
    })
    expect(onInsertAsset).not.toHaveBeenCalled()

    await user.click(star)
    await waitFor(() => expect(onInsertAsset).toHaveBeenCalledOnce())
  })

  it('operates page controls and design presets', async () => {
    const user = userEvent.setup()
    const onAddPage = vi.fn()
    const onDuplicatePage = vi.fn()
    render(<DesignStudioPanel {...props({ onAddPage, onDuplicatePage })} />)

    await user.click(screen.getByRole('button', { name: 'Add page' }))
    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    await user.click(screen.getByRole('button', { name: /Instagram square/u }))
    expect(onAddPage).toHaveBeenNthCalledWith(1)
    expect(onDuplicatePage).toHaveBeenCalledOnce()
    expect(onAddPage).toHaveBeenNthCalledWith(2, {
      width: 1080,
      height: 1080,
    })

    await user.click(screen.getByRole('button', { name: /A4 portrait/u }))
    expect(onAddPage).toHaveBeenNthCalledWith(3, {
      width: 2480,
      height: 3508,
      physicalSize: {
        unit: 'mm',
        widthMm: 210,
        heightMm: 297,
        sourceDpi: 300,
      },
    })
  })

  it('exposes exactly the current page and updates it after navigation', async () => {
    const user = userEvent.setup()
    const onSelectPage = vi.fn()
    const pages = [
      ...props().pages,
      {
        id: 'page-2',
        name: 'Page 2',
        width: 1080,
        height: 1080,
        durationMs: 3000,
      },
    ]
    const { rerender } = render(
      <DesignStudioPanel {...props({ pages, onSelectPage })} />,
    )
    const first = screen.getByRole('button', { name: /Page 1/u })
    const second = screen.getByRole('button', { name: /Page 2/u })
    expect(first).toHaveAttribute('aria-current', 'page')
    expect(second).not.toHaveAttribute('aria-current')
    await user.click(second)
    expect(onSelectPage).toHaveBeenCalledWith('page-2')
    rerender(
      <DesignStudioPanel
        {...props({ pages, activePageId: 'page-2', onSelectPage })}
      />,
    )
    expect(first).not.toHaveAttribute('aria-current')
    expect(second).toHaveAttribute('aria-current', 'page')
  })

  it('searches all lazy built-in template metadata and applies a result', async () => {
    const user = userEvent.setup()
    const onApplyTemplate = vi.fn()
    render(<DesignStudioPanel {...props({ onApplyTemplate })} />)

    await user.click(screen.getByRole('button', { name: 'Templates' }))
    const search = screen.getByRole('searchbox')
    await user.type(search, 'pitch')
    const result = screen.getByRole('button', { name: /Pitch Deck/u })
    await user.click(result)
    expect(onApplyTemplate).toHaveBeenCalledWith('presentation-pitch')
  })

  it('shows cancellable export progress', async () => {
    const user = userEvent.setup()
    const onCancelExport = vi.fn()
    render(
      <DesignStudioPanel
        {...props({
          exportProgress: { value: 0.4, label: '2 / 5' },
          onCancelExport,
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByRole('progressbar')).toHaveValue(0.4)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancelExport).toHaveBeenCalledOnce()
  })

  it('explains raster PDF output and passes lossless or JPEG quality explicitly', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(<DesignStudioPanel {...props({ onExport })} />)
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByText(/Every page is exported as an image/)).toBeVisible()
    expect(screen.getByText(/electronic signature validity/)).toBeVisible()
    const exportButton = screen
      .getAllByRole('button', { name: 'Export' })
      .at(-1)!
    await user.click(exportButton)
    expect(onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ pdfCompression: 'lossless', dpi: 300 }),
    )
    await user.selectOptions(screen.getByLabelText('Image compression'), 'jpeg')
    fireEvent.change(screen.getByLabelText('JPEG quality (10–100)'), {
      target: { value: '80' },
    })
    await user.click(exportButton)
    expect(onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ pdfCompression: 'jpeg', jpegQuality: 0.8 }),
    )
    fireEvent.change(screen.getByLabelText('JPEG quality (10–100)'), {
      target: { value: '0' },
    })
    expect(exportButton).toBeDisabled()
  })

  it('applies PDF settings together, refreshes preflight, and retains the selected page range', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(
      <DesignStudioPanel
        {...props({
          initialTab: 'export',
          onExport,
          pages: [
            {
              id: 'page-1',
              name: 'First',
              width: 1080,
              height: 1080,
              durationMs: 3000,
            },
            {
              id: 'page-2',
              name: 'Second',
              width: 1080,
              height: 1080,
              durationMs: 3000,
            },
          ],
        })}
      />,
    )
    expect(
      JSON.parse(screen.getByTestId('pdf-preset-settings').textContent!),
    ).toEqual({
      kind: 'pdf',
      dpi: 300,
      bleedMm: 0,
      cropMarks: false,
      pdfCompression: 'lossless',
      jpegQuality: 0.94,
    })
    await user.selectOptions(screen.getByLabelText('Page range'), 'selected')
    await user.click(
      within(
        screen.getByRole('group', { name: 'Pages to export' }),
      ).getByLabelText('1. First'),
    )
    await user.click(screen.getByRole('button', { name: 'Apply PDF fixture' }))
    expect(onExport).not.toHaveBeenCalled()
    expect(screen.getByLabelText('DPI')).toHaveValue(150)
    expect(screen.getByLabelText('Bleed mm')).toHaveValue(3)
    expect(screen.getByLabelText('Add crop marks')).toBeChecked()
    expect(screen.getByLabelText('Image compression')).toHaveValue('jpeg')
    expect(screen.getByLabelText('JPEG quality (10–100)')).toHaveValue(80)
    expect(screen.getByLabelText('Page range')).toHaveValue('selected')
    expect(screen.getByLabelText('PDF export checks')).toHaveTextContent(
      'Second: 182.88 × 182.88 mm · 150 DPI',
    )
    await user.click(screen.getAllByRole('button', { name: 'Export' }).at(-1)!)
    expect(onExport).toHaveBeenCalledWith({
      format: 'pdf',
      scope: 'selected',
      selectedPageIds: ['page-2'],
      dpi: 150,
      bleedMm: 3,
      cropMarks: true,
      pdfCompression: 'jpeg',
      jpegQuality: 0.8,
    })
  })

  it('clears crop marks when bleed is removed or a no-bleed preset is applied', async () => {
    const user = userEvent.setup()
    render(<DesignStudioPanel {...props({ initialTab: 'export' })} />)
    await user.click(screen.getByRole('button', { name: 'Apply PDF fixture' }))
    fireEvent.change(screen.getByLabelText('Bleed mm'), {
      target: { value: '0' },
    })
    const marks = screen.getByLabelText('Add crop marks')
    expect(marks).not.toBeChecked()
    expect(marks).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Bleed mm'), {
      target: { value: '3' },
    })
    expect(marks).not.toBeChecked()
    await user.click(marks)
    expect(marks).toBeChecked()
    await user.click(
      screen.getByRole('button', { name: 'Apply no-bleed fixture' }),
    )
    expect(marks).not.toBeChecked()
    expect(
      JSON.parse(screen.getByTestId('pdf-preset-settings').textContent!)
        .cropMarks,
    ).toBe(false)
  })

  it('passes invalid current values to preset validation without silently clamping them', () => {
    render(<DesignStudioPanel {...props({ initialTab: 'export' })} />)
    fireEvent.change(screen.getByLabelText('DPI'), { target: { value: '601' } })
    fireEvent.change(screen.getByLabelText('Bleed mm'), {
      target: { value: '-1' },
    })
    fireEvent.change(screen.getByLabelText('Image compression'), {
      target: { value: 'jpeg' },
    })
    fireEvent.change(screen.getByLabelText('JPEG quality (10–100)'), {
      target: { value: '0' },
    })
    expect(
      JSON.parse(screen.getByTestId('pdf-preset-settings').textContent!),
    ).toMatchObject({ dpi: 601, bleedMm: -1, jpegQuality: 0 })
    expect(
      screen.getAllByRole('button', { name: 'Export' }).at(-1),
    ).toBeDisabled()
  })

  it('shows preset controls only for PDF and disables them during work', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <DesignStudioPanel {...props({ initialTab: 'export' })} />,
    )
    await user.click(screen.getByRole('button', { name: 'Apply PDF fixture' }))
    await user.click(screen.getByRole('button', { name: 'PNG (ZIP)' }))
    expect(screen.queryByTestId('pdf-preset-controls')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'PDF (raster images)' }),
    )
    expect(screen.getByLabelText('DPI')).toHaveValue(150)
    rerender(
      <DesignStudioPanel {...props({ initialTab: 'export', busy: true })} />,
    )
    expect(
      screen.getByRole('button', { name: 'Apply PDF fixture' }),
    ).toBeDisabled()
    rerender(
      <DesignStudioPanel
        {...props({
          initialTab: 'export',
          exportProgress: { value: 0.2, label: '1 / 5' },
        })}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Apply PDF fixture' }),
    ).toBeDisabled()
  })

  it('shows physical page dimensions and resolution warnings before export', async () => {
    const user = userEvent.setup()
    render(
      <DesignStudioPanel
        {...props({
          pages: [
            {
              id: 'page-1',
              name: 'Imported page',
              width: 1240,
              height: 1754,
              durationMs: 3000,
              physicalSize: {
                unit: 'mm',
                widthMm: 210,
                heightMm: 297,
                sourceDpi: 150,
              },
              pdfImportDpi: 150,
            },
          ],
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByText(/210.00 × 297.00 mm/)).toBeVisible()
    expect(
      screen.getByText(/Upscaling cannot recover lost detail/),
    ).toBeVisible()
    fireEvent.change(screen.getByLabelText('DPI'), { target: { value: '601' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/64 MP/)
    expect(
      screen.getAllByRole('button', { name: 'Export' }).at(-1),
    ).toBeDisabled()
  })

  it('keeps animations on unselected layers when applying motion', async () => {
    const user = userEvent.setup()
    const onTimeline = vi.fn()
    render(
      <DesignStudioPanel
        {...props({
          pages: [
            {
              id: 'page-1',
              name: 'Page 1',
              width: 1080,
              height: 1080,
              durationMs: 3_000,
              timeline: {
                durationMs: 3_000,
                transition: {
                  type: 'fade',
                  durationMs: 500,
                  easing: 'ease-in-out',
                },
                elements: {
                  'layer-a': [
                    {
                      id: 'existing-animation',
                      phase: 'enter',
                      effect: 'zoom',
                      start: { mode: 'with-page' },
                      durationMs: 400,
                    },
                  ],
                },
              },
            },
          ],
          selectedLayerIds: ['layer-b'],
          onTimeline,
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Animate' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onTimeline).toHaveBeenCalledOnce()
    const timeline = onTimeline.mock.calls[0][0]
    expect(timeline.elements['layer-a']).toEqual([
      expect.objectContaining({ id: 'existing-animation', effect: 'zoom' }),
    ])
    expect(timeline.elements['layer-b']).toEqual([
      expect.objectContaining({ effect: 'fade' }),
    ])
  })

  it('keeps page duration beyond every retained clip, not only the last clip', async () => {
    const user = userEvent.setup()
    const onTimeline = vi.fn()
    render(
      <DesignStudioPanel
        {...props({
          pages: [
            {
              id: 'page-1',
              name: 'Page 1',
              width: 1080,
              height: 1080,
              durationMs: 1_000,
              timeline: {
                durationMs: 1_000,
                elements: {
                  'layer-a': [
                    {
                      id: 'late-clip',
                      phase: 'enter',
                      effect: 'fade',
                      start: { mode: 'with-page', delayMs: 900 },
                      durationMs: 100,
                    },
                    {
                      id: 'early-clip',
                      phase: 'emphasis',
                      effect: 'pulse',
                      start: { mode: 'with-page' },
                      durationMs: 100,
                    },
                  ],
                },
              },
            },
          ],
          selectedLayerIds: ['layer-b'],
          onTimeline,
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Animate' }))
    const duration = screen.getByRole('spinbutton', { name: 'Page duration' })
    await user.clear(duration)
    await user.type(duration, '250')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onTimeline.mock.calls[0][0]).toMatchObject({
      durationMs: 1_000,
      elements: {
        'layer-a': [
          expect.objectContaining({ id: 'late-clip' }),
          expect.objectContaining({ id: 'early-clip' }),
        ],
      },
    })
  })

  it('keeps unsaved CSV edits while moving table cell focus', async () => {
    const user = userEvent.setup()
    let model = createTableModel(2, 2)
    model = updateTableCell(model, 0, 0, { text: 'Original' })
    render(
      <DesignStudioPanel
        {...props({
          selectedData: { kind: 'table', layerId: 'table-1', model },
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Data' }))
    const source = screen.getByRole('textbox', { name: 'CSV data' })
    await user.clear(source)
    await user.type(source, 'Name,Value{enter}Edited,1')
    await user.click(screen.getByRole('textbox', { name: 'CSV data 2:2' }))

    expect(source).toHaveValue('Name,Value\nEdited,1')
  })

  it('reports invalid table dimensions without throwing from the click', async () => {
    const user = userEvent.setup()
    render(
      <DesignStudioPanel
        {...props({
          selectedData: {
            kind: 'table',
            layerId: 'table-1',
            model: createTableModel(2, 2),
          },
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Data' }))
    const rowHeight = screen.getByRole('spinbutton', {
      name: 'Selected row height',
    })
    await user.clear(rowHeight)
    await user.click(
      screen.getByRole('button', { name: 'Update selected table' }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check the CSV, row height, and column width values.',
    )
  })

  it('loads a brand font before insert/apply and uses its fallback on failure', async () => {
    const user = userEvent.setup()
    const fontLoader = vi.fn().mockRejectedValue(new Error('font unavailable'))
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: fontLoader },
    })
    const onInsertText = vi.fn()
    const onSetFont = vi.fn()
    render(
      <DesignStudioPanel
        {...props({
          onInsertText,
          onSetFont,
          activeBrandId: 'brand-1',
          savedBrands: [
            {
              id: 'brand-1',
              name: 'Editorial',
              colors: {
                primary: '#111111',
                secondary: '#222222',
                accent: '#333333',
              },
              fonts: {
                heading: {
                  family: 'Bitter',
                  fallback: 'Georgia, serif',
                  sourceId: 'bitter',
                },
                body: {
                  family: 'Inter',
                  fallback: 'system-ui, sans-serif',
                  sourceId: 'inter',
                },
              },
            },
          ],
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Text' }))
    await user.selectOptions(
      screen.getByLabelText('Font'),
      'brand:brand-1:heading',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(onInsertText).toHaveBeenCalledWith(
        expect.objectContaining({ fontFamily: 'Georgia, serif' }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Apply Font' }))
    await waitFor(() =>
      expect(onSetFont).toHaveBeenCalledWith('Georgia, serif'),
    )
    expect(fontLoader).toHaveBeenCalledTimes(2)
  })

  it('keeps an in-progress brand edit across equivalent parent rerenders', async () => {
    const user = userEvent.setup()
    const savedBrand = {
      id: 'brand-1',
      name: 'Saved brand',
      colors: {
        primary: '#111111',
        secondary: '#222222',
        accent: '#333333',
      },
      fonts: {
        heading: {
          family: 'Bitter',
          fallback: 'serif',
          sourceId: 'bitter',
        },
        body: {
          family: 'Inter',
          fallback: 'sans-serif',
          sourceId: 'inter',
        },
      },
    }
    const { rerender } = render(
      <DesignStudioPanel
        {...props({
          activeBrandId: savedBrand.id,
          savedBrands: [{ ...savedBrand }],
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Templates' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Unsaved edit')

    rerender(
      <DesignStudioPanel
        {...props({
          activeBrandId: savedBrand.id,
          savedBrands: [{ ...savedBrand }],
        })}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Unsaved edit',
    )
  })

  it('preserves an OpenType extension when importing a discovered local font', async () => {
    const user = userEvent.setup()
    const onImportUserFont = vi.fn().mockResolvedValue(undefined)
    const blob = new Blob([new TextEncoder().encode('OTTOfont-data')], {
      type: 'application/font-sfnt',
    })
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: vi.fn().mockResolvedValue([
        {
          family: 'Example Serif',
          fullName: 'Example Serif Regular',
          postscriptName: 'ExampleSerif-Regular',
          blob: vi.fn().mockResolvedValue(blob),
        },
      ]),
    })
    render(
      <DesignStudioPanel
        {...props({
          onImportUserFont,
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Text' }))
    await user.click(
      screen.getByRole('checkbox', {
        name: /Only add local fonts you are licensed to use/u,
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Find installed fonts' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Add selected font' }),
    )

    await waitFor(() => expect(onImportUserFont).toHaveBeenCalledOnce())
    const imported = onImportUserFont.mock.calls[0][0] as File
    expect(imported.name).toBe('ExampleSerif-Regular.otf')
    expect(imported.type).toBe('application/font-sfnt')
  })
})
