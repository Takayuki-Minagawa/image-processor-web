import { expect, test, type Page } from '@playwright/test'

test.use({
  launchOptions: {
    args: ['--disable-webgl', '--disable-gpu'],
  },
})

async function openEditor(page: Page): Promise<void> {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const response = await page.goto('./')
  expect(response?.status()).toBe(200)
  try {
    await expect(
      page.getByRole('region', { name: '画像編集キャンバス' }),
    ).toBeVisible()
  } catch (error) {
    throw new Error(
      `Editor did not render at ${page.url()}. Page errors: ${pageErrors.join(' | ') || 'none'}.`,
      { cause: error },
    )
  }
}

test('WebGLを無効にしても詳細フィルターをレイヤー追加しUndoできる', async ({
  page,
}) => {
  await openEditor(page)

  const webGlState = await page.evaluate<{
    webgl: boolean
    webgl2: boolean
  }>(`(() => {
    const canvas = document.createElement('canvas')
    return {
      webgl: canvas.getContext('webgl') !== null,
      webgl2: canvas.getContext('webgl2') !== null,
    }
  })()`)
  expect(webGlState).toEqual({ webgl: false, webgl2: false })

  await page.getByLabel('描画色').fill('#f97316')
  await page.getByRole('button', { name: '矩形を追加' }).click()
  await expect(
    page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
      .filter({ hasText: 'Rectangle' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Studio' }).click()
  const dialog = page.getByRole('dialog', { name: '拡張ツール' })
  await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
  const filterPanel = dialog.getByRole('region', {
    name: '詳細フィルター',
  })
  await filterPanel
    .getByRole('checkbox', { name: 'レベル補正を有効化' })
    .check()
  await filterPanel.getByLabel('入力ブラック').fill('16')
  await filterPanel
    .getByRole('button', { name: '詳細フィルターを適用' })
    .click()
  await expect(
    filterPanel.getByText('詳細フィルターを適用しました。', {
      exact: true,
    }),
  ).toBeVisible()

  const layerItems = page
    .getByRole('list', { name: 'レイヤー' })
    .getByRole('listitem')
  await expect(layerItems).toHaveCount(2)
  await expect(layerItems.filter({ hasText: 'Advanced filters' })).toHaveCount(
    1,
  )

  await dialog.getByRole('button', { name: '閉じる' }).click()
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(layerItems).toHaveCount(1)
  await expect(layerItems.filter({ hasText: 'Advanced filters' })).toHaveCount(
    0,
  )
})
