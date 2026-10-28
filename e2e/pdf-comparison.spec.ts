import {
  expect,
  test,
  type Download,
  type Locator,
  type Page,
} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { ProjectDocument } from '../src/editor/types'

interface SyntheticPage {
  box: string
  content: string
}

const sourceMarker = 'artificial-comparison-reference-private-marker'

/** Artificial PDFs with visible colors and independently readable page boxes. */
const makePdf = (pages: SyntheticPage[]): Buffer => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] >>`,
  ]
  for (const [index, page] of pages.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R ${page.box} /Resources << >> /Contents ${4 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(page.content)} >>\nstream\n${page.content}\nendstream`,
    )
  }
  let source = `%PDF-1.7\n% ${sourceMarker}\n`
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}

const redPage: SyntheticPage = {
  box: '/MediaBox [0 0 300 200]',
  content: '1 0 0 rg 0 0 300 200 re f',
}
const croppedPage: SyntheticPage = {
  box: '/MediaBox [0 0 400 300] /CropBox [40 30 240 130] /Rotate 90 /UserUnit 2',
  content: '1 0 0 rg 40 30 100 100 re f 0 0 1 rg 140 30 100 100 re f',
}
const blueSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0000ff" stroke-width="0"/></svg>'

const downloadBytes = async (download: Download): Promise<Buffer> => {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Download stream is missing.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const saveProject = async (page: Page) => {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const bytes = await downloadBytes(await downloaded)
  return { bytes, project: JSON.parse(bytes.toString()) as ProjectDocument }
}

const importPdf = async (
  page: Page,
  pages: SyntheticPage[],
  sourcePage = 1,
) => {
  await page.getByLabel('プロジェクトファイルを選択').setInputFiles({
    name: 'artificial-import.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf(pages),
  })
  const dialog = page.getByRole('dialog', { name: 'PDFページを画像として開く' })
  await expect(dialog.getByRole('img')).toBeVisible()
  await dialog.getByLabel('読込DPI').selectOption('72')
  await dialog.getByLabel('ページ範囲（例: 1, 3-5）').fill(String(sourcePage))
  await dialog.getByRole('button', { name: '選択ページを取り込む' }).click()
  await expect(dialog).toBeHidden()
}

const addBlueLayer = async (page: Page) => {
  await page.getByLabel('画像ファイルを選択').setInputFiles({
    name: 'blue-edit.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(blueSvg),
  })
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false')
}

const openComparison = async (page: Page, mobile = false) => {
  if (mobile) {
    await page.getByRole('button', { name: 'メニュー', exact: true }).click()
    await page
      .getByRole('button', { name: '参照PDFと比較…', exact: true })
      .click()
  } else {
    await page.getByRole('button', { name: '書き出す', exact: true }).click()
    await page
      .getByRole('dialog', { name: '画像を書き出す' })
      .getByRole('button', { name: '参照PDFと比較…', exact: true })
      .click()
  }
  const dialog = page.getByRole('dialog', {
    name: '参照PDFと現在のページを比較',
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('参照PDFを選択')).toBeEnabled()
  return dialog
}

const chooseReference = async (
  dialog: Locator,
  buffer: Buffer,
  name = 'reference.pdf',
) => {
  await dialog.getByLabel('参照PDFを選択').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer,
  })
}

const closeComparison = async (dialog: Locator) => {
  await dialog
    .locator('.modal-actions')
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
  await expect(dialog).toBeHidden()
}

const pixelsFromSource = async (
  page: Page,
  source: string,
  points = [
    [0.5, 0.5],
    [0.03, 0.03],
  ],
) =>
  page.evaluate<{
    width: number
    height: number
    samples: number[][]
  }>(`(async () => {
    const image = new Image()
    image.src = ${JSON.stringify(source)}
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return {
      width: image.width, height: image.height,
      samples: ${JSON.stringify(points)}.map(([x, y]) => [...context.getImageData(
        Math.min(image.width - 1, Math.floor(x * image.width)),
        Math.min(image.height - 1, Math.floor(y * image.height)), 1, 1,
      ).data]),
    }
  })()`)

