import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

const originalDocumentFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
const originalQueryLocalFonts = Object.getOwnPropertyDescriptor(
  window,
  'queryLocalFonts',
)

const props = (
  overrides: Partial<DesignStudioPanelProps> = {},
): DesignStudioPanelProps => ({
  locale: 'en',
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
