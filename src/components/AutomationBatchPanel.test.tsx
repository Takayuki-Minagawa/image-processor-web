import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMacro, parameter } from '../automation'
import { DEFAULT_ICON_PRESETS, type IconExportPreset } from '../batch'
import AutomationBatchPanel, {
  type AutomationBatchPanelProps,
  type BatchTransformRequest,
} from './AutomationBatchPanel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const parameterizedMacro = createMacro({
  appVersion: '0.1.0',
  id: 'resize-watermark',
  name: 'Resize and watermark',
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  parameters: [
    {
      name: 'targetWidth',
      label: '対象の幅',
      type: 'number',
      required: true,
      minimum: 1,
      maximum: 4096,
      default: 800,
    },
    {
      name: 'watermark',
      label: '透かし文字',
      type: 'string',
      default: 'Pixelweave',
    },
  ],
  commands: [
    {
      type: 'resizeImage',
      width: parameter('targetWidth'),
      height: 600,
      fit: 'contain',
    },
    {
      type: 'addWatermark',
      text: parameter('watermark'),
      position: 'bottomRight',
    },
  ],
})

const savedMacros = [{ macro: parameterizedMacro, diagnostics: [] }]

const callbackProps = () => ({
  onStartMacroRecording: vi.fn(),
  onStopMacroRecording: vi.fn(),
  onReplayMacro: vi.fn(),
  onImportMacro: vi.fn(),
  onExportMacro: vi.fn(),
  onStartBatch: vi.fn(),
  onCancelBatch: vi.fn(),
  onChangeUserIconPresets: vi.fn(),
  onExportIcons: vi.fn(),
})

const renderPanel = (overrides: Partial<AutomationBatchPanelProps> = {}) => {
  const callbacks = callbackProps()
  const props: AutomationBatchPanelProps = {
    ...callbacks,
    savedMacros,
    ...overrides,
  }
  const rendered = render(<AutomationBatchPanel {...props} />)
  return {
    ...rendered,
    callbacks,
    rerenderPanel(next: Partial<AutomationBatchPanelProps>) {
      rendered.rerender(<AutomationBatchPanel {...props} {...next} />)
    },
  }
}