const pixelsFromImage = async (
  page: Page,
  image: Locator,
  points?: number[][],
) => {
  await expect(image).toBeVisible()
  return pixelsFromSource(page, (await image.getAttribute('src'))!, points)
}

const setOpacity = async (dialog: Locator, value: number) => {
  const slider = dialog.getByRole('slider', { name: /参照ページの不透明度/u })
  await slider.evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      'value',
    )?.set
    if (!setter) throw new Error('Opacity range setter is missing.')
    setter.call(element, next)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, String(value))
  await expect(slider).toHaveValue(String(value))
}

const documentEvidence = async (page: Page) => {
  const saved = await saveProject(page)
  const zoom = await page.locator('.zoom-value').innerText()
  const layers = await page.locator('.layer-row').evaluateAll((rows) =>
    rows.map((row) => ({
      id: row.getAttribute('data-layer-id'),
      selected: row.classList.contains('selected'),
    })),
  )
  await page.getByRole('tab', { name: '履歴', exact: true }).click()
  const history = await page.locator('.history-list li').evaluateAll((items) =>
    items.map((item) => ({
      text: item.textContent,
      current: item.getAttribute('aria-current'),
    })),
  )
  await page.getByRole('tab', { name: 'レイヤー', exact: true }).click()
  return {
    schema: saved.project.schemaVersion,
    pages: saved.project.pages,
    activePageId: saved.project.activePageId,
    metadata: saved.project.metadata,
    zoom,
    layers,
    history,
  }
}

