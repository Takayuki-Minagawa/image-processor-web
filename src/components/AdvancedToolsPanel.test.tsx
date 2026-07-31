import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdvancedToolsPanel, {
  type AdvancedBackgroundModel,
  type AdvancedToolsPanelProps,
} from './AdvancedToolsPanel'
import { SelectionMask } from '../selection/mask'
import {
  LocalScriptRepository,
  type ScriptStorage,
} from '../scripting/scriptRepository'
import { LocalMacroRepository } from '../automation/macroRepository'

class TestImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  readonly colorSpace = 'srgb'

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

beforeAll(() => {
  vi.stubGlobal('ImageData', TestImageData as unknown as typeof ImageData)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
})

const imageData = (width: number, height: number, data?: number[]): ImageData =>
  new ImageData(
    new Uint8ClampedArray(
      data ?? Array.from({ length: width * height * 4 }, () => 255),
    ),
    width,
    height,
  )

class MemoryStorage implements ScriptStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const baseProps = (
  overrides: Partial<AdvancedToolsPanelProps> = {},
): AdvancedToolsPanelProps => ({
  documentWidth: 2,
  documentHeight: 2,
  getDocumentImageData: vi.fn(async () => imageData(2, 2)),
  onSelectionMask: vi.fn(),
  onBackgroundResult: vi.fn(),
  onScriptCommands: vi.fn(),
  ...overrides,
})

