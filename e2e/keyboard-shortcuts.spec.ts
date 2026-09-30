import { expect, test, type Locator, type Page } from '@playwright/test'

const layerRows = (page: Page) =>
  page.getByRole('list', { name: 'レイヤー' }).getByRole('listitem')

async function openWithRectangle(page: Page): Promise<void> {
  await page.goto('./')
  await page.getByRole('button', { name: '矩形を追加' }).click()
  await expect(layerRows(page)).toHaveCount(1)
}

async function pasteSvg(target: Locator): Promise<boolean> {
  const event = await target.page().evaluateHandle(`(() => {
    const clipboardData = new DataTransfer()
    clipboardData.setData(
      'image/svg+xml',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
    )
    return new ClipboardEvent('paste', {
      clipboardData,
      bubbles: true,
      cancelable: true,
    })
  })()`)
  try {
    return await target.evaluate(
      (element, pasteEvent) => element.dispatchEvent(pasteEvent),
      event,
    )
  } finally {
    await event.dispose()
  }
}

test('矢印移動・複製・全選択を履歴と組み合わせて使用できる', async ({
  page,
}) => {
  await openWithRectangle(page)
  const x = page.getByRole('spinbutton', { name: 'X', exact: true })
  const y = page.getByRole('spinbutton', { name: 'Y', exact: true })
  const initialX = Number(await x.inputValue())
  const initialY = Number(await y.inputValue())

  await page.keyboard.press('ArrowRight')
  await expect(x).toHaveValue(String(initialX + 1))
  await page.keyboard.press('Shift+ArrowDown')
  await expect(y).toHaveValue(String(initialY + 10))
  await page.keyboard.press('Control+z')
  await expect(
    page.getByRole('button', { name: 'やり直す', exact: true }),
  ).toBeEnabled()
  // Restoring a document checkpoint intentionally clears the canvas selection.
  await page
    .getByRole('button', { name: 'レイヤー「Rectangle」を選択' })
    .click()
  await expect(x).toHaveValue(String(initialX))
  await expect(y).toHaveValue(String(initialY))
  await page.keyboard.press('Control+y')
  await expect(
    page.getByRole('button', { name: 'やり直す', exact: true }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: 'レイヤー「Rectangle」を選択' })
    .click()
  await expect(x).toHaveValue(String(initialX + 1))
  await expect(y).toHaveValue(String(initialY + 10))

  await page.keyboard.press('Control+d')
  await expect(layerRows(page)).toHaveCount(2)
  await page.keyboard.press('Control+a')
  const selected = page
    .getByRole('list', { name: 'レイヤー' })
    .locator('.layer-select-area[aria-pressed="true"]')
  await expect(selected).toHaveCount(2)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(selected).toHaveCount(2)
  await page
    .getByRole('button', { name: 'レイヤー「Rectangle」を選択' })
    .click()
  await expect(x).toHaveValue(String(initialX - 9))
})

test('全選択は非表示とロックされたレイヤーを変更しない', async ({ page }) => {
  await openWithRectangle(page)
  await page.keyboard.press('Control+d')
  await expect(layerRows(page)).toHaveCount(2)
  await layerRows(page)
    .first()
    .getByRole('button', { name: 'ロック', exact: true })
    .click()
  await page.getByRole('button', { name: '矩形を追加' }).click()
  await expect(layerRows(page)).toHaveCount(3)
  await layerRows(page)
    .first()
    .getByRole('button', { name: 'レイヤーを隠す' })
    .click()
  await page.keyboard.press('Control+a')
  await expect(
    page
      .getByRole('list', { name: 'レイヤー' })
      .locator('.layer-select-area[aria-pressed="true"]'),
  ).toHaveCount(1)
  await page.keyboard.press('Delete')
  await expect(layerRows(page)).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'ロックを解除' })).toHaveCount(
    1,
  )
  await expect(
    page.getByRole('button', { name: '表示する', exact: true }),
  ).toHaveCount(1)
})

test('フォーム・IME変換・処理済みイベントはエディタ操作を発火しない', async ({
  page,
}) => {
  await openWithRectangle(page)
  const name = page.getByRole('textbox', {
    name: 'プロジェクト名',
    exact: true,
  })
  await name.fill('Keyboard guard')
  await name.press('ControlOrMeta+a')
  await name.press('Backspace')
  await expect(name).toHaveValue('')
  await expect(layerRows(page)).toHaveCount(1)

  const rectangle = page.getByRole('button', {
    name: 'レイヤー「Rectangle」を選択',
  })
  await rectangle.click()
  const x = page.getByRole('spinbutton', { name: 'X', exact: true })
  const beforeX = await x.inputValue()
  const composing = await page.evaluateHandle(`new KeyboardEvent('keydown', {
        key: 'Delete',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      })`)
  const handled = await page.evaluateHandle(`(() => {
    const handled = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    handled.preventDefault()
    return handled
  })()`)
  try {
    expect(
      await rectangle.evaluate(
        (element, event) => element.dispatchEvent(event),
        composing,
      ),
    ).toBe(true)
    expect(
      await rectangle.evaluate(
        (element, event) => element.dispatchEvent(event),
        handled,
      ),
    ).toBe(false)
  } finally {
    await composing.dispose()
    await handled.dispose()
  }
  await expect(layerRows(page)).toHaveCount(1)
  await expect(x).toHaveValue(beforeX)
})

test('モーダルとプレゼンテーション中は背面の選択を変更しない', async ({
  page,
}) => {
  await openWithRectangle(page)
  await page
    .getByRole('button', { name: 'ショートカット', exact: true })
    .click()
  const shortcuts = page.getByRole('dialog', {
    name: 'キーボードショートカット',
  })
  await page.keyboard.press('Control+d')
  await page.keyboard.press('Delete')
  expect(await pasteSvg(shortcuts)).toBe(true)
  await shortcuts.getByRole('button', { name: '閉じる' }).click()
  await expect(layerRows(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  const studio = page.getByRole('dialog', { name: '拡張ツール' })
  await studio
    .getByRole('navigation', { name: 'デザイン機能' })
    .getByRole('button', { name: 'アニメーション', exact: true })
    .click()
  await studio
    .getByRole('button', { name: 'プレビュー再生', exact: true })
    .click()
  const preview = page.getByRole('dialog', { name: 'Page 1', exact: true })
  await expect(preview).toBeVisible()
  expect(await pasteSvg(preview)).toBe(true)
  await preview.getByRole('button', { name: '閉じる' }).focus()
  await page.keyboard.press('Control+d')
  await page.keyboard.press('Delete')
  await preview.getByRole('button', { name: '閉じる' }).click()
  await expect(studio).toBeVisible()
  await studio.getByRole('button', { name: '閉じる' }).click()
  await expect(layerRows(page)).toHaveCount(1)
})
