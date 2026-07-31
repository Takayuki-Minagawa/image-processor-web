import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultFilterOperation } from '../editor/filters/registry'
import {
  LocalFilterPresetRepository,
  type FilterPresetStorage,
} from '../editor/filters/presetRepository'
import type { FilterId, FilterOperation } from '../editor/filters/types'
import {
  AdvancedFilterPanel,
  type AdvancedFilterPanelProps,
} from './AdvancedFilterPanel'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const renderPanel = (overrides: Partial<AdvancedFilterPanelProps> = {}) => {
  const onApply = overrides.onApply ?? vi.fn()
  const onChange = overrides.onChange ?? vi.fn()
  render(
    <AdvancedFilterPanel
      {...overrides}
      onApply={onApply}
      onChange={onChange}
    />,
  )
  return { onApply, onChange }
}

const defaults = (...ids: FilterId[]): FilterOperation[] =>
  ids.map((id) => createDefaultFilterOperation(id))

const operation = <I extends FilterId>(
  operations: readonly FilterOperation[],
  id: I,
): FilterOperation<I> =>
  operations.find((candidate) => candidate.id === id) as FilterOperation<I>

const pixel = (red: number, green: number, blue: number): ImageData => {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) {
    throw new Error('Test canvas is unavailable.')
  }
  const image = context.createImageData(1, 1)
  image.data.set([red, green, blue, 255])
  return image
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('AdvancedFilterPanel', () => {
  it('edits levels and tone-curve points with an accessible SVG preview', async () => {
    const { onApply } = renderPanel()
    const user = userEvent.setup()

    for (const label of [
      'レベル補正',
      'トーンカーブ',
      'ホワイトバランス',
      'ビネット',
      'グラデーションマップ',
      'デュオトーン',
      'ハーフトーン',
      'グリッチ',
    ]) {
      expect(
        screen.getByRole('checkbox', { name: `${label}を有効化` }),
      ).toBeVisible()
    }
    expect(
      screen.getByRole('img', { name: 'トーンカーブのプレビュー' }),
    ).toBeVisible()

    await user.click(
      screen.getByRole('checkbox', { name: 'レベル補正を有効化' }),
    )
    await user.click(
      screen.getByRole('checkbox', { name: 'トーンカーブを有効化' }),
    )
    fireEvent.change(screen.getByLabelText('入力ブラック'), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText('ポイント 3 Y'), {
      target: { value: '200' },
    })
    await user.click(screen.getByRole('button', { name: '制御点を追加' }))
    expect(
      screen.getByRole('button', { name: 'ポイント 2 を削除' }),
    ).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: '詳細フィルターを適用' }),
    )

    await waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    const applied = vi.mocked(onApply).mock.calls[0][0]
    expect(operation(applied, 'levels').params.inputBlack).toBe(12)
    expect(operation(applied, 'curves').params.master).toHaveLength(256)
    expect(operation(applied, 'curves').params.master[128]).toBe(200)
    expect(
      screen.getByText('詳細フィルターを適用しました。'),
    ).toHaveTextContent('詳細フィルターを適用しました。')
  })

  it('exposes exact white-balance, color, halftone, and glitch parameters', async () => {
    const { onApply } = renderPanel({
      initialOperations: defaults(
        'white-balance',
        'vignette',
        'gradient-map',
        'duotone',
        'halftone',
        'glitch',
      ),
    })
    const user = userEvent.setup()

    fireEvent.change(screen.getByLabelText('色温度'), {
      target: { value: '0.42' },
    })
    fireEvent.change(screen.getByLabelText('色かぶり補正'), {
      target: { value: '-0.18' },
    })
    fireEvent.change(screen.getByLabelText('ビネット中間点'), {
      target: { value: '0.3' },
    })
    fireEvent.change(screen.getByLabelText('ビネットぼかし'), {
      target: { value: '0.8' },
    })
    fireEvent.change(screen.getByLabelText('ビネット色'), {
      target: { value: '#112233' },
    })
    fireEvent.change(screen.getByLabelText('グラデーション暗部色'), {
      target: { value: '#010203' },
    })
    fireEvent.change(screen.getByLabelText('グラデーション明部色'), {
      target: { value: '#f1e2d3' },
    })
    fireEvent.change(screen.getByLabelText('デュオトーン暗部色'), {
      target: { value: '#102040' },
    })
    fireEvent.change(screen.getByLabelText('デュオトーン明部色'), {
      target: { value: '#f0c080' },
    })
    fireEvent.change(screen.getByLabelText('ドットサイズ'), {
      target: { value: '14' },
    })
    fireEvent.change(screen.getByLabelText('ハーフトーン角度'), {
      target: { value: '72' },
    })
    fireEvent.change(screen.getByLabelText('ドット色'), {
      target: { value: '#090909' },
    })
    fireEvent.change(screen.getByLabelText('ハーフトーン背景色'), {
      target: { value: '#eeeeee' },
    })
    fireEvent.change(screen.getByLabelText('グリッチ量'), {
      target: { value: '0.6' },
    })
    fireEvent.change(screen.getByLabelText('RGBオフセット'), {
      target: { value: '24' },
    })
    fireEvent.change(screen.getByLabelText('スキャンライン'), {
      target: { value: '0.35' },
    })
    fireEvent.change(screen.getByLabelText('グリッチ乱数シード'), {
      target: { value: '42' },
    })

    await user.click(
      screen.getByRole('button', { name: '詳細フィルターを適用' }),
    )
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    const applied = vi.mocked(onApply).mock.calls[0][0]

    expect(operation(applied, 'white-balance').params).toEqual({
      temperature: 0.42,
      tint: -0.18,
    })
    expect(operation(applied, 'vignette').params).toMatchObject({
      midpoint: 0.3,
      softness: 0.8,
      color: { r: 17, g: 34, b: 51 },
    })
    expect(operation(applied, 'gradient-map').params.stops).toEqual([
      { offset: 0, color: { r: 1, g: 2, b: 3 } },
      { offset: 1, color: { r: 241, g: 226, b: 211 } },
    ])
    expect(operation(applied, 'duotone').params).toEqual({
      shadows: { r: 16, g: 32, b: 64 },
      highlights: { r: 240, g: 192, b: 128 },
    })
    expect(operation(applied, 'halftone').params).toEqual({
      size: 14,
      angle: 72,
      foreground: { r: 9, g: 9, b: 9 },
      background: { r: 238, g: 238, b: 238 },
    })
    expect(operation(applied, 'glitch').params).toEqual({
      amount: 0.6,
      offset: 24,
      scanlines: 0.35,
      seed: 42,
    })
  })

  it('saves and reapplies presets from the session fallback when storage fails', async () => {
    const storage: FilterPresetStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
      removeItem: () => undefined,
    }
    const repository = new LocalFilterPresetRepository(storage)
    const { onApply } = renderPanel({
      repository,
      initialOperations: defaults('duotone'),
    })
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('新しいプリセット名'), 'Brand Ink')
    await user.click(screen.getByRole('button', { name: '現在の設定を保存' }))
    expect(
      screen.getByText(/このセッションだけに保存されました/u),
    ).toHaveTextContent('このセッションだけに保存されました')
    expect(
      screen.getByRole('option', { name: 'Brand Ink' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('デュオトーン暗部色'), {
      target: { value: '#ffffff' },
    })
    await user.click(screen.getByRole('button', { name: 'プリセットを適用' }))

    await waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect(
      operation(vi.mocked(onApply).mock.calls[0][0], 'duotone').params.shadows,
    ).toEqual({ r: 24, g: 18, b: 64 })
    expect(
      screen.getByText('プリセット「Brand Ink」を適用しました。'),
    ).toHaveTextContent('プリセット「Brand Ink」を適用しました。')
  })

  it('separates raster application from adding and updating an adjustment layer', async () => {
    const onApply = vi.fn()
    const onAddAdjustment = vi.fn()
    const onUpdateAdjustment = vi.fn()
    const levels = createDefaultFilterOperation('levels')
    const view = render(
      <AdvancedFilterPanel
        initialOperations={[levels]}
        onApply={onApply}
        onAddAdjustment={onAddAdjustment}
        onUpdateAdjustment={onUpdateAdjustment}
      />,
    )
    const user = userEvent.setup()

    expect(screen.getByText('ラスターレイヤーへ適用')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: '調整レイヤーとして追加' }),
    )
    await waitFor(() => expect(onAddAdjustment).toHaveBeenCalledOnce())
    expect(onApply).not.toHaveBeenCalled()
    expect(onAddAdjustment).toHaveBeenCalledWith([levels])

    const updated: FilterOperation[] = [
      {
        id: 'white-balance',
        params: { temperature: 0.35, tint: -0.2 },
      },
    ]
    view.rerender(
      <AdvancedFilterPanel
        initialOperations={updated}
        editingAdjustmentId="adjustment-1"
        onApply={onApply}
        onAddAdjustment={onAddAdjustment}
        onUpdateAdjustment={onUpdateAdjustment}
      />,
    )
    await waitFor(() =>
      expect(screen.getByLabelText('色温度')).toHaveValue(0.35),
    )
    await user.click(
      screen.getByRole('button', {
        name: '選択中の調整レイヤーを更新',
      }),
    )
    await waitFor(() => expect(onUpdateAdjustment).toHaveBeenCalledOnce())
    expect(onUpdateAdjustment).toHaveBeenCalledWith('adjustment-1', updated)
    expect(onAddAdjustment).toHaveBeenCalledOnce()
  })

  it('renders a debounced before/after preview from the active operation chain', async () => {
    const levels = createDefaultFilterOperation('levels')
    const renderPreview = vi.fn(
      async (operations: readonly FilterOperation[], signal: AbortSignal) => {
        expect(operations).toEqual([levels])
        expect(signal).toBeInstanceOf(AbortSignal)
        return {
          before: pixel(16, 32, 48),
          after: pixel(240, 220, 200),
        }
      },
    )

    renderPanel({ initialOperations: [levels], renderPreview })

    expect(
      screen.getByRole('region', { name: '実画像フィルタープレビュー' }),
    ).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(renderPreview).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.getByAltText('フィルター適用後のプレビュー')).toBeVisible(),
    )

    expect(renderPreview.mock.calls[0][0]).toEqual([levels])
    expect(renderPreview.mock.calls[0][1]).toBeInstanceOf(AbortSignal)
    expect(screen.getByText('有効な 1 件を適用')).toBeVisible()
    expect(
      screen.getByAltText<HTMLImageElement>('フィルター適用前のプレビュー').src,
    ).toMatch(/^data:image\/png;base64,/u)
    expect(
      screen.getByAltText<HTMLImageElement>('フィルター適用後のプレビュー').src,
    ).toMatch(/^data:image\/png;base64,/u)
  })

  it('cancels superseded preview work and never publishes its stale result', async () => {
    vi.useFakeTimers()
    const requests: Array<{
      signal: AbortSignal
      result: ReturnType<
        typeof deferred<{ before: ImageData; after: ImageData }>
      >
    }> = []
    const renderPreview = vi.fn(
      (_operations: readonly FilterOperation[], signal: AbortSignal) => {
        const result = deferred<{ before: ImageData; after: ImageData }>()
        requests.push({ signal, result })
        return result.promise
      },
    )
    renderPanel({
      initialOperations: [createDefaultFilterOperation('levels')],
      renderPreview,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })
    expect(renderPreview).toHaveBeenCalledOnce()

    fireEvent.change(screen.getByLabelText('ガンマ'), {
      target: { value: '1.5' },
    })
    expect(requests[0].signal.aborted).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })
    expect(renderPreview).toHaveBeenCalledTimes(2)

    await act(async () => {
      requests[1].result.resolve({
        before: pixel(8, 16, 24),
        after: pixel(200, 120, 40),
      })
      await Promise.resolve()
    })
    const published =
      screen.getByAltText<HTMLImageElement>('フィルター適用後のプレビュー').src

    await act(async () => {
      requests[0].result.resolve({
        before: pixel(1, 2, 3),
        after: pixel(4, 5, 6),
      })
      await Promise.resolve()
    })
    expect(
      screen.getByAltText<HTMLImageElement>('フィルター適用後のプレビュー').src,
    ).toBe(published)
  })
})