test.describe('Read-only reference PDF comparison', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(globalThis, 'showSaveFilePicker')
    })
    await page.goto('./')
    await expect(
      page.getByRole('region', { name: '画像編集キャンバス' }),
    ).toBeVisible()
  })

  test('an edited PDF produces absolute RGB differences and correct overlay endpoints without changing the document', async ({
    page,
  }) => {
    const requests: { url: string; method: string }[] = []
    page.on('request', (request) => {
      if (/^https?:/u.test(request.url()))
        requests.push({ url: request.url(), method: request.method() })
    })
    await importPdf(page, [redPage])
    await addBlueLayer(page)
    await page.getByRole('button', { name: '拡大', exact: true }).click()
    const before = await documentEvidence(page)
    const reference = makePdf([redPage])
    const dialog = await openComparison(page)
    await chooseReference(dialog, reference)
    await expect(
      dialog.getByText(
        '物理寸法が許容差内で一致しています。重ね合わせと差分を利用できます。',
      ),
    ).toBeVisible()
    expect(
      await pixelsFromImage(
        page,
        dialog.getByRole('img', { name: '現在のページ', exact: true }),
      ),
    ).toEqual({
      width: 300,
      height: 200,
      samples: [
        [0, 0, 255, 255],
        [255, 0, 0, 255],
      ],
    })
    await dialog.getByRole('button', { name: '差分', exact: true }).click()
    expect(
      await pixelsFromImage(
        page,
        dialog.getByRole('img', { name: '現在と参照の画素差分' }),
      ),
    ).toEqual({
      width: 300,
      height: 200,
      samples: [
        [255, 0, 255, 255],
        [0, 0, 0, 255],
      ],
    })
    await dialog
      .getByRole('button', { name: '重ね合わせ', exact: true })
      .click()
    const overlay = dialog.getByRole('img', { name: '現在と参照の重ね合わせ' })
    for (const [opacity, color] of [
      [0, [0, 0, 255, 255]],
      [100, [255, 0, 0, 255]],
    ] as const) {
      await setOpacity(dialog, opacity)
      const screenshot = await overlay.screenshot()
      const actual = await pixelsFromSource(
        page,
        `data:image/png;base64,${screenshot.toString('base64')}`,
        [[0.5, 0.5]],
      )
      expect(actual.samples[0]).toEqual(color)
    }
    await closeComparison(dialog)
    expect(await documentEvidence(page)).toEqual(before)
    const saved = await saveProject(page)
    expect(saved.bytes.toString()).not.toContain(sourceMarker)
    expect(saved.bytes.toString()).not.toContain(reference.toString('base64'))
    expect(
      requests.every(
        ({ url, method }) =>
          new URL(url).origin === new URL(page.url()).origin &&
          method === 'GET',
      ),
    ).toBe(true)
  })

  test('source-page suggestions preserve CropBox, rotation and UserUnit, while mismatched pages disable aligned views', async ({
    page,
  }) => {
    await importPdf(page, [redPage, croppedPage], 2)
    const dialog = await openComparison(page)
    await chooseReference(dialog, makePdf([redPage, croppedPage]))
    await expect(dialog.getByLabel('参照ページ番号')).toHaveValue('2')
    await expect(
      dialog.getByText(/取込時のページ番号を候補にしています/u),
    ).toBeVisible()
    const reference = dialog.getByRole('img', {
      name: '参照PDFのページ',
      exact: true,
    })
    expect(
      await pixelsFromImage(page, reference, [
        [0.5, 0.25],
        [0.5, 0.75],
      ]),
    ).toEqual({
      width: 200,
      height: 400,
      samples: [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
      ],
    })
    await expect(dialog.getByText(/70.56 × 141.11 mm/u)).toHaveCount(2)
    await dialog.getByRole('button', { name: '差分', exact: true }).click()
    const difference = await pixelsFromImage(
      page,
      dialog.getByRole('img', { name: '現在と参照の画素差分' }),
      [
        [0.5, 0.25],
        [0.5, 0.75],
      ],
    )
    expect(difference.samples).toEqual([
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ])
    await dialog
      .getByRole('button', { name: '前のページ', exact: true })
      .click()
    await expect(dialog.getByText(/物理寸法が異なります/u)).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: '横並び', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      dialog.getByRole('button', { name: '重ね合わせ', exact: true }),
    ).toBeDisabled()
    await expect(
      dialog.getByRole('button', { name: '差分', exact: true }),
    ).toBeDisabled()
    await dialog
      .getByRole('button', { name: '次のページ', exact: true })
      .click()
    await expect(
      dialog.getByRole('button', { name: '差分', exact: true }),
    ).toBeEnabled()
    await chooseReference(dialog, makePdf([redPage]), 'one-page-reference.pdf')
    await expect(dialog.getByLabel('参照ページ番号')).toHaveValue('1')
    await expect(
      dialog.getByText(/取込時のページ番号が選んだPDFの範囲外/u),
    ).toBeVisible()
    await closeComparison(dialog)
  })

  test('pixel-only documents remain side by side and both previews stay within 1600 pixels', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '新規', exact: true }).click()
    const create = page.getByRole('dialog', { name: '新しいキャンバス' })
    await create.getByLabel('幅 (px)').fill('3200')
    await create.getByLabel('高さ (px)').fill('200')
    await create.getByRole('button', { name: '作成', exact: true }).click()
    await expect(create).toBeHidden()
    const dialog = await openComparison(page)
    await chooseReference(dialog, makePdf([redPage]))
    await expect(
      dialog.getByText(/現在ページの物理寸法が不明です/u),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: '重ね合わせ', exact: true }),
    ).toBeDisabled()
    await expect(
      dialog.getByRole('button', { name: '差分', exact: true }),
    ).toBeDisabled()
    const current = await pixelsFromImage(
      page,
      dialog.getByRole('img', { name: '現在のページ', exact: true }),
    )
    const reference = await pixelsFromImage(
      page,
      dialog.getByRole('img', { name: '参照PDFのページ', exact: true }),
    )
    expect([current.width, current.height]).toEqual([1600, 100])
    expect(Math.max(reference.width, reference.height)).toBe(1600)
    await closeComparison(dialog)
  })

  test('invalid references, reselection and closing a pending read preserve saved state, history, zoom and selection', async ({
    page,
  }) => {
    await importPdf(page, [redPage])
    await addBlueLayer(page)
    const before = await documentEvidence(page)
    let dialog = await openComparison(page)
    await chooseReference(dialog, makePdf([redPage]))
    await expect(
      dialog.getByRole('button', { name: '差分', exact: true }),
    ).toBeEnabled()
    await chooseReference(
      dialog,
      Buffer.from('%PDF-1.7\ninvalid'),
      'invalid-reference.pdf',
    )
    await expect(dialog.getByRole('alert')).toContainText(
      'PDFを解析できませんでした',
    )
    await expect(
      dialog.getByRole('img', { name: '参照PDFのページ', exact: true }),
    ).toHaveCount(0)
    await expect(
      dialog.getByRole('button', { name: '差分', exact: true }),
    ).toBeDisabled()
    await chooseReference(dialog, makePdf([redPage]), 'recovered-reference.pdf')
    await expect(
      dialog.getByRole('button', { name: '差分', exact: true }),
    ).toBeEnabled()
    await page.keyboard.press('Control+d')
    await page.keyboard.press('Delete')
    await page.evaluate(`(() => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('image/svg+xml', ${JSON.stringify(blueSvg)})
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File([${JSON.stringify(blueSvg)}], 'blocked-drop.svg', { type: 'image/svg+xml' }))
      document.querySelector('.app-shell').dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
    })()`)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await documentEvidence(page)).toEqual(before)

    await page.evaluate(`(() => {
      const original = File.prototype.arrayBuffer
      globalThis.pendingReferenceReads = 0
      File.prototype.arrayBuffer = function () {
        if (this.name !== 'slow-reference.pdf') return original.call(this)
        globalThis.pendingReferenceReads++
        return new Promise((resolve) => setTimeout(resolve, 350))
          .then(() => original.call(this))
          .finally(() => { globalThis.pendingReferenceReads-- })
      }
    })()`)
    dialog = await openComparison(page)
    await chooseReference(dialog, makePdf([redPage]), 'slow-reference.pdf')
    await expect
      .poll(() => page.evaluate('globalThis.pendingReferenceReads'))
      .toBe(1)
    await closeComparison(dialog)
    await expect
      .poll(() => page.evaluate('globalThis.pendingReferenceReads'))
      .toBe(0)
    dialog = await openComparison(page)
    await expect(
      dialog.getByText('比較する参照PDFを選択してください。'),
    ).toBeVisible()
    await expect(
      dialog.getByRole('img', { name: '参照PDFのページ', exact: true }),
    ).toHaveCount(0)
    await closeComparison(dialog)
    expect(await documentEvidence(page)).toEqual(before)
  })

  test('the file-menu comparison fits a 390-pixel viewport and its modes, opacity and close action remain accessible', async ({
    page,
  }, testInfo) => {
    await importPdf(page, [redPage])
    await page.setViewportSize({ width: 390, height: 844 })
    const dialog = await openComparison(page, true)
    await chooseReference(dialog, makePdf([redPage]), 'mobile-reference.pdf')
    await expect(
      dialog.getByRole('button', { name: '差分', exact: true }),
    ).toBeEnabled()
    await dialog.getByRole('button', { name: '差分', exact: true }).click()
    await expect(
      dialog.getByRole('img', { name: '現在と参照の画素差分' }),
    ).toBeVisible()
    await dialog
      .getByRole('button', { name: '重ね合わせ', exact: true })
      .click()
    const slider = dialog.getByRole('slider', { name: /参照ページの不透明度/u })
    await slider.press('Home')
    await expect(slider).toHaveValue('0')
    await slider.press('End')
    await expect(slider).toHaveValue('100')
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true)
    const audit = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze()
    expect(
      audit.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical',
      ),
    ).toEqual([])
    const close = dialog
      .locator('.modal-actions')
      .getByRole('button', { name: '閉じる', exact: true })
    await close.scrollIntoViewIfNeeded()
    const bounds = await close.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
    await page.screenshot({
      path: testInfo.outputPath('pdf-comparison-mobile.png'),
    })
    await closeComparison(dialog)
  })
})
