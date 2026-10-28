import {
  expect,
  test,
  type Download,
  type Locator,
  type Page,
} from '@playwright/test'

const storageKey = 'image-processor-web:export-presets:v1'

interface StoredPreset {
  id: string
  name: string
  settings: Record<string, unknown>
}

const presetControls = (container: Locator) =>
  container.getByRole('group', { name: '出力設定プリセット', exact: true })

const expandPresets = async (container: Locator) => {
  await container
    .locator('summary')
    .filter({ hasText: '出力設定プリセット' })
    .click()
  await expect(presetControls(container)).toBeVisible()
}

const openImageExport = async (page: Page) => {
  await page.getByRole('button', { name: '書き出す', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '画像を書き出す' })
  await expect(dialog).toBeVisible()
  await expandPresets(dialog)
  return dialog
}

const openPdfExport = async (page: Page) => {
  const imageDialog = await openImageExport(page)
  await imageDialog
    .getByRole('button', { name: 'PDF 画像として出力…', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: '拡張ツール' })
  const panel = dialog.getByRole('tabpanel', { name: 'デザイン' })
  await expect(panel.getByLabel('画像の圧縮')).toBeVisible()
  await expandPresets(panel)
  return { dialog, panel }
}

const downloadBytes = async (download: Download): Promise<Buffer> => {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Download stream is missing.')
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(Buffer.from(part))
  return Buffer.concat(parts)
}

const readLibrary = async (page: Page) => {
  const source = await page.evaluate<string | null>(
    `localStorage.getItem(${JSON.stringify(storageKey)})`,
  )
  expect(source).not.toBeNull()
  return JSON.parse(source!) as { version: number; presets: StoredPreset[] }
}

const setImageQuality = async (dialog: Locator, quality: number) => {
  await dialog
    .getByLabel('品質', { exact: true })
    .evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        'value',
      )?.set
      if (!setter) throw new Error('Quality range setter is missing.')
      setter.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }, String(quality))
}

const selectAndApply = async (controls: Locator, name: string) => {
  await controls.getByLabel('保存したプリセット').selectOption({ label: name })
  await controls.getByRole('button', { name: '適用', exact: true }).click()
}

const saveNew = async (controls: Locator, name: string) => {
  await controls.getByLabel('プリセット名', { exact: true }).fill(name)
  await controls.getByRole('button', { name: '新規保存', exact: true }).click()
  await expect(
    controls.getByLabel('保存したプリセット').locator('option:checked'),
  ).toHaveText(name)
}

