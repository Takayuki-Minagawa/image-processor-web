import { expect, test, type Download, type Page } from '@playwright/test'
import type { ProjectDocument } from '../src/editor/types'

// Artificial SVGs keep the coordinate and unit expectations independently
// readable; no external files, fonts, raster images, or network resources.
const physicalSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="25.4mm" height="50.8mm" viewBox="-10 -20 96 192">
  <style>g { opacity: 0.5; fill: #000000; }</style>
  <rect x="0" y="0" width="20" height="30" fill="#ff0000"/>
  <rect x="50" y="100" width="10" height="20" fill="#0000ff"/>
</svg>`
const pixelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="320px" height="180px" viewBox="0 0 320 180">
  <rect x="40" y="30" width="80" height="60" fill="#00aa00"/>
</svg>`
const materialSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">
  <rect width="1000" height="1000" fill="#ff0000" stroke-width="0"/>
</svg>`

const downloadBytes = async (download: Download): Promise<Buffer> => {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Download stream is missing.')
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(Buffer.from(part))
  return Buffer.concat(parts)
}

const saveProject = async (page: Page) => {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const bytes = await downloadBytes(await downloaded)
  return { bytes, project: JSON.parse(bytes.toString()) as ProjectDocument }
}

const chooseSvg = async (page: Page, source: string) => {
  await page.locator('input[type="file"][accept*=".pwx.json"]').setInputFiles({
    name: 'artificial-original.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(source),
  })
  const dialog = page.getByRole('dialog', { name: 'SVGの原寸で開く' })
  await expect(dialog).toBeVisible()
  return dialog
}

const importSvg = async (page: Page, source: string, append = false) => {
  const dialog = await chooseSvg(page, source)
  if (append) await dialog.getByLabel('取込先').selectOption('append')
  await dialog.getByRole('button', { name: 'SVGを取り込む' }).click()
  await expect(dialog).toBeHidden()
}

interface SerializedObject {
  type: string
  editorKind?: string
  left?: number
  top?: number
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  objects?: SerializedObject[]
}

const objectsOnPage = (project: ProjectDocument, index = 0) =>
  project.pages[index].fabricCanvas.objects as unknown as SerializedObject[]

const flattenObjects = (objects: SerializedObject[]): SerializedObject[] =>
  objects.flatMap((object) => [object, ...flattenObjects(object.objects ?? [])])

const exportPixels = async (page: Page) => {
  await page.getByRole('button', { name: '書き出す', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '画像を書き出す' })
  await dialog.getByRole('radio', { name: /^PNG/u }).check()
  await dialog.getByLabel('出力倍率').selectOption('1')
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  const png = await downloadBytes(await downloaded)
  return page.evaluate<{ width: number; height: number; samples: number[][] }>(
    `(async () => {
      const image = new Image()
      image.src = ${JSON.stringify(`data:image/png;base64,${png.toString('base64')}`)}
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const samples = [
        [5, 5],
        [15, 25],
        [65, 125],
        [35, 55],
      ].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
      return { width: image.width, height: image.height, samples }
    })()`,
  )
}

test.describe('SVG pages at their original dimensions', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(globalThis, 'showSaveFilePicker')
    })
    await page.goto('./')
    await expect(
      page.getByRole('region', { name: '画像編集キャンバス' }),
    ).toBeVisible()
  })

  test('physical SVG keeps 96-dpi dimensions, vector shapes and negative-viewBox margins through project reload', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '矩形を追加' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await importSvg(page, physicalSvg)
    await expect(
      page.getByRole('button', { name: '元に戻す', exact: true }),
    ).toBeDisabled()
    const saved = await saveProject(page)
    expect(saved.project.pages).toHaveLength(1)
    expect(saved.project.pages[0].canvasSize).toEqual({
      width: 96,
      height: 192,
    })
    expect(saved.project.pages[0].physicalSize).toMatchObject({
      unit: 'mm',
      sourceDpi: 96,
    })
    expect(saved.project.pages[0].physicalSize?.widthMm).toBeCloseTo(25.4, 6)
    expect(saved.project.pages[0].physicalSize?.heightMm).toBeCloseTo(50.8, 6)
    expect(saved.project.pages[0].editorState).not.toHaveProperty('pdfImport')
    const vectors = flattenObjects(objectsOnPage(saved.project))
    expect(
      vectors.filter(({ type }) => type.toLowerCase() === 'rect'),
    ).toHaveLength(2)
    expect(vectors.some(({ type }) => type.toLowerCase() === 'image')).toBe(
      false,
    )
    const pixels = await exportPixels(page)
    expect(pixels).toEqual({
      width: 96,
      height: 192,
      samples: [
        [0, 0, 0, 0],
        [255, 0, 0, 255],
        [0, 0, 255, 255],
        [0, 0, 0, 0],
      ],
    })

    await page.getByRole('button', { name: '矩形を追加' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page
      .locator('input[type="file"][accept*=".pwx.json"]')
      .setInputFiles({
        name: 'native-size-roundtrip.pwx.json',
        mimeType: 'application/json',
        buffer: saved.bytes,
      })
    await expect(
      page.getByText('プロジェクトを開きました。', { exact: true }),
    ).toBeVisible()
    const reopened = await saveProject(page)
    expect(reopened.project.pages).toEqual(saved.project.pages)
    expect(await exportPixels(page)).toEqual(pixels)
  })

  test('appending a pixel SVG preserves the existing page and is one undoable operation', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '矩形を追加' }).click()
    const original = await saveProject(page)
    await importSvg(page, pixelSvg, true)
    const appended = await saveProject(page)
    expect(appended.project.pages).toHaveLength(2)
    expect(appended.project.pages[0]).toEqual(original.project.pages[0])
    expect(appended.project.pages[1].canvasSize).toEqual({
      width: 320,
      height: 180,
    })
    expect(appended.project.pages[1]).not.toHaveProperty('physicalSize')
    expect(
      flattenObjects(objectsOnPage(appended.project, 1)).some(
        ({ type }) => type.toLowerCase() === 'image',
      ),
    ).toBe(false)

    await page.getByRole('button', { name: '元に戻す', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'レイヤー「Rectangle」を選択' }),
    ).toBeVisible()
    const undone = await saveProject(page)
    expect(undone.project.pages).toEqual(original.project.pages)
    expect(undone.project.activePageId).toBe(original.project.activePageId)
    await page.getByRole('button', { name: 'やり直す', exact: true }).click()
    const redone = await saveProject(page)
    expect(redone.project.pages).toEqual(appended.project.pages)
    expect(redone.project.activePageId).toBe(appended.project.activePageId)
  })

  test('inferred viewBox and one-sided dimensions require explicit confirmation', async ({
    page,
  }) => {
    for (const [attributes, expected] of [
      ['viewBox="-10 -20 200 100"', { width: 200, height: 100 }],
      ['width="400px" viewBox="0 0 200 100"', { width: 400, height: 200 }],
    ] as const) {
      const dialog = await chooseSvg(
        page,
        `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="20" height="10" fill="red"/></svg>`,
      )
      const confirmed = dialog.getByLabel(
        '推定サイズで取り込むことを確認しました',
      )
      await expect(confirmed).toBeVisible()
      const submit = dialog.getByRole('button', { name: 'SVGを取り込む' })
      await expect(submit).toBeDisabled()
      await confirmed.check()
      await expect(submit).toBeEnabled()
      await submit.click()
      await expect(dialog).toBeHidden()
      const saved = await saveProject(page)
      expect(saved.project.pages[0].canvasSize).toEqual(expected)
      expect(saved.project.pages[0]).not.toHaveProperty('physicalSize')
    }
  })

  test('invalid, oversized, cancelled and declined replacement inputs preserve the current document', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '矩形を追加' }).click()
    await page.getByRole('button', { name: '拡大', exact: true }).click()
    const zoomBefore = await page.locator('.zoom-value').innerText()
    const original = await saveProject(page)
    for (const source of [
      '<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="20"><rect width="10" height="10"/></svg>',
    ]) {
      const dialog = await chooseSvg(page, source)
      await expect(dialog.getByRole('alert')).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'SVGを取り込む' }),
      ).toBeDisabled()
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
    }
    const cancelled = await chooseSvg(page, pixelSvg)
    await expect(
      cancelled.getByRole('button', { name: 'SVGを取り込む' }),
    ).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(cancelled).toBeHidden()
    expect(await page.locator('.zoom-value').innerText()).toBe(zoomBefore)
    const unchanged = await saveProject(page)
    expect(unchanged.project.pages).toEqual(original.project.pages)
    expect(unchanged.project.activePageId).toBe(original.project.activePageId)
    expect(unchanged.project.metadata).toEqual(original.project.metadata)

    await page.getByRole('button', { name: '矩形を追加' }).click()
    page.once('dialog', (dialog) => dialog.dismiss())
    const declined = await chooseSvg(page, pixelSvg)
    await declined.getByRole('button', { name: 'SVGを取り込む' }).click()
    await expect(declined).toBeVisible()
    await declined.getByRole('button', { name: '取消', exact: true }).click()
    const retained = await saveProject(page)
    expect(retained.project.pages).toHaveLength(1)
    expect(objectsOnPage(retained.project)).toHaveLength(2)
    expect(retained.project.pages[0].canvasSize).toEqual(
      original.project.pages[0].canvasSize,
    )
  })

  test('image addition, external drop and paste retain SVG asset placement on the current canvas', async ({
    page,
  }) => {
    await page.getByLabel('画像ファイルを選択').setInputFiles({
      name: 'material.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(materialSvg),
    })
    const rows = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    await expect(rows).toHaveCount(1)
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'aria-busy',
      'false',
    )
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const transfer = await page.evaluateHandle(`(() => {
      const data = new DataTransfer()
      data.items.add(
        new File([${JSON.stringify(materialSvg)}], 'dropped-material.svg', { type: 'image/svg+xml' }),
      )
      return data
    })()`)
    try {
      await page
        .locator('.app-shell')
        .dispatchEvent('drop', { dataTransfer: transfer })
    } finally {
      await transfer.dispose()
    }
    await expect(rows).toHaveCount(2)
    // Synthetic clipboard dispatch bypasses browser inert handling. Wait for
    // the preceding import's finally/endBusy, as a real user would have to.
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'aria-busy',
      'false',
    )
    await page.evaluate(`(() => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('image/svg+xml', ${JSON.stringify(materialSvg)})
      document.body.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      )
    })()`)
    await expect(rows).toHaveCount(3)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const saved = await saveProject(page)
    expect(saved.project.pages).toHaveLength(1)
    expect(saved.project.pages[0].canvasSize).toEqual({
      width: 1280,
      height: 720,
    })
    expect(saved.project.pages[0]).not.toHaveProperty('physicalSize')
    for (const object of objectsOnPage(saved.project)) {
      expect(object.editorKind).toBe('svg')
      expect(object.scaleX).toBeLessThan(1)
      expect(object.scaleY).toBeLessThan(1)
      expect(object.left).toBeGreaterThan(0)
      expect(object.top).toBeGreaterThan(0)
      expect((object.height ?? 0) * (object.scaleY ?? 0)).toBeCloseTo(
        720 * 0.82,
        0,
      )
    }
  })
})
