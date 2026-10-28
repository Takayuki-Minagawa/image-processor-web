import { expect, test, type Download, type Page } from '@playwright/test'
import type { ProjectDocument } from '../src/editor/types'

interface SyntheticPage {
  box: string
  content: string
  resources?: string
  annotationAppearance?: boolean
}

/** Entirely artificial fixtures: no source PDF, fonts or remote assets. */
const makePdf = (pages: SyntheticPage[], encrypted = false): Buffer => {
  let nextExtraObject = 3 + pages.length * 2
  const annotationIds = pages.map((page) => {
    if (!page.annotationAppearance) return undefined
    const id = nextExtraObject
    nextExtraObject += 2
    return id
  })
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages
      .map((_, index) => `${3 + index * 2} 0 R`)
      .join(' ')}] >>`,
  ]
  for (const [index, page] of pages.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R ${page.box} /Resources << ${page.resources ?? ''} >> /Contents ${4 + index * 2} 0 R${annotationIds[index] ? ` /Annots [${annotationIds[index]} 0 R]` : ''} >>`,
      `<< /Length ${Buffer.byteLength(page.content)} >>\nstream\n${page.content}\nendstream`,
    )
  }
  for (const annotationId of annotationIds) {
    if (annotationId === undefined) continue
    const appearance = '0 1 0 rg 0 0 20 20 re f'
    objects.push(
      `<< /Type /Annot /Subtype /Square /Rect [80 10 100 30] /F 4 /AP << /N ${annotationId + 1} 0 R >> >>`,
      `<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >> /Length ${appearance.length} >>\nstream\n${appearance}\nendstream`,
    )
  }
  if (encrypted) {
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`,
    )
  }
  let source = '%PDF-1.7\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const startXref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${
    encrypted
      ? ` /Encrypt ${objects.length} 0 R /ID [<0011223344556677><0011223344556677>]`
      : ''
  } >>\nstartxref\n${startXref}\n%%EOF\n`
  return Buffer.from(source)
}

const simplePage: SyntheticPage = {
  box: '/MediaBox [0 0 120 80]',
  content:
    '1 0 0 rg 0 0 120 80 re f 0 0 0 RG 0.5 w 10 10 m 110 70 l S q 10 10 30 20 re W n /GS1 gs 0 0 1 rg 0 0 60 40 re f Q',
  resources: '/ExtGState << /GS1 << /Type /ExtGState /ca 0.5 >> >>',
  annotationAppearance: true,
}
const croppedPage: SyntheticPage = {
  box: '/MediaBox [0 0 400 300] /CropBox [40 30 240 130] /Rotate 90 /UserUnit 2',
  content:
    '1 0 0 rg 40 30 100 100 re f 0 0 1 rg 140 30 100 100 re f 0 1 0 rg 0 0 20 20 re f',
}

const downloadBytes = async (download: Download): Promise<Buffer> => {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Download stream is missing.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const inspectPixels = async (page: Page, source: string, points: number[][]) =>
  page.evaluate<{ hash: string; samples: number[][] }>(`(async () => {
    const image = new Image()
    image.src = ${JSON.stringify(source)}
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const bytes = context.getImageData(0, 0, image.width, image.height).data
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return {
      hash: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join(''),
      samples: ${JSON.stringify(points)}.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)),
    }
  })()`)

const imageSource = (project: ProjectDocument, index: number) =>
  (project.pages[index].fabricCanvas.objects as { src: string }[])[0].src

const comparePixels = (page: Page, a: string, b: string) =>
  page.evaluate(`(async () => {
  const pixels = await Promise.all(${JSON.stringify(['SOURCE_A', 'SOURCE_B'])}.map(async (key) => {
    const image = new Image()
    image.src = key === 'SOURCE_A' ? ${JSON.stringify(a)} : ${JSON.stringify(b)}
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data }
  }))
  let differences = 0, maximum = 0, sum = 0
  const first = []
  for (let i = 0; i < pixels[0].data.length; i++) {
    const difference = Math.abs(pixels[0].data[i] - pixels[1].data[i])
    if (difference) {
      if (first.length < 12) first.push([Math.floor(i / 4) % pixels[0].width, Math.floor(i / 4 / pixels[0].width), i % 4, pixels[0].data[i], pixels[1].data[i]])
      differences++
      maximum = Math.max(maximum, difference)
      sum += difference
    }
  }
  return { dimensions: pixels.map(({width,height}) => [width,height]), differences, maximum, sum, first }
})()`)

const saveProject = async (page: Page) => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const file = await download
  const bytes = await downloadBytes(file)
  return { bytes, project: JSON.parse(bytes.toString()) as ProjectDocument }
}