const importPhysicalPage = async (
  page: Page,
  widthMm: number,
  heightMm: number,
  append: boolean,
) => {
  await page.locator('input[type="file"][accept*=".pwx.json"]').setInputFiles({
    name: `page-${widthMm}.svg`,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3355aa"/></svg>`,
    ),
  })
  const dialog = page.getByRole('dialog', { name: 'SVGの原寸で開く' })
  if (append) await dialog.getByLabel('取込先').selectOption('append')
  await dialog.getByRole('button', { name: 'SVGを取り込む' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('Named output settings presets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./')
    await expect(
      page.getByRole('region', { name: '画像編集キャンバス' }),
    ).toBeVisible()
  })

  test('image presets support explicit apply, rename/update, reload and confirmed deletion without starting an export', async ({
    page,
  }) => {
    const downloads: string[] = []
    page.on('download', (download) =>
      downloads.push(download.suggestedFilename()),
    )
    let dialog = await openImageExport(page)
    let controls = presetControls(dialog)
    await dialog.getByRole('radio', { name: /^JPG/u }).check()
    await setImageQuality(dialog, 0.67)
    await dialog.getByLabel('出力倍率').selectOption('0.5')
    await saveNew(controls, 'Web preview')

    await dialog.getByRole('radio', { name: /^PNG/u }).check()
    await dialog.getByLabel('出力倍率').selectOption('1')
    await controls
      .getByLabel('保存したプリセット')
      .selectOption({ label: 'Web preview' })
    await expect(dialog.getByRole('radio', { name: /^PNG/u })).toBeChecked()
    await expect(dialog.getByLabel('出力倍率')).toHaveValue('1')
    await controls.getByRole('button', { name: '適用', exact: true }).click()
    await expect(dialog.getByRole('radio', { name: /^JPG/u })).toBeChecked()
    await expect(dialog.getByLabel('品質', { exact: true })).toHaveValue('0.67')
    await expect(dialog.getByLabel('出力倍率')).toHaveValue('0.5')
    await dialog
      .getByRole('button', { name: 'キャンセル', exact: true })
      .click()

    await page.reload()
    dialog = await openImageExport(page)
    controls = presetControls(dialog)
    await expect(controls.getByLabel('保存したプリセット')).toHaveValue('')
    await expect(dialog.getByRole('radio', { name: /^PNG/u })).toBeChecked()
    await selectAndApply(controls, 'Web preview')
    await expect(dialog.getByRole('radio', { name: /^JPG/u })).toBeChecked()
    await expect(dialog.getByLabel('品質', { exact: true })).toHaveValue('0.67')
    await expect(dialog.getByLabel('出力倍率')).toHaveValue('0.5')

    await dialog.getByRole('radio', { name: /^PNG/u }).check()
    await controls
      .getByLabel('プリセット名', { exact: true })
      .fill('Web half-size')
    await controls
      .getByRole('button', { name: '上書き保存', exact: true })
      .click()
    await expect(
      controls.getByLabel('保存したプリセット').locator('option:checked'),
    ).toHaveText('Web half-size')
    await expect(
      controls.getByLabel('保存したプリセット').locator('option'),
    ).toHaveCount(2)
    const saved = (await readLibrary(page)).presets
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      name: 'Web half-size',
      settings: {
        kind: 'image',
        format: 'png',
        quality: 0.67,
        multiplier: 0.5,
      },
    })
    expect(downloads).toEqual([])

    const downloaded = page.waitForEvent('download')
    await dialog
      .getByRole('button', { name: 'ダウンロード', exact: true })
      .click()
    const bytes = await downloadBytes(await downloaded)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes.readUInt32BE(16)).toBe(640)
    expect(bytes.readUInt32BE(20)).toBe(360)
    await expect(dialog).toBeHidden()

    dialog = await openImageExport(page)
    controls = presetControls(dialog)
    await controls
      .getByLabel('保存したプリセット')
      .selectOption({ label: 'Web half-size' })
    page.once('dialog', (confirmation) => confirmation.dismiss())
    await controls.getByRole('button', { name: '削除', exact: true }).click()
    await expect(
      controls.getByRole('option', { name: 'Web half-size', exact: true }),
    ).toHaveCount(1)
    page.once('dialog', (confirmation) => confirmation.accept())
    await controls.getByRole('button', { name: '削除', exact: true }).click()
    await expect(
      controls.getByRole('option', { name: 'Web half-size', exact: true }),
    ).toHaveCount(0)
    await expect(dialog.getByLabel('出力倍率')).toHaveValue('0.5')
    await page.reload()
    dialog = await openImageExport(page)
    await expect(
      presetControls(dialog).getByLabel('保存したプリセット').locator('option'),
    ).toHaveCount(1)
    expect(downloads).toHaveLength(1)
  })

  test('PDF presets preserve the current page selection and determine compression, DPI and physical output boxes', async ({
    page,
  }) => {
    await importPhysicalPage(page, 25.4, 25.4, false)
    await importPhysicalPage(page, 12.7, 25.4, true)
    const { dialog, panel } = await openPdfExport(page)
    const controls = presetControls(panel)
    await panel.getByLabel('DPI', { exact: true }).fill('144')
    await panel.getByLabel('塗り足し mm', { exact: true }).fill('2')
    await panel.getByLabel('トンボを付ける').check()
    await panel.getByLabel('画像の圧縮').selectOption('jpeg')
    await panel.getByLabel('JPEG画質（10～100）').fill('65')
    await saveNew(controls, 'Print draft')
    await panel.getByLabel('DPI', { exact: true }).fill('72')
    await panel.getByLabel('トンボを付ける').uncheck()
    await panel.getByLabel('塗り足し mm', { exact: true }).fill('0')
    await panel.getByLabel('画像の圧縮').selectOption('lossless')
    await panel.getByLabel('ページ範囲').selectOption('selected')
    const pages = panel
      .getByRole('group', { name: '書き出すページ' })
      .getByRole('checkbox')
    await expect(pages).toHaveCount(2)
    await pages.nth(0).uncheck()
    await selectAndApply(controls, 'Print draft')
    await expect(panel.getByLabel('ページ範囲')).toHaveValue('selected')
    await expect(pages.nth(0)).not.toBeChecked()
    await expect(pages.nth(1)).toBeChecked()
    await expect(panel.getByLabel('DPI', { exact: true })).toHaveValue('144')
    await expect(panel.getByLabel('塗り足し mm', { exact: true })).toHaveValue(
      '2',
    )
    await expect(panel.getByLabel('トンボを付ける')).toBeChecked()
    await expect(panel.getByLabel('画像の圧縮')).toHaveValue('jpeg')
    await expect(panel.getByLabel('JPEG画質（10～100）')).toHaveValue('65')

    const downloaded = page.waitForEvent('download')
    await panel.getByRole('button', { name: '書き出す', exact: true }).click()
    const output = (await downloadBytes(await downloaded)).toString('latin1')
    expect(output).toMatch(/^%PDF-/u)
    expect(output.match(/\/Subtype \/Image/gu)).toHaveLength(1)
    expect(output).toContain('/DCTDecode')
    expect(output).not.toContain('/FlateDecode')
    expect(output).toMatch(/\/Width 95\s+\/Height 167/u)
    const trim = /\/TrimBox\s*\[([^\]]+)\]/u
      .exec(output)?.[1]
      .trim()
      .split(/\s+/u)
      .map(Number)
    expect(trim).toHaveLength(4)
    expect(trim![0]).toBeCloseTo((2 / 25.4) * 72, 2)
    expect(trim![1]).toBeCloseTo((2 / 25.4) * 72, 2)
    expect(trim![2] - trim![0]).toBeCloseTo(36, 2)
    expect(trim![3] - trim![1]).toBeCloseTo(72, 2)
    const saved = (await readLibrary(page)).presets[0]
    expect(saved.settings).toEqual({
      kind: 'pdf',
      dpi: 144,
      bleedMm: 2,
      cropMarks: true,
      pdfCompression: 'jpeg',
      jpegQuality: 0.65,
    })
    for (const format of ['GIF', '動画', 'PNG（ZIP）']) {
      await panel.getByRole('button', { name: format, exact: true }).click()
      await expect(controls).toHaveCount(0)
    }
    await panel
      .getByRole('button', { name: 'PDF（画像として出力）', exact: true })
      .click()
    await expandPresets(panel)
    await expect(controls).toBeVisible()
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  })

  test('applying a stored image scale rechecks the current canvas limit before any download', async ({
    page,
  }) => {
    let dialog = await openImageExport(page)
    await dialog.getByLabel('出力倍率').selectOption('2')
    await saveNew(presetControls(dialog), 'Double resolution')
    await dialog.getByLabel('出力倍率').selectOption('1')
    await dialog
      .getByRole('button', { name: 'キャンセル', exact: true })
      .click()
    await page.getByRole('button', { name: '新規', exact: true }).click()
    const create = page.getByRole('dialog', { name: '新しいキャンバス' })
    await create.getByLabel('幅 (px)').fill('5000')
    await create.getByLabel('高さ (px)').fill('100')
    await create.getByRole('button', { name: '作成', exact: true }).click()
    await expect(create).toBeHidden()
    dialog = await openImageExport(page)
    await selectAndApply(presetControls(dialog), 'Double resolution')
    await expect(dialog.getByLabel('出力倍率')).toHaveValue('2')
    await expect(dialog.getByRole('alert')).toContainText('8,192 px')
    await expect(
      dialog.getByRole('button', { name: 'ダウンロード', exact: true }),
    ).toBeDisabled()
    await dialog.getByLabel('出力倍率').selectOption('1')
    await expect(
      dialog.getByRole('button', { name: 'ダウンロード', exact: true }),
    ).toBeEnabled()
    const downloaded = page.waitForEvent('download')
    await dialog
      .getByRole('button', { name: 'ダウンロード', exact: true })
      .click()
    const bytes = await downloadBytes(await downloaded)
    expect(bytes.readUInt32BE(16)).toBe(5000)
    expect(bytes.readUInt32BE(20)).toBe(100)
  })

  test('blocked browser storage keeps session presets across dialog remounts and explains their temporary lifetime', async ({
    page,
  }) => {
    await page.addInitScript(`(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Blocked', 'SecurityError') },
      })
    })()`)
    await page.reload()
    let dialog = await openImageExport(page)
    await dialog.getByRole('radio', { name: /^WEBP/u }).check()
    await setImageQuality(dialog, 0.44)
    await dialog.getByLabel('出力倍率').selectOption('0.5')
    await saveNew(presetControls(dialog), 'Session preview')
    await expect(presetControls(dialog)).toContainText(
      'ブラウザへ保存できないため、このタブを開いている間だけ保持します。再読み込みすると今回の変更は失われます。',
    )
    await dialog.getByRole('radio', { name: /^PNG/u }).check()
    await dialog.getByLabel('出力倍率').selectOption('1')
    await dialog
      .getByRole('button', { name: 'キャンセル', exact: true })
      .click()
    dialog = await openImageExport(page)
    await selectAndApply(presetControls(dialog), 'Session preview')
    await expect(dialog.getByRole('radio', { name: /^WEBP/u })).toBeChecked()
    await expect(dialog.getByLabel('品質', { exact: true })).toHaveValue('0.44')
    await expect(dialog.getByLabel('出力倍率')).toHaveValue('0.5')
    await page.reload()
    dialog = await openImageExport(page)
    await expect(
      presetControls(dialog).getByLabel('保存したプリセット').locator('option'),
    ).toHaveCount(1)
  })

  test('image and PDF libraries remain separate and SVG selection is never saved or replaced by a preset', async ({
    page,
  }) => {
    const downloads: string[] = []
    page.on('download', (download) =>
      downloads.push(download.suggestedFilename()),
    )
    let imageDialog = await openImageExport(page)
    let controls = presetControls(imageDialog)
    await imageDialog.getByRole('radio', { name: /^SVG/u }).check()
    await imageDialog.getByLabel('SVGの範囲').selectOption('document')
    await controls
      .getByLabel('プリセット名', { exact: true })
      .fill('Shared name')
    await controls.getByLabel('プリセット名', { exact: true }).press('Enter')
    await expect(imageDialog).toBeVisible()
    expect(downloads).toEqual([])
    await saveNew(controls, 'Shared name')
    await imageDialog.getByLabel('SVGの範囲').selectOption('selection')
    await selectAndApply(controls, 'Shared name')
    await expect(imageDialog.getByLabel('SVGの範囲')).toHaveValue('selection')
    await imageDialog
      .getByRole('button', { name: 'キャンセル', exact: true })
      .click()

    const { dialog: studioDialog, panel } = await openPdfExport(page)
    controls = presetControls(panel)
    await expect(
      controls.getByLabel('保存したプリセット').locator('option'),
    ).toHaveCount(1)
    await saveNew(controls, 'Shared name')
    const library = await readLibrary(page)
    expect(library.version).toBe(1)
    expect(library.presets).toHaveLength(2)
    const imagePreset = library.presets.find(
      ({ settings }) => settings.kind === 'image',
    )!
    const pdfPreset = library.presets.find(
      ({ settings }) => settings.kind === 'pdf',
    )!
    expect(Object.keys(imagePreset.settings).sort()).toEqual([
      'format',
      'kind',
      'multiplier',
      'quality',
    ])
    expect(Object.keys(pdfPreset.settings).sort()).toEqual([
      'bleedMm',
      'cropMarks',
      'dpi',
      'jpegQuality',
      'kind',
      'pdfCompression',
    ])
    await studioDialog
      .getByRole('button', { name: '閉じる', exact: true })
      .click()
    imageDialog = await openImageExport(page)
    controls = presetControls(imageDialog)
    await expect(
      controls.getByLabel('保存したプリセット').locator('option'),
    ).toHaveCount(2)
    expect(downloads).toEqual([])
  })

  test('two tabs receive native additions, renames and deletions, and queued concurrent saves retain both presets', async ({
    page,
    context,
  }) => {
    const other = await context.newPage()
    await other.goto('./')
    const firstDialog = await openImageExport(page)
    const secondDialog = await openImageExport(other)
    const first = presetControls(firstDialog)
    const second = presetControls(secondDialog)
    const secondSelect = second.getByLabel('保存したプリセット')
    const secondName = second.getByLabel('プリセット名', { exact: true })

    await firstDialog.getByLabel('出力倍率').selectOption('0.5')
    await saveNew(first, 'Team preview')
    await expect(secondSelect.locator('option')).toHaveCount(2)
    await expect(secondSelect).toHaveValue('')
    await secondSelect.selectOption({ label: 'Team preview' })
    await expect(secondName).toHaveValue('Team preview')

    await first
      .getByLabel('プリセット名', { exact: true })
      .fill('Renamed preview')
    await first.getByRole('button', { name: '上書き保存', exact: true }).click()
    await expect(secondSelect.locator('option:checked')).toHaveText(
      'Renamed preview',
    )
    await expect(secondName).toHaveValue('Renamed preview')
    await expect(secondDialog.getByLabel('出力倍率')).toHaveValue('1')

    // Updating settings in the receiving tab must retain the external rename.
    await secondDialog.getByLabel('出力倍率').selectOption('2')
    await second
      .getByRole('button', { name: '上書き保存', exact: true })
      .click()
    await expect
      .poll(async () => (await readLibrary(page)).presets)
      .toEqual([
        expect.objectContaining({
          name: 'Renamed preview',
          settings: {
            kind: 'image',
            format: 'png',
            quality: 0.92,
            multiplier: 2,
          },
        }),
      ])
    await expect(first.getByLabel('プリセット名', { exact: true })).toHaveValue(
      'Renamed preview',
    )
    await expect(firstDialog.getByLabel('出力倍率')).toHaveValue('0.5')

    page.once('dialog', (confirmation) => confirmation.accept())
    await first.getByRole('button', { name: '削除', exact: true }).click()
    await expect(secondSelect.locator('option')).toHaveCount(1)
    await expect(secondSelect).toHaveValue('')
    await expect(secondName).toHaveValue('')
    await expect(
      second.getByRole('button', { name: '適用', exact: true }),
    ).toBeDisabled()
    await expect(
      second.getByRole('button', { name: '上書き保存', exact: true }),
    ).toBeDisabled()

    await first.getByLabel('プリセット名', { exact: true }).fill('First tab')
    await secondName.fill('Second tab')
    const lockName = `${storageKey}:write`
    // Hold the actual browser lock so both UI saves queue before either writes.
    // Their native storage events and post-save refreshes must converge afterward.
    await page.evaluate(`(async () => {
      if (!navigator.locks) throw new Error('Web Locks are required for this test')
      await new Promise((acquired) => {
        navigator.locks.request(${JSON.stringify(lockName)}, () => {
          acquired()
          return new Promise((release) => { globalThis.releasePresetTestLock = release })
        })
      })
    })()`)
    try {
      await Promise.all([
        first.getByRole('button', { name: '新規保存', exact: true }).click(),
        second.getByRole('button', { name: '新規保存', exact: true }).click(),
      ])
      await expect
        .poll(() =>
          page.evaluate<number>(`(async () => {
        const state = await navigator.locks.query()
        return state.pending.filter((lock) => lock.name === ${JSON.stringify(lockName)}).length
      })()`),
        )
        .toBe(2)
      await expect(
        first.getByRole('button', { name: '新規保存', exact: true }),
      ).toBeDisabled()
      await expect(
        second.getByRole('button', { name: '新規保存', exact: true }),
      ).toBeDisabled()
    } finally {
      await page.evaluate('globalThis.releasePresetTestLock()')
    }
    await expect(
      first.getByLabel('保存したプリセット').locator('option'),
    ).toHaveCount(3)
    await expect(secondSelect.locator('option')).toHaveCount(3)
    await expect(
      first.getByLabel('保存したプリセット').locator('option:checked'),
    ).toHaveText('First tab')
    await expect(secondSelect.locator('option:checked')).toHaveText(
      'Second tab',
    )
    const saved = (await readLibrary(page)).presets
    expect(saved.map(({ name }) => name).sort()).toEqual([
      'First tab',
      'Second tab',
    ])
    expect(
      saved.find(({ name }) => name === 'First tab')?.settings.multiplier,
    ).toBe(0.5)
    expect(
      saved.find(({ name }) => name === 'Second tab')?.settings.multiplier,
    ).toBe(2)
    await other.close()
  })
})
