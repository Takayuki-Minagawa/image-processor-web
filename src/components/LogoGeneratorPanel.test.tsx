import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LogoGeneratorPanel,
  type LogoGeneratorPanelProps,
} from './LogoGeneratorPanel'

afterEach(cleanup)

const renderPanel = (overrides: Partial<LogoGeneratorPanelProps> = {}) => {
  const onInsert = overrides.onInsert ?? vi.fn()
  render(
    <LogoGeneratorPanel
      {...overrides}
      onInsert={onInsert}
      seed={overrides.seed ?? 'component-test'}
    />,
  )
  return { onInsert }
}

const generateNamedLogo = async (name = 'Pixelweave Studio') => {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('名称'), name)
  await user.click(screen.getByRole('button', { name: '候補を生成' }))
  return user
}

describe('LogoGeneratorPanel', () => {
  it('accepts logo inputs and exposes at least twelve accessible preview cards', async () => {
    const { onInsert } = renderPanel({ candidateCount: 8 })
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('名称'), 'North Star')
    await user.type(screen.getByLabelText('イニシャル'), 'NS')
    await user.type(screen.getByLabelText('タグライン'), 'Find your way')
    fireEvent.change(screen.getByLabelText('基準色'), {
      target: { value: '#ff0000' },
    })
    await user.selectOptions(screen.getByLabelText('配色ルール'), 'triadic')
    await user.click(screen.getByRole('button', { name: '候補を生成' }))

    const list = screen.getByRole('list', { name: 'ロゴ候補' })
    const cards = within(list).getAllByRole('button', {
      name: /^候補 \d+:/u,
    })
    expect(cards).toHaveLength(12)
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true')
    expect(cards[0]).toHaveAccessibleName(/配色 Triadic/u)
    expect(screen.getByRole('status')).toHaveTextContent(
      '12件の候補を生成しました。',
    )

    await user.click(cards[1])
    expect(cards[0]).toHaveAttribute('aria-pressed', 'false')
    expect(cards[1]).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '選択した候補を挿入' }))

    expect(onInsert).toHaveBeenCalledOnce()
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          name: 'North Star',
          initials: 'NS',
          tagline: 'Find your way',
        },
        palette: expect.objectContaining({
          colors: expect.objectContaining({ primary: expect.any(String) }),
        }),
        elements: expect.any(Array),
      }),
    )
  })

  it('retains the selected palette, font, and layout during seeded reshuffle', async () => {
    const { onInsert } = renderPanel()
    const user = await generateNamedLogo('Locked Brand')
    const list = screen.getByRole('list', { name: 'ロゴ候補' })
    const cards = within(list).getAllByRole('button', {
      name: /^候補 \d+:/u,
    })
    await user.click(cards[4])
    await user.click(screen.getByRole('button', { name: '選択した候補を挿入' }))
    const before = vi.mocked(onInsert).mock.calls[0][0]

    await user.click(screen.getByRole('checkbox', { name: '配色を固定' }))
    await user.click(screen.getByRole('checkbox', { name: 'フォントを固定' }))
    await user.click(screen.getByRole('checkbox', { name: 'レイアウトを固定' }))
    expect(screen.getByLabelText('基準色')).toBeDisabled()
    expect(screen.getByLabelText('配色ルール')).toBeDisabled()

    await user.click(
      screen.getByRole('button', { name: '固定項目を保って再生成' }),
    )
    const regenerated = within(
      screen.getByRole('list', { name: 'ロゴ候補' }),
    ).getAllByRole('button', { name: /^候補 \d+:/u })
    expect(regenerated).toHaveLength(12)
    expect(regenerated[0]).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '選択した候補を挿入' }))
    const after = vi.mocked(onInsert).mock.calls[1][0]

    expect(after.id).not.toBe(before.id)
    expect(after.templateId).toBe(before.templateId)
    expect(after.paletteId).toBe(before.paletteId)
    expect(after.palette.colors).toEqual(before.palette.colors)
    expect(after.fontPairId).toBe(before.fontPairId)
  })

  it('changes the deterministic candidate order when reshuffling unlocked choices', async () => {
    renderPanel({ seed: 'known-seed' })
    const user = await generateNamedLogo('Shuffle Brand')
    const labelsBefore = within(screen.getByRole('list', { name: 'ロゴ候補' }))
      .getAllByRole('button', { name: /^候補 \d+:/u })
      .map((card) => card.getAttribute('aria-label'))

    await user.click(
      screen.getByRole('button', { name: '固定項目を保って再生成' }),
    )
    const labelsAfter = within(screen.getByRole('list', { name: 'ロゴ候補' }))
      .getAllByRole('button', { name: /^候補 \d+:/u })
      .map((card) => card.getAttribute('aria-label'))

    expect(labelsAfter).not.toEqual(labelsBefore)
  })

  it('reports invalid input without creating candidates', async () => {
    renderPanel()
    const user = userEvent.setup()

    expect(
      screen.getByRole('button', { name: '選択した候補を挿入' }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '候補を生成' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      /候補を生成できませんでした.*name/iu,
    )
    expect(screen.queryByRole('list', { name: 'ロゴ候補' })).toBeNull()
    expect(screen.getByText('生成された候補はありません。')).toBeVisible()
  })

  it('handles an empty template source as a no-candidate state', async () => {
    renderPanel({ initialName: 'No Templates', templates: [] })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '候補を生成' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      /候補を生成できませんでした/iu,
    )
    expect(screen.queryByRole('list', { name: 'ロゴ候補' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(
      '候補は生成されませんでした。',
    )
  })

  it('extracts dominant canvas colors and applies a swatch to generated candidates', async () => {
    const getImageData = vi.fn(async () => ({
      width: 4,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255,
      ]),
    }))
    const { onInsert } = renderPanel({
      initialName: 'Palette Brand',
      getImageData,
      paletteColorCount: 2,
    })
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', {
        name: '現在のキャンバスから色を抽出',
      }),
    )

    expect(getImageData).toHaveBeenCalledOnce()
    expect(await screen.findByRole('status')).toHaveTextContent(
      '現在のキャンバスから2色を抽出しました。',
    )
    const blue = screen.getByRole('button', {
      name: /抽出色 #0000ff.*ロゴ候補へ適用/u,
    })
    expect(
      screen.getByRole('button', {
        name: /抽出色 #ff0000.*使用率 75%/u,
      }),
    ).toBeVisible()

    await user.click(blue)
    expect(screen.getByLabelText('基準色')).toHaveValue('#0000ff')
    await user.click(screen.getByRole('button', { name: '候補を生成' }))
    await user.click(screen.getByRole('button', { name: '選択した候補を挿入' }))

    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        palette: expect.objectContaining({
          colors: expect.objectContaining({ primary: '#0000ff' }),
        }),
      }),
    )
  })

  it('offers visual harmony choices and regenerates candidates with the selected rule', async () => {
    const { onInsert } = renderPanel({ initialName: 'Harmony Brand' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '候補を生成' }))

    const triadic = screen.getByRole('button', {
      name: 'トライアドの配色を選択',
    })
    expect(triadic).toHaveAttribute('aria-pressed', 'false')
    await user.click(triadic)
    expect(triadic).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('配色ルール')).toHaveValue('triadic')

    await user.click(screen.getByRole('button', { name: '選択した候補を挿入' }))
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        paletteId: 'harmony-triadic',
      }),
    )
  })

  it('exposes explicit fill and stroke callbacks for an extracted swatch', async () => {
    const onApplyColor = vi.fn()
    renderPanel({
      getImageData: () => ({
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([18, 52, 86, 255]),
      }),
      onApplyColor,
    })
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', {
        name: '現在のキャンバスから色を抽出',
      }),
    )

    await user.click(
      screen.getByRole('button', {
        name: /抽出色 #123456.*ロゴ候補へ適用/u,
      }),
    )
    await user.click(screen.getByRole('button', { name: '選択色を塗りに適用' }))
    await user.click(
      screen.getByRole('button', { name: '選択色を縁取りに適用' }),
    )

    expect(onApplyColor).toHaveBeenNthCalledWith(1, '#123456', 'fill')
    expect(onApplyColor).toHaveBeenNthCalledWith(2, '#123456', 'stroke')
    expect(screen.getByRole('status')).toHaveTextContent(
      '#123456を選択オブジェクトの縁取りに適用しました。',
    )
  })

  it('reports palette-source errors accessibly and keeps the generator usable', async () => {
    renderPanel({
      initialName: 'Resilient Brand',
      getImageData: async () => {
        throw new Error('キャンバスを読み取れません')
      },
    })
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', {
        name: '現在のキャンバスから色を抽出',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /主要色を抽出できませんでした.*キャンバスを読み取れません/u,
    )

    await user.click(screen.getByRole('button', { name: '候補を生成' }))
    expect(
      within(screen.getByRole('list', { name: 'ロゴ候補' })).getAllByRole(
        'button',
        { name: /^候補 \d+:/u },
      ),
    ).toHaveLength(12)
  })
})
