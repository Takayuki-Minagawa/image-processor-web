import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'

async function openExport(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: '矩形を追加' }).click()
  await page.getByRole('button', { name: '書き出す', exact: true }).click()
  return page.getByRole('dialog', { name: '画像を書き出す' })
}

test('PNG Blob download has the requested dimensions and encoded signature', async ({
  page,
}) => {
  const dialog = await openExport(page)
  await dialog.getByLabel('出力倍率').selectOption('0.5')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.png$/)
  const bytes = await readFile((await file.path())!)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.readUInt32BE(16)).toBe(640)
  expect(bytes.readUInt32BE(20)).toBe(360)
  await expect(dialog).toBeHidden()
})

test('copies a rendered PNG into the native clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const dialog = await openExport(page)
  await dialog.getByLabel('出力倍率').selectOption('0.5')
  await dialog.getByRole('button', { name: 'PNGをコピー' }).click()
  await expect(
    dialog.getByText('PNGをコピーしました。他のアプリに貼り付けできます。', {
      exact: true,
    }),
  ).toBeVisible()
  const image = await page.evaluate(`(async () => {
    const [item] = await navigator.clipboard.read()
    const blob = await item.getType('image/png')
    const bitmap = await createImageBitmap(blob)
    const result = {
      type: blob.type,
      width: bitmap.width,
      height: bitmap.height,
    }
    bitmap.close()
    return result
  })()`)
  expect(image).toEqual({ type: 'image/png', width: 640, height: 360 })
  await expect(dialog).toBeVisible()
})

test('permission denial stays visible and download remains usable', async ({
  page,
}) => {
  await page.addInitScript(`(() => {
    Object.defineProperty(navigator.clipboard, 'write', {
      value: () =>
        Promise.reject(new DOMException('denied', 'NotAllowedError')),
    })
  })()`)
  const dialog = await openExport(page)
  await dialog.getByRole('button', { name: 'PNGをコピー' }).click()
  await expect(dialog.getByRole('alert')).toContainText(
    '画像のコピーが許可されませんでした',
  )
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.png$/)
})

test('unsupported WebP never downloads PNG under a WebP extension', async ({
  page,
}) => {
  await page.addInitScript(`(() => {
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      encode.call(
        this,
        callback,
        type === 'image/webp' ? 'image/png' : type,
        quality,
      )
    }
  })()`)
  const downloads: string[] = []
  page.on('download', (download) =>
    downloads.push(download.suggestedFilename()),
  )
  const dialog = await openExport(page)
  await dialog.getByRole('radio', { name: /^WEBP/ }).check()
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  await expect(dialog.getByRole('alert')).toContainText(
    'PNGで再試行してください',
  )
  expect(downloads).toEqual([])
  await dialog.getByRole('radio', { name: /^PNG/ }).check()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.png$/)
})

test('English export controls fit a phone viewport and retain accessible names', async ({
  page,
}) => {
  await page.addInitScript(`(() => {
    Object.defineProperty(window, 'ClipboardItem', { value: undefined })
  })()`)
  await page.goto('./')
  await page.getByRole('button', { name: '英語表示に切り替え' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('button', { name: 'Export image', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export image' })
  await expect(dialog.getByRole('button', { name: 'Copy PNG' })).toBeDisabled()
  await expect(dialog.getByText(/Image copying is unavailable/)).toBeVisible()
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true)
  const result = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze()
  expect(
    result.violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    ),
  ).toEqual([])
  await dialog.screenshot({ path: 'test-results/export-phone.png' })
  await dialog.getByRole('radio', { name: /^SVG/ }).check()
  await dialog.getByLabel('SVG area').selectOption('selection')
  await dialog.getByRole('button', { name: 'Download' }).click()
  await expect(dialog.getByRole('alert')).toHaveText(
    'Select an object to export as SVG.',
  )
})