describe('AutomationBatchPanel', () => {
  it('renders its namespaced English catalog when locale is en', () => {
    renderPanel({ locale: 'en' })

    expect(
      screen.getByRole('heading', { name: 'Automation and batch export' }),
    ).toBeVisible()
    expect(
      screen.getByRole('tablist', { name: 'Automation tool categories' }),
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Macros' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Automation and batch export are ready.',
    )
  })

  it('records, selects, parameterizes, and replays saved macros', async () => {
    const { callbacks, rerenderPanel } = renderPanel()
    const user = userEvent.setup()

    const tabs = screen.getByRole('tablist', {
      name: '自動化ツールのカテゴリ',
    })
    expect(within(tabs).getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'マクロ' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    const name = screen.getByLabelText('マクロ名')
    await user.clear(name)
    await user.type(name, 'Web export')
    await user.click(screen.getByRole('button', { name: '記録を開始' }))
    await waitFor(() =>
      expect(callbacks.onStartMacroRecording).toHaveBeenCalledWith(
        'Web export',
      ),
    )

    rerenderPanel({ isRecording: true, recordedCommandCount: 3 })
    expect(screen.getByText('記録中: 3件のコマンド')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '記録を停止して保存' }))
    await waitFor(() =>
      expect(callbacks.onStopMacroRecording).toHaveBeenCalledOnce(),
    )

    const width = screen.getByLabelText('対象の幅（必須）')
    await user.clear(width)
    await user.type(width, '1440')
    const watermark = screen.getByLabelText('透かし文字')
    await user.clear(watermark)
    await user.type(watermark, 'North Star')
    await user.click(
      screen.getByRole('button', { name: '現在のドキュメントへ再生' }),
    )

    await waitFor(() =>
      expect(callbacks.onReplayMacro).toHaveBeenCalledWith({
        macro: parameterizedMacro,
        parameters: {
          targetWidth: 1440,
          watermark: 'North Star',
        },
      }),
    )
  })

  it('parses imported macro JSON and prepares a validated export request', async () => {
    const { callbacks } = renderPanel()
    const user = userEvent.setup()
    const source = JSON.stringify(parameterizedMacro)
    const file = new File([source], 'shared.pwxmacro.json', {
      type: 'application/json',
    })
    Object.defineProperty(file, 'text', {
      value: vi.fn().mockResolvedValue(source),
    })

    await user.upload(screen.getByLabelText('マクロJSONを読み込み'), file)
    await waitFor(() =>
      expect(callbacks.onImportMacro).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'shared.pwxmacro.json',
          source,
          parsed: expect.objectContaining({
            macro: parameterizedMacro,
            diagnostics: [],
          }),
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'JSONを書き出し' }))
    await waitFor(() => expect(callbacks.onExportMacro).toHaveBeenCalledOnce())
    const request = callbacks.onExportMacro.mock.calls[0][0]
    expect(request.fileName).toBe('resize-and-watermark.pwxmacro.json')
    expect(JSON.parse(request.source)).toEqual(parameterizedMacro)
  })

  it('builds batch-safe resize and watermark commands and exposes progress, cancellation, and failures', async () => {
    const { callbacks, rerenderPanel } = renderPanel({
      initialTab: 'batch',
    })
    const user = userEvent.setup()
    const files = [
      new File(['png'], 'first.png', { type: 'image/png' }),
      new File(['jpg'], 'second.jpg', { type: 'image/jpeg' }),
    ]

    await user.upload(screen.getByLabelText(/画像ファイル/u), files)
    await user.clear(screen.getByLabelText('幅（px）'))
    await user.type(screen.getByLabelText('幅（px）'), '640')
    await user.clear(screen.getByLabelText('高さ（px）'))
    await user.type(screen.getByLabelText('高さ（px）'), '360')
    await user.selectOptions(screen.getByLabelText('フィット方法'), 'cover')
    await user.selectOptions(screen.getByLabelText('出力形式'), 'image/jpeg')
    await user.clear(screen.getByLabelText('品質（%）'))
    await user.type(screen.getByLabelText('品質（%）'), '82')
    await user.type(screen.getByLabelText('透かし文字'), 'Confidential')
    await user.selectOptions(screen.getByLabelText('透かし位置'), 'topRight')
    await user.clear(screen.getByLabelText('透かし不透明度（%）'))
    await user.type(screen.getByLabelText('透かし不透明度（%）'), '45')
    await user.selectOptions(screen.getByLabelText('保存方法'), 'zip')
    await user.click(screen.getByRole('button', { name: 'バッチ変換を開始' }))

    await waitFor(() => expect(callbacks.onStartBatch).toHaveBeenCalledOnce())
    const request = callbacks.onStartBatch.mock
      .calls[0][0] as BatchTransformRequest
    expect(request.items).toHaveLength(2)
    expect(request.items.map(({ source }) => source.type)).toEqual([
      'image/png',
      'image/jpeg',
    ])
    expect(request.commands).toEqual([
      {
        type: 'resizeImage',
        width: 640,
        height: 360,
        fit: 'cover',
        background: 'transparent',
      },
      {
        type: 'addWatermark',
        text: 'Confidential',
        position: 'topRight',
        color: '#ffffff',
        opacity: 0.45,
      },
    ])
    expect(request.output).toEqual({
      mimeType: 'image/jpeg',
      quality: 0.82,
    })
    expect(request.outputMode).toBe('zip')

    rerenderPanel({
      batchRunning: true,
      batchProgress: {
        completed: 1,
        failed: 1,
        total: 4,
        active: 2,
      },
      batchFailures: [
        {
          id: 'failed-second',
          sourceName: 'broken.webp',
          error: new Error('decode failed'),
        },
      ],
    })

    expect(
      screen.getByRole('progressbar', { name: 'バッチ変換の進捗' }),
    ).toHaveAttribute('value', '2')
    expect(screen.getByText(/完了 1件.*失敗 1件.*全4件/u)).toBeVisible()
    expect(screen.getByText('broken.webp: decode failed')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'バッチ変換をキャンセル' }),
    )
    await waitFor(() => expect(callbacks.onCancelBatch).toHaveBeenCalledOnce())
  })

  it('accepts a folder input and ignores unsupported files', async () => {
    const { callbacks } = renderPanel({ initialTab: 'batch' })
    const user = userEvent.setup({ applyAccept: false })
    const png = new File([new Uint8Array([1])], 'nested/a.png', {
      type: 'image/png',
    })
    const text = new File(['notes'], 'nested/notes.txt', {
      type: 'text/plain',
    })

    await user.upload(
      screen.getByLabelText('入力フォルダー（対応ブラウザー）'),
      [png, text],
    )

    expect(screen.getByText('1件を選択中')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      '1件の画像を選択し、対象外の1件を除外しました。',
    )
    await user.click(screen.getByRole('button', { name: 'バッチ変換を開始' }))
    await waitFor(() => expect(callbacks.onStartBatch).toHaveBeenCalledOnce())
    const request = callbacks.onStartBatch.mock
      .calls[0][0] as BatchTransformRequest
    expect(request.items).toHaveLength(1)
    expect(request.items[0].source.name).toBe('nested/a.png')
  })

  it('reads nested folders through the File System Access API', async () => {
    const png = new File([new Uint8Array([1])], 'logo.png', {
      type: 'image/png',
    })
    const nested = {
      kind: 'directory' as const,
      name: 'nested',
      async *values() {
        yield {
          kind: 'file' as const,
          name: 'logo.png',
          getFile: async () => png,
        }
      },
    }
    const root = {
      kind: 'directory' as const,
      name: 'root',
      async *values() {
        yield nested
      },
    }
    const showDirectoryPicker = vi.fn(async () => root)
    vi.stubGlobal('showDirectoryPicker', showDirectoryPicker)
    const { callbacks } = renderPanel({ initialTab: 'batch' })
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', {
        name: 'File System Access APIでフォルダーを選択',
      }),
    )
    await waitFor(() => expect(showDirectoryPicker).toHaveBeenCalledOnce())
    expect(screen.getByText('1件を選択中')).toBeVisible()
    expect(screen.getByText('nested/logo.png')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'バッチ変換を開始' }))
    await waitFor(() => expect(callbacks.onStartBatch).toHaveBeenCalledOnce())
    const request = callbacks.onStartBatch.mock
      .calls[0][0] as BatchTransformRequest
    expect(request.items[0].source.name).toBe('nested/logo.png')
  })

  it('resolves a saved macro as the batch recipe', async () => {
    const { callbacks } = renderPanel({ initialTab: 'batch' })
    const user = userEvent.setup()
    const file = new File(['png'], 'macro-input.png', {
      type: 'image/png',
    })

    await user.upload(screen.getByLabelText(/画像ファイル/u), file)
    await user.selectOptions(screen.getByLabelText('適用する処理'), 'macro')
    await user.clear(screen.getByLabelText('対象の幅（必須）'))
    await user.type(screen.getByLabelText('対象の幅（必須）'), '960')
    await user.clear(screen.getByLabelText('透かし文字'))
    await user.type(screen.getByLabelText('透かし文字'), 'Batch mark')
    await user.click(screen.getByRole('button', { name: 'バッチ変換を開始' }))

    await waitFor(() => expect(callbacks.onStartBatch).toHaveBeenCalledOnce())
    const request = callbacks.onStartBatch.mock
      .calls[0][0] as BatchTransformRequest
    expect(request.commands).toEqual([
      {
        type: 'resizeImage',
        width: 960,
        height: 600,
        fit: 'contain',
      },
      {
        type: 'addWatermark',
        text: 'Batch mark',
        position: 'bottomRight',
      },
    ])
  })

  it('exports built-in icon presets and delegates valid custom preset persistence', async () => {
    const customPreset: IconExportPreset = {
      id: 'user-social-card',
      label: 'Social card',
      width: 800,
      height: 418,
      fileName: 'social-card.png',
      fit: 'cover',
      background: '#ffffff',
    }
    const { callbacks, rerenderPanel } = renderPanel({
      initialTab: 'icons',
      documentLabel: 'North Star logo',
    })
    const user = userEvent.setup()

    expect(screen.getByText('North Star logo')).toBeVisible()
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(
      DEFAULT_ICON_PRESETS.length,
    )

    await user.type(screen.getByLabelText('プリセット名'), 'Social card')
    await user.clear(screen.getByLabelText('幅（px）'))
    await user.type(screen.getByLabelText('幅（px）'), '800')
    await user.clear(screen.getByLabelText('高さ（px）'))
    await user.type(screen.getByLabelText('高さ（px）'), '418')
    await user.clear(screen.getByLabelText('ファイル名'))
    await user.type(screen.getByLabelText('ファイル名'), 'social-card.png')
    await user.selectOptions(screen.getByLabelText('フィット方法'), 'cover')
    await user.clear(screen.getByLabelText('背景色'))
    await user.type(screen.getByLabelText('背景色'), '#ffffff')
    await user.click(screen.getByRole('button', { name: 'プリセットを追加' }))

    await waitFor(() =>
      expect(callbacks.onChangeUserIconPresets).toHaveBeenCalledWith([
        customPreset,
      ]),
    )

    rerenderPanel({ userIconPresets: [customPreset] })
    expect(
      screen.getByRole('checkbox', {
        name: 'Social card（800 × 418）',
      }),
    ).toBeChecked()
    await user.selectOptions(screen.getByLabelText('保存方法'), 'directory')
    await user.click(
      screen.getByRole('button', {
        name: '選択したプリセットを書き出し',
      }),
    )

    await waitFor(() => expect(callbacks.onExportIcons).toHaveBeenCalledOnce())
    expect(callbacks.onExportIcons).toHaveBeenCalledWith({
      presets: [...DEFAULT_ICON_PRESETS, customPreset],
      outputMode: 'directory',
    })
  })

  it('supports arrow-key tab navigation and reports invalid batch input', async () => {
    renderPanel()
    const user = userEvent.setup()
    const macroTab = screen.getByRole('tab', { name: 'マクロ' })
    macroTab.focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'バッチ変換' })).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: 'バッチ変換' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'バッチ変換を開始' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '変換する画像を1件以上選択してください。',
    )
  })
})