const choosePdf = async (
  page: Page,
  buffer: Buffer,
  input: 'image' | 'project' = 'image',
) => {
  await page
    .getByLabel(
      input === 'project' ? 'プロジェクトファイルを選択' : '画像ファイルを選択',
    )
    .setInputFiles({
      name: 'artificial-test.pdf',
      mimeType: 'application/pdf',
      buffer,
    })
  const dialog = page.getByRole('dialog', { name: 'PDFページを画像として開く' })
  await expect(dialog).toBeVisible()
  return dialog
}

const importPdf = async (
  page: Page,
  pages: SyntheticPage[],
  append = false,
) => {
  const dialog = await choosePdf(page, makePdf(pages), 'project')
  await expect(dialog.getByRole('img')).toBeVisible()
  await dialog.getByLabel('読込DPI').selectOption('72')
  await dialog.getByLabel('ページ範囲（例: 1, 3-5）').fill(`1-${pages.length}`)
  if (append) await dialog.getByLabel('取込先').selectOption('append')
  if (pages.length > 1) {
    await dialog.getByRole('img').scrollIntoViewIfNeeded()
    const screenshotPath = test.info().outputPath('pdf-import-dialog.png')
    await dialog.screenshot({ path: screenshotPath })
    await test.info().attach('pdf-import-dialog', {
      path: screenshotPath,
      contentType: 'image/png',
    })
  }
  await dialog.getByRole('button', { name: '選択ページを取り込む' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByText('PDFページをロック済み背景画像として取り込みました。'),
  ).toBeVisible()
}

const openStudio = async (page: Page, tab: 'ページ' | '出力') => {
  await page.getByRole('button', { name: 'Studio' }).click()
  const dialog = page.getByRole('dialog', { name: '拡張ツール' })
  const panel = dialog.getByRole('tabpanel', { name: 'デザイン' })
  await panel
    .getByRole('navigation', { name: 'デザイン機能' })
    .getByRole('button', { name: tab, exact: true })
    .click()
  return { dialog, panel }
}

test.describe('PDF background import and lossless export', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(globalThis, 'showSaveFilePicker')
    })
    await page.goto('./')
    await expect(
      page.getByRole('region', { name: '画像編集キャンバス' }),
    ).toBeVisible()
  })

  test('mixed CropBox/rotation/UserUnit pages retain pixels, physical size and metadata through save and export', async ({
    page,
  }) => {
    const requests: { method: string; url: string }[] = []
    page.on('request', (request) => {
      if (/^https?:/u.test(request.url()))
        requests.push({ method: request.method(), url: request.url() })
    })
    await importPdf(page, [simplePage, croppedPage])
    await expect(
      page.getByRole('button', { name: 'レイヤー「PDF 1」のロックを解除' }),
    ).toBeVisible()
    const saved = await saveProject(page)
    expect(saved.project.schemaVersion).toBe(4)
    expect(saved.project.pages).toHaveLength(2)
    expect(saved.project.pages.map(({ canvasSize }) => canvasSize)).toEqual([
      { width: 120, height: 80 },
      { width: 200, height: 400 },
    ])
    for (const [index, original] of saved.project.pages.entries()) {
      const expected = index === 0 ? [120, 80] : [200, 400]
      expect(original.physicalSize?.widthMm).toBeCloseTo(
        (expected[0] * 25.4) / 72,
        6,
      )
      expect(original.physicalSize?.heightMm).toBeCloseTo(
        (expected[1] * 25.4) / 72,
        6,
      )
      expect(original.editorState.pdfImport).toMatchObject({
        kind: 'rasterized-pdf',
        pageNumber: index + 1,
        rotation: index === 0 ? 0 : 90,
        dpi: 72,
      })
      const objects = original.fabricCanvas.objects as {
        src: string
        editorLocked: boolean
      }[]
      expect(objects).toHaveLength(1)
      expect(objects[0].editorLocked).toBe(true)
      expect(objects[0].src).toMatch(/^data:image\/png;base64,/u)
    }
    expect(saved.project.metadata).not.toHaveProperty('sourceFileName')
    const appearance = await inspectPixels(
      page,
      imageSource(saved.project, 0),
      [
        [20, 60],
        [90, 60],
        [5, 60],
      ],
    )
    expect(appearance.samples).toEqual([
      [127, 0, 128, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 255],
    ])
    const cropped = await inspectPixels(page, imageSource(saved.project, 1), [
      [100, 100],
      [100, 300],
    ])
    expect(cropped.samples).toEqual([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ])

    await page.getByRole('button', { name: '矩形を追加' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByLabel('プロジェクトファイルを選択').setInputFiles({
      name: 'roundtrip.pwx.json',
      mimeType: 'application/json',
      buffer: saved.bytes,
    })
    await expect(
      page.getByText('プロジェクトを開きました。', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '書き出す', exact: true }).click()
    await page
      .getByRole('button', { name: 'PDF 画像として出力…', exact: true })
      .click()
    const studioDialog = page.getByRole('dialog', { name: '拡張ツール' })
    const panel = studioDialog.getByRole('tabpanel', { name: 'デザイン' })
    await panel.getByRole('button', { name: 'PDF（画像として出力）' }).click()
    await panel.getByLabel('ページ範囲').selectOption('all')
    await panel.getByLabel('DPI', { exact: true }).fill('72')
    await panel.getByLabel('画像の圧縮').selectOption('lossless')
    await expect(panel.getByText('出力ページ数: 2')).toBeVisible()
    const download = page.waitForEvent('download')
    await panel.getByRole('button', { name: '書き出す', exact: true }).click()
    const outputBytes = await downloadBytes(await download)
    const output = outputBytes.toString('latin1')
    expect(output).toMatch(/^%PDF-/u)
    expect(output.match(/\/Subtype \/Image/gu) ?? []).toHaveLength(2)
    expect(output.match(/\/Filter \/FlateDecode/gu) ?? []).toHaveLength(2)
    expect(output).not.toContain('/DCTDecode')
    const boxes = [...output.matchAll(/\/TrimBox\s*\[([^\]]+)\]/gu)].map(
      (match) => match[1].trim().split(/\s+/u).map(Number),
    )
    expect(boxes).toHaveLength(2)
    for (const [index, box] of boxes.entries()) {
      expect(box[2] - box[0]).toBeCloseTo(index === 0 ? 120 : 200, 2)
      expect(box[3] - box[1]).toBeCloseTo(index === 0 ? 80 : 400, 2)
    }
    await studioDialog.getByRole('button', { name: '閉じる' }).click()
    const resultDialog = await choosePdf(page, outputBytes)
    await resultDialog.getByLabel('読込DPI').selectOption('72')
    await resultDialog.getByLabel('ページ範囲（例: 1, 3-5）').fill('1-2')
    await resultDialog
      .getByRole('button', { name: '選択ページを取り込む' })
      .click()
    await expect(resultDialog).toBeHidden()
    const reimported = await saveProject(page)
    const difference = await comparePixels(
      page,
      imageSource(saved.project, 0),
      imageSource(reimported.project, 0),
    )
    expect(difference, JSON.stringify(difference)).toMatchObject({
      differences: 0,
    })
    expect(
      (await inspectPixels(page, imageSource(reimported.project, 0), [])).hash,
    ).toBe(appearance.hash)
    expect(
      (await inspectPixels(page, imageSource(reimported.project, 1), [])).hash,
    ).toBe(cropped.hash)
    const origin = new URL(page.url()).origin
    expect(requests.length).toBeGreaterThan(0)
    expect(
      requests.every(
        ({ method, url }) => method === 'GET' && new URL(url).origin === origin,
      ),
    ).toBe(true)
  })

  test('appending a PDF is one undoable document operation and retains the original page', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '矩形を追加' }).click()
    await page.waitForTimeout(450)
    await importPdf(page, [simplePage], true)
    let studio = await openStudio(page, 'ページ')
    await expect(
      studio.panel.locator('.design-page-strip').getByRole('listitem'),
    ).toHaveCount(2)
    await studio.dialog.getByRole('button', { name: '閉じる' }).click()
    await page.getByRole('button', { name: '元に戻す', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'レイヤー「Rectangle」を選択' }),
    ).toBeVisible()
    studio = await openStudio(page, 'ページ')
    await expect(
      studio.panel.locator('.design-page-strip').getByRole('listitem'),
    ).toHaveCount(1)
    await studio.dialog.getByRole('button', { name: '閉じる' }).click()
    await page.getByRole('button', { name: 'やり直す', exact: true }).click()
    const saved = await saveProject(page)
    expect(saved.project.pages).toHaveLength(2)
    expect(saved.project.pages[0].fabricCanvas.objects).toEqual([
      expect.objectContaining({ type: 'Rect' }),
    ])
    expect(saved.project.pages[1].editorState.pdfImport?.pageNumber).toBe(1)
  })

  test('invalid, password-protected and oversized inputs preserve the document; warmed PDF import works offline', async ({
    page,
    context,
  }) => {
    await page.getByRole('button', { name: '矩形を追加' }).click()
    await page.waitForTimeout(450)
    const before = await saveProject(page)
    let dialog = await choosePdf(page, Buffer.from('%PDF-1.7\nnot a PDF'))
    await expect(dialog.getByRole('alert')).toContainText(
      'PDFを解析できませんでした',
    )
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    dialog = await choosePdf(page, makePdf([simplePage], true))
    await expect(dialog.getByRole('alert')).toContainText(
      'パスワード付きPDFには対応していません',
    )
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    dialog = await choosePdf(
      page,
      makePdf([{ box: '/MediaBox [0 0 10000 10000]', content: '' }]),
    )
    await expect(dialog.getByRole('alert')).toContainText(
      'ページの寸法・画素数が上限を超えます',
    )
    await expect(
      dialog.getByRole('button', { name: '選択ページを取り込む' }),
    ).toBeDisabled()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    dialog = await choosePdf(page, makePdf([simplePage]))
    await expect(dialog.getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    const after = await saveProject(page)
    expect(after.project.pages).toEqual(before.project.pages)
    expect(after.project.activePageId).toBe(before.project.activePageId)
    expect(after.project.metadata).toEqual(before.project.metadata)
    // Warm the complete lazy pipeline before separating document processing
    // from the initial application/runtime downloads.
    await importPdf(page, [simplePage], true)
    const warmed = await saveProject(page)
    await page.evaluate('navigator.serviceWorker.ready.then(() => undefined)')
    await expect
      .poll(() => page.evaluate('navigator.serviceWorker.controller?.state'))
      .toBe('activated')
    const failures: string[] = []
    page.on('requestfailed', (request) =>
      failures.push(`${request.url()}: ${request.failure()?.errorText}`),
    )
    await context.setOffline(true)
    try {
      await importPdf(page, [simplePage], true)
    } catch (error) {
      throw new Error(
        `Offline import failed. Network failures: ${failures.join(' | ')}`,
        { cause: error },
      )
    }
    const offline = await saveProject(page)
    expect(offline.project.pages).toHaveLength(3)
    expect(offline.project.pages.slice(0, 2)).toEqual(warmed.project.pages)
    expect(offline.project.pages[2].editorState.pdfImport?.pageNumber).toBe(1)
  })
})