describe('AdvancedToolsPanel', () => {
  it('exposes labelled tabs with arrow-key navigation and tab panels', async () => {
    const user = userEvent.setup()
    render(<AdvancedToolsPanel {...baseProps()} />)

    const selectionTab = screen.getByRole('tab', { name: '選択範囲' })
    const backgroundTab = screen.getByRole('tab', { name: '背景除去' })
    const scriptTab = screen.getByRole('tab', { name: 'スクリプト' })
    expect(selectionTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('選択範囲')

    await user.click(backgroundTab)
    expect(backgroundTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('背景除去')

    backgroundTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(scriptTab).toHaveAttribute('aria-selected', 'true')
    expect(scriptTab).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('スクリプト')
  })

  it('creates a magic-wand mask and combines it with the current mask', async () => {
    const user = userEvent.setup()
    const onSelectionMask = vi.fn()
    const onStatus = vi.fn()
    const pixels = imageData(
      2,
      2,
      [
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0,
        255,
      ],
    )
    render(
      <AdvancedToolsPanel
        {...baseProps({
          getDocumentImageData: vi.fn(async () => pixels),
          selectionMask: SelectionMask.fromBytes(
            2,
            2,
            new Uint8Array([255, 0, 0, 0]),
          ),
          onSelectionMask,
          onStatus,
        })}
      />,
    )

    await user.selectOptions(screen.getByLabelText('選択範囲の合成方法'), 'add')
    await user.clear(screen.getByLabelText('X座標'))
    await user.type(screen.getByLabelText('X座標'), '1')
    await user.clear(screen.getByLabelText('Y座標'))
    await user.type(screen.getByLabelText('Y座標'), '1')
    await user.clear(screen.getByLabelText('許容値'))
    await user.type(screen.getByLabelText('許容値'), '0')
    await user.click(screen.getByRole('button', { name: '自動選択を実行' }))

    await waitFor(() => expect(onSelectionMask).toHaveBeenCalledOnce())
    const mask = onSelectionMask.mock.calls[0][0] as SelectionMask
    expect([...mask.toBytes()]).toEqual([255, 0, 0, 255])
    expect(onStatus).toHaveBeenLastCalledWith({
      kind: 'success',
      message: '自動選択を更新しました。',
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      '自動選択を更新しました。',
    )
  })

  it('supports polygon selection and reports malformed point input', async () => {
    const user = userEvent.setup()
    const onSelectionMask = vi.fn()
    render(
      <AdvancedToolsPanel
        {...baseProps({
          onSelectionMask,
        })}
      />,
    )
    const points = screen.getByLabelText('頂点座標（1行にX,Y）')
    fireEvent.change(points, {
      target: { value: '0,0\n2,0\n2,2\n0,2' },
    })
    await user.click(screen.getByRole('button', { name: '多角形選択を実行' }))

    expect(onSelectionMask).toHaveBeenCalledOnce()
    expect([
      ...(onSelectionMask.mock.calls[0][0] as SelectionMask).toBytes(),
    ]).toEqual([255, 255, 255, 255])

    fireEvent.change(points, { target: { value: '0,0\ninvalid' } })
    await user.click(screen.getByRole('button', { name: '多角形選択を実行' }))
    expect(screen.getByRole('alert')).toHaveTextContent('多角形には3点以上')
  })

  it('draws a document-space lasso and honors subtract/intersect composition', async () => {
    const user = userEvent.setup()
    const onSelectionMask = vi.fn()
    const current = SelectionMask.full(4, 4)
    const { container } = render(
      <AdvancedToolsPanel
        {...baseProps({
          documentWidth: 4,
          documentHeight: 4,
          getDocumentImageData: vi.fn(async () => imageData(4, 4)),
          selectionMask: current,
          onSelectionMask,
        })}
      />,
    )

    const canvas = screen.getByRole('img', { name: 'なげなわ描画領域' })
    expect(canvas).toHaveAccessibleDescription(/キーボードでは下の座標入力/)
    expect(container.querySelector('.marching-ants-overlay')).not.toBeNull()
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      toJSON: () => undefined,
    })

    const drawCenterSquare = (
      modifier: { shiftKey?: boolean; altKey?: boolean } = {},
    ): void => {
      fireEvent.pointerDown(canvas, {
        pointerId: 7,
        button: 0,
        clientX: 50,
        clientY: 50,
      })
      fireEvent.pointerMove(canvas, {
        pointerId: 7,
        clientX: 150,
        clientY: 50,
      })
      fireEvent.pointerMove(canvas, {
        pointerId: 7,
        clientX: 150,
        clientY: 150,
      })
      fireEvent.pointerUp(canvas, {
        pointerId: 7,
        clientX: 50,
        clientY: 150,
        ...modifier,
      })
    }

    await user.selectOptions(
      screen.getByLabelText('選択範囲の合成方法'),
      'subtract',
    )
    drawCenterSquare()
    expect(onSelectionMask).toHaveBeenCalledOnce()
    expect([
      ...(onSelectionMask.mock.calls[0][0] as SelectionMask).toBytes(),
    ]).toEqual([
      255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
    ])
    expect(screen.getByLabelText('頂点座標（1行にX,Y）')).toHaveValue(
      '1,1\n3,1\n3,3\n1,3',
    )

    await user.selectOptions(
      screen.getByLabelText('選択範囲の合成方法'),
      'intersect',
    )
    drawCenterSquare()
    expect([
      ...(onSelectionMask.mock.calls[1][0] as SelectionMask).toBytes(),
    ]).toEqual([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0])

    await user.selectOptions(screen.getByLabelText('選択範囲の合成方法'), 'add')
    drawCenterSquare()
    expect([
      ...(onSelectionMask.mock.calls[2][0] as SelectionMask).toBytes(),
    ]).toEqual(Array(16).fill(255))

    await user.selectOptions(
      screen.getByLabelText('選択範囲の合成方法'),
      'replace',
    )
    drawCenterSquare({ altKey: true })
    expect([
      ...(onSelectionMask.mock.calls[3][0] as SelectionMask).toBytes(),
    ]).toEqual([
      255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
    ])
    drawCenterSquare({ shiftKey: true })
    expect([
      ...(onSelectionMask.mock.calls[4][0] as SelectionMask).toBytes(),
    ]).toEqual(Array(16).fill(255))
    expect(screen.getByRole('status')).toHaveTextContent(
      'なげなわ選択を更新しました。',
    )
  })

  it('feathers, grows, shrinks, inverts, and clears a selection', async () => {
    const user = userEvent.setup()
    const onSelectionMask = vi.fn()
    const current = SelectionMask.fromBytes(
      3,
      3,
      new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0]),
    )
    render(
      <AdvancedToolsPanel
        {...baseProps({
          documentWidth: 3,
          documentHeight: 3,
          getDocumentImageData: vi.fn(async () => imageData(3, 3)),
          selectionMask: current,
          onSelectionMask,
        })}
      />,
    )
    await user.clear(screen.getByLabelText('調整半径'))
    await user.type(screen.getByLabelText('調整半径'), '1')

    await user.click(screen.getByRole('button', { name: 'ぼかす' }))
    expect(
      [
        ...(onSelectionMask.mock.calls.at(-1)?.[0] as SelectionMask).toBytes(),
      ].some((value) => value > 0 && value < 255),
    ).toBe(true)

    await user.click(screen.getByRole('button', { name: '拡張' }))
    expect([
      ...(onSelectionMask.mock.calls.at(-1)?.[0] as SelectionMask).toBytes(),
    ]).toEqual(Array(9).fill(255))

    await user.click(screen.getByRole('button', { name: '縮小' }))
    expect([
      ...(onSelectionMask.mock.calls.at(-1)?.[0] as SelectionMask).toBytes(),
    ]).toEqual(Array(9).fill(0))

    await user.click(screen.getByRole('button', { name: '反転' }))
    expect([
      ...(onSelectionMask.mock.calls.at(-1)?.[0] as SelectionMask).toBytes(),
    ]).toEqual([255, 255, 255, 255, 0, 255, 255, 255, 255])

    await user.click(screen.getByRole('button', { name: '解除' }))
    expect(onSelectionMask).toHaveBeenLastCalledWith(undefined)
  })

  it('uses the disclosed deterministic fallback without a model', async () => {
    const user = userEvent.setup()
    const onBackgroundResult = vi.fn()
    const bordered = imageData(
      3,
      3,
      [
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255,
      ],
    )
    render(
      <AdvancedToolsPanel
        {...baseProps({
          documentWidth: 3,
          documentHeight: 3,
          getDocumentImageData: vi.fn(async () => bordered),
          onBackgroundResult,
        })}
      />,
    )
    await user.click(screen.getByRole('tab', { name: '背景除去' }))
    expect(screen.getByText(/AIモデルは設定されていません/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '背景を除去' }))

    await waitFor(() => expect(onBackgroundResult).toHaveBeenCalledOnce())
    const output = onBackgroundResult.mock.calls[0][0] as ImageData
    expect(output.width).toBe(3)
    expect(output.height).toBe(3)
    expect([
      output.data[3],
      output.data[4 * 4 + 3],
      output.data[8 * 4 + 3],
    ]).toEqual([0, 255, 0])
    expect(screen.getByRole('status')).toHaveTextContent(
      'モデルを使わない簡易推定',
    )
  })

  it('never loads a model before consent and supports cancellation', async () => {
    const user = userEvent.setup()
    const load = vi.fn<AdvancedBackgroundModel['load']>(
      async ({ signal }) =>
        await new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    const model: AdvancedBackgroundModel = {
      id: 'subject-lite',
      label: 'Subject Lite',
      sizeBytes: 2 * 1024 * 1024,
      load,
    }
    const onBackgroundResult = vi.fn()
    render(
      <AdvancedToolsPanel
        {...baseProps({ backgroundModel: model, onBackgroundResult })}
      />,
    )
    await user.click(screen.getByRole('tab', { name: '背景除去' }))
    expect(screen.getByText(/Subject Lite（2.0 MB）/)).toBeVisible()

    const run = screen.getByRole('button', { name: '背景を除去' })
    expect(run).toBeDisabled()
    expect(load).not.toHaveBeenCalled()

    await user.click(
      screen.getByLabelText(
        '表示されたモデルを端末内で取得・実行することに同意する',
      ),
    )
    expect(run).toBeEnabled()
    await user.click(run)
    await waitFor(() => expect(load).toHaveBeenCalledOnce())
    await user.click(
      screen.getByRole('button', { name: '背景除去をキャンセル' }),
    )

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '背景除去をキャンセルしました。',
      ),
    )
    expect(onBackgroundResult).not.toHaveBeenCalled()
    expect(
      screen.getByLabelText(
        '表示されたモデルを端末内で取得・実行することに同意する',
      ),
    ).not.toBeChecked()
    expect(screen.getByRole('button', { name: '背景を除去' })).toBeDisabled()
  })

  it('aborts on unmount and suppresses a late non-cooperative model result', async () => {
    const user = userEvent.setup()
    let resolveSegment!: (mask: Uint8Array) => void
    const segment = vi.fn(
      async () =>
        await new Promise<Uint8Array>((resolve) => {
          resolveSegment = resolve
        }),
    )
    let operationSignal: AbortSignal | undefined
    const model: AdvancedBackgroundModel = {
      id: 'subject-lite',
      label: 'Subject Lite',
      sizeBytes: 2 * 1024 * 1024,
      load: vi.fn(async ({ signal }) => {
        operationSignal = signal
        return { id: 'late-model', segment }
      }),
    }
    const onBackgroundResult = vi.fn()
    const onStatus = vi.fn()
    const view = render(
      <AdvancedToolsPanel
        {...baseProps({ backgroundModel: model, onBackgroundResult, onStatus })}
      />,
    )
    await user.click(screen.getByRole('tab', { name: '背景除去' }))
    await user.click(
      screen.getByLabelText(
        '表示されたモデルを端末内で取得・実行することに同意する',
      ),
    )
    await user.click(screen.getByRole('button', { name: '背景を除去' }))
    await waitFor(() => expect(segment).toHaveBeenCalledOnce())

    view.unmount()
    expect(operationSignal?.aborted).toBe(true)
    await act(async () => {
      resolveSegment(new Uint8Array([255, 255, 255, 255]))
      await Promise.resolve()
    })

    expect(onBackgroundResult).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()

    const reopenedModel: AdvancedBackgroundModel = {
      ...model,
      load: vi.fn(async () => ({
        id: 'reopened-model',
        segment: vi.fn(async () => new Uint8Array([255, 255, 255, 255])),
      })),
    }
    render(
      <AdvancedToolsPanel
        {...baseProps({
          backgroundModel: reopenedModel,
          onBackgroundResult,
          onStatus,
        })}
      />,
    )
    await user.click(screen.getByRole('tab', { name: '背景除去' }))
    const reopenedConsent = screen.getByLabelText(
      '表示されたモデルを端末内で取得・実行することに同意する',
    )
    expect(reopenedConsent).not.toBeChecked()
    await user.click(reopenedConsent)
    await user.click(screen.getByRole('button', { name: '背景を除去' }))
    await waitFor(() => expect(onBackgroundResult).toHaveBeenCalledOnce())
  })

  it('keeps execution consent session-only and removes the cached model on request', async () => {
    const user = userEvent.setup()
    const revoke = vi.fn(async () => undefined)
    const model: AdvancedBackgroundModel = {
      id: 'subject-lite',
      label: 'Subject Lite',
      sizeBytes: 2 * 1024 * 1024,
      load: vi.fn(),
      revoke,
    }
    render(<AdvancedToolsPanel {...baseProps({ backgroundModel: model })} />)

    await user.click(screen.getByRole('tab', { name: '背景除去' }))
    expect(
      screen.getByText(/実行同意は保存されず、背景除去の実行後に解除/u),
    ).toBeVisible()
    await user.click(
      screen.getByLabelText(
        '表示されたモデルを端末内で取得・実行することに同意する',
      ),
    )
    await user.click(
      screen.getByRole('button', {
        name: '同意とモデルキャッシュを削除',
      }),
    )

    await waitFor(() => expect(revoke).toHaveBeenCalledWith(true))
    expect(
      screen.getByLabelText(
        '表示されたモデルを端末内で取得・実行することに同意する',
      ),
    ).not.toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent(
      '実行同意を取り消し、端末内モデルキャッシュを削除しました。',
    )
  })

  it('emits safe script commands and surfaces prohibited globals as errors', async () => {
    const user = userEvent.setup()
    const onScriptCommands = vi.fn()
    render(
      <AdvancedToolsPanel
        {...baseProps({
          onScriptCommands,
        })}
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'スクリプト' }))
    const editor = screen.getByLabelText('エディタースクリプト')
    fireEvent.change(editor, {
      target: {
        value:
          'editor.resize(800, 600); editor.applyFilter("invert", { amount: 1 });',
      },
    })
    await user.click(
      screen.getByRole('button', { name: '安全性を確認して実行' }),
    )

    expect(onScriptCommands).toHaveBeenCalledOnce()
    expect(onScriptCommands.mock.calls[0][0]).toMatchObject([
      { type: 'resizeCanvas', width: 800, height: 600 },
      {
        type: 'applyFilter',
        operation: { id: 'invert', params: { amount: 1 } },
      },
    ])
    expect(screen.getByRole('status')).toHaveTextContent('2件の安全なコマンド')

    fireEvent.change(editor, {
      target: { value: 'fetch("https://example.com/image")' },
    })
    await user.click(
      screen.getByRole('button', { name: '安全性を確認して実行' }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Global capability "fetch" is forbidden',
    )
    expect(onScriptCommands).toHaveBeenCalledOnce()
  })

  it('saves, reloads, deletes, and registers the full safe DSL as a macro', async () => {
    const user = userEvent.setup()
    const scriptStorage = new MemoryStorage()
    const macroStorage = new MemoryStorage()
    const scriptRepository = new LocalScriptRepository(scriptStorage)
    const macroRepository = new LocalMacroRepository(macroStorage)
    const onMacroRegistered = vi.fn()
    render(
      <AdvancedToolsPanel
        {...baseProps({
          scriptRepository,
          macroRepository,
          onMacroRegistered,
        })}
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'スクリプト' }))
    const editor = screen.getByLabelText('エディタースクリプト')
    const source =
      'editor.forEachLayer(layer => { editor.applyFilter("invert", { amount: 1 }, layer.id); });'
    fireEvent.change(screen.getByLabelText('スクリプト名'), {
      target: { value: '全レイヤーを反転' },
    })
    fireEvent.change(editor, { target: { value: source } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(
      (screen.getByLabelText('保存済みスクリプト') as HTMLSelectElement).value,
    ).toMatch(/^script-/u)
    expect(screen.getByRole('status')).toHaveTextContent('端末へ保存しました')

    fireEvent.change(editor, {
      target: { value: 'editor.resize(320, 240);' },
    })
    await user.click(screen.getByRole('button', { name: '読み込み' }))
    expect(editor).toHaveValue(source)

    await user.click(screen.getByRole('button', { name: 'マクロへ登録' }))
    const [savedMacro] = macroRepository.list()
    expect(savedMacro.macro).toMatchObject({
      name: '全レイヤーを反転',
      commands: [{ type: 'runScript', source }],
    })
    expect(onMacroRegistered).toHaveBeenCalledWith(savedMacro)
    expect(screen.getByRole('status')).toHaveTextContent('マクロへ登録しました')

    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(scriptRepository.list()).toEqual([])
    expect(screen.getByLabelText('保存済みスクリプト')).toHaveValue('')
  })

  it('reports document image dimension mismatches without emitting results', async () => {
    const user = userEvent.setup()
    const onSelectionMask = vi.fn()
    render(
      <AdvancedToolsPanel
        {...baseProps({
          getDocumentImageData: vi.fn(async () => imageData(1, 1)),
          onSelectionMask,
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: '自動選択を実行' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        '画像データの寸法がドキュメントと一致しません',
      ),
    )
    expect(onSelectionMask).not.toHaveBeenCalled()
  })
})
