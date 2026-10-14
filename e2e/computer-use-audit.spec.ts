import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function openEditor(page: Page): Promise<void> {
  await page.goto('./')
  await expect(
    page.getByRole('region', { name: '画像編集キャンバス' }),
  ).toBeVisible()
}

async function addLayer(page: Page, name = '矩形を追加'): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  // Fabric history groups continuous changes in a 280 ms transaction.
  await page.waitForTimeout(450)
}

async function importImage(page: Page, large = false): Promise<void> {
  const buffer = large
    ? Buffer.from(
        await page.locator('body').evaluate((body) => {
          const canvas = body.ownerDocument.createElement('canvas')
          canvas.width = 4096
          canvas.height = 4096
          const context = canvas.getContext('2d')!
          context.fillStyle = '#825de3'
          context.fillRect(0, 0, canvas.width, canvas.height)
          return canvas.toDataURL('image/png').split(',')[1]
        }),
        'base64',
      )
    : ONE_PIXEL_PNG
  await page.getByLabel('画像ファイルを選択').setInputFiles({
    name: 'audit-sample.png',
    mimeType: 'image/png',
    buffer,
  })
  await expect(
    page.getByRole('button', { name: 'レイヤー「audit-sample」を選択' }),
  ).toHaveAttribute('aria-pressed', 'true')
}

async function clickFieldAtItsCenter(
  page: Page,
  field: Locator,
): Promise<void> {
  await field.scrollIntoViewIfNeeded()
  const bounds = await field.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.width).toBeGreaterThan(0)
  expect(bounds!.height).toBeGreaterThan(0)
  const center = {
    x: bounds!.x + bounds!.width / 2,
    y: bounds!.y + bounds!.height / 2,
  }
  expect(
    await field.evaluate((element, point) => {
      return (
        element.ownerDocument.elementFromPoint(point.x, point.y) === element
      )
    }, center),
  ).toBe(true)
  await page.mouse.click(center.x, center.y)
  await expect(field).toBeFocused()
}

test.describe('Computer-use audit regressions', () => {
  test.beforeEach(async ({ page }) => openEditor(page))

  for (const width of [390, 900, 1179, 1180, 1181, 1440]) {
    test(`${width}pxでも全ての変形入力に重ならず到達できる`, async ({
      page,
    }, testInfo) => {
      await addLayer(page)
      await page.setViewportSize({ width, height: 844 })
      const x = page.getByRole('spinbutton', { name: 'X', exact: true })
      const originalX = await x.inputValue()
      expect(Number(originalX)).toBeGreaterThan(0)

      const geometry = await page.locator('.context-bar').evaluate((bar) => {
        const transform = bar
          .querySelector('.transform-options')!
          .getBoundingClientRect()
        const alignment = bar
          .querySelector('.alignment-options')!
          .getBoundingClientRect()
        return {
          transformRight: transform.right,
          alignmentLeft: alignment.left,
        }
      })
      expect(geometry.transformRight).toBeLessThanOrEqual(
        geometry.alignmentLeft,
      )

      for (const label of ['X', 'Y', 'W', 'H', '角度']) {
        const field = page.getByRole('spinbutton', { name: label, exact: true })
        await expect(field).toBeVisible()
        const before = await field.inputValue()
        await clickFieldAtItsCenter(page, field)
        await expect(field).toHaveValue(before)
        await expect(x).toHaveValue(originalX)
      }

      // The alignment action remains reachable after the transform fields.
      await page.getByRole('button', { name: '左揃え', exact: true }).click()
      await expect(x).toHaveValue('0')
      if (width === 390 || width === 1440) {
        await x.scrollIntoViewIfNeeded()
        await page.screenshot({
          path: testInfo.outputPath(`toolbar-${width}.png`),
        })
      }
    })
  }

  test('幅を消去して再入力し、不完全な数値を確定するまで保持できる', async ({
    page,
  }) => {
    await addLayer(page)
    const width = page.getByRole('spinbutton', { name: 'W', exact: true })
    await width.fill('')
    await expect(width).toHaveValue('')
    await width.press('3')
    await width.press('2')
    await width.press('0')
    await width.press('Enter')
    await expect(width).toHaveValue('320')
    await expect(width).toHaveAttribute('aria-valuenow', '320')

    const x = page.getByRole('spinbutton', { name: 'X', exact: true })
    await x.fill('-')
    await expect(x).toHaveValue('-')
    await x.fill('-12.5')
    await x.press('Enter')
    await expect(x).toHaveValue('-12.5')

    await width.fill('0')
    await width.press('Enter')
    await expect(width).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert')).toContainText('1以上')
    await expect(width).toHaveAttribute('aria-valuenow', '320')
    await width.press('Escape')
    await expect(width).toHaveValue('320')
    await expect(width).toHaveAttribute('aria-invalid', 'false')
  })

  test('細かい小数の確定値と整列後の値が入力欄とARIAで一致する', async ({
    page,
  }) => {
    await addLayer(page)
    const x = page.getByRole('spinbutton', { name: 'X', exact: true })
    await x.fill('0')
    await x.press('Enter')
    await x.fill('0.04')
    await x.press('Enter')
    await expect(x).toHaveValue('0.04')
    await expect(x).toHaveAttribute('aria-valuenow', '0.04')

    await page.getByRole('button', { name: '左揃え', exact: true }).click()
    await expect(x).toHaveValue('0')
    await expect(x).toHaveAttribute('aria-valuenow', '0')

    const width = page.getByRole('spinbutton', { name: 'W', exact: true })
    await width.fill('240.01')
    await width.press('Enter')
    await expect(width).toHaveValue('240.01')
    await expect(width).toHaveAttribute('aria-valuenow', '240.01')
  })

  test('履歴の現在位置がUndoとRedoのキャンバス状態に追従する', async ({
    page,
  }) => {
    await addLayer(page)
    await addLayer(page, 'テキストを追加')
    const layers = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    await expect(layers).toHaveCount(2)
    await page.getByRole('tab', { name: '履歴', exact: true }).click()
    const history = page.locator('.history-list')
    const current = history.locator('[aria-current="step"]')
    await expect(current).toHaveCount(1)
    await expect(history.getByRole('listitem').first()).toHaveAttribute(
      'aria-current',
      'step',
    )

    await page.getByRole('button', { name: '元に戻す', exact: true }).click()
    await expect(current).toHaveCount(1)
    await expect(history.getByRole('listitem').first()).not.toHaveAttribute(
      'aria-current',
      'step',
    )
    await page.getByRole('tab', { name: 'レイヤー', exact: true }).click()
    await expect(layers).toHaveCount(1)

    await page.getByRole('button', { name: 'やり直す', exact: true }).click()
    await expect(layers).toHaveCount(2)
    await page.getByRole('tab', { name: '履歴', exact: true }).click()
    await expect(history.getByRole('listitem').first()).toHaveAttribute(
      'aria-current',
      'step',
    )
    await expect(current).toHaveCount(1)
  })

  test('レイヤーの対象名と調整値を意味的に指定できる', async ({ page }) => {
    await importImage(page)
    const opacity = page.getByRole('slider', { name: '不透明度', exact: true })
    await expect(opacity).toHaveValue('100')
    await opacity.fill('60')
    await expect(opacity).toHaveAttribute('aria-valuetext', '60%')
    await addLayer(page)
    await page
      .getByRole('button', {
        name: 'レイヤー「Rectangle」を隠す',
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', {
        name: 'レイヤー「Rectangle」を表示する',
        exact: true,
      }),
    ).toBeVisible()
    await page
      .getByRole('button', {
        name: 'レイヤー「Rectangle」をロック',
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', {
        name: 'レイヤー「Rectangle」のロックを解除',
        exact: true,
      }),
    ).toBeVisible()

    await page
      .getByRole('button', { name: 'レイヤー「audit-sample」を選択' })
      .click()
    await page.getByRole('tab', { name: '調整', exact: true }).click()
    const brightness = page.getByRole('slider', { name: '明るさ', exact: true })
    const brightnessNumber = page.getByRole('spinbutton', {
      name: '明るさ（数値）',
      exact: true,
    })
    await brightnessNumber.fill('40')
    await brightnessNumber.press('Enter')
    await expect(brightness).toHaveValue('40')
    await expect(brightness).toHaveAttribute('aria-valuetext', '40')
    await brightnessNumber.fill('40.5')
    await brightnessNumber.press('Enter')
    await expect(brightness).toHaveValue('40.5')
    await expect(brightness).toHaveAttribute('aria-valuetext', '40.5')
    await brightness.fill('-25')
    await expect(brightnessNumber).toHaveValue('-25')

    const pixelate = page.getByRole('slider', {
      name: 'ピクセレート',
      exact: true,
    })
    await pixelate.fill('8')
    await expect(pixelate).toHaveAttribute('aria-valuetext', '8px')
    await expect(
      page.getByRole('spinbutton', {
        name: 'ピクセレート（数値）',
        exact: true,
      }),
    ).toHaveValue('8')
    const pixelateNumber = page.getByRole('spinbutton', {
      name: 'ピクセレート（数値）',
      exact: true,
    })
    await pixelateNumber.fill('1.1')
    await pixelateNumber.press('Enter')
    await expect(pixelateNumber).toHaveAttribute('aria-invalid', 'true')
    await expect(pixelate).toHaveValue('8')
    await pixelateNumber.press('Escape')
    await expect(pixelateNumber).toHaveValue('8')
    await expect(
      page.getByRole('slider', { name: 'ガンマ', exact: true }),
    ).toHaveValue('100')
  })

  test('キャンバスの座標に依存せず本文を編集してUndoできる', async ({
    page,
  }) => {
    await addLayer(page, 'テキストを追加')
    const content = page.getByRole('textbox', { name: '本文', exact: true })
    await expect(content).toHaveValue('テキスト')
    await content.fill('監査用テキスト ABC\n2行目')
    const fontSize = page.getByRole('textbox', {
      name: 'フォントサイズ (px)',
      exact: true,
    })
    await fontSize.fill('36')
    await page.getByRole('button', { name: '本文を適用', exact: true }).click()
    await expect(content).toHaveValue('監査用テキスト ABC\n2行目')
    await page.waitForTimeout(450)
    await page.getByRole('button', { name: '元に戻す', exact: true }).click()
    await page
      .getByRole('button', { name: 'レイヤー「Text」を選択', exact: true })
      .click()
    await expect(content).toHaveValue('テキスト')
    await page.getByRole('button', { name: 'やり直す', exact: true }).click()
    await page
      .getByRole('button', { name: 'レイヤー「Text」を選択', exact: true })
      .click()
    await expect(content).toHaveValue('監査用テキスト ABC\n2行目')
    await expect(fontSize).toHaveValue('36')
  })

  test('現在ページをアクセシビリティ属性で取得できる', async ({ page }) => {
    await page.getByRole('button', { name: 'Studio', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '拡張ツール' })
    await dialog.getByRole('tab', { name: 'デザイン', exact: true }).click()
    const panel = dialog.getByRole('tabpanel', {
      name: 'デザイン',
      exact: true,
    })
    await panel
      .getByRole('navigation', { name: 'デザイン機能' })
      .getByRole('button', { name: 'ページ', exact: true })
      .click()
    const pages = panel.locator('.design-page-strip')
    await expect(pages.locator('[aria-current="page"]')).toContainText('Page 1')
    await panel
      .getByRole('button', { name: 'ページを追加', exact: true })
      .click()
    await expect(pages.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(pages.locator('[aria-current="page"]')).toContainText('Page 2')
    await pages.getByRole('button', { name: /Page 1/u }).click()
    await expect(pages.locator('[aria-current="page"]')).toContainText('Page 1')
  })

  test('日本語と英語の編集フォームに重大なアクセシビリティ違反がない', async ({
    page,
  }) => {
    await importImage(page)
    await addLayer(page, 'テキストを追加')
    for (const locale of ['ja', 'en']) {
      if (locale === 'en') {
        await page.getByRole('button', { name: '英語表示に切り替え' }).click()
      }
      await page.getByRole('tab', { name: 'レイヤー', exact: true }).click()
      await page
        .getByRole('button', { name: 'レイヤー「Text」を選択', exact: true })
        .click()
      await expect(
        page.getByRole('textbox', {
          name: locale === 'ja' ? '本文' : 'Text content',
          exact: true,
        }),
      ).toBeVisible()
      const textResult = await new AxeBuilder({ page }).analyze()
      expect(
        textResult.violations.filter(
          ({ impact }) => impact === 'serious' || impact === 'critical',
        ),
      ).toEqual([])
      await page
        .getByRole('button', {
          name: 'レイヤー「audit-sample」を選択',
          exact: true,
        })
        .click()
      await page.getByRole('tab', { name: '調整', exact: true }).click()
      await expect(
        page.getByRole('slider', {
          name: locale === 'ja' ? 'ピクセレート' : 'Pixelate',
          exact: true,
        }),
      ).toBeVisible()
      const adjustmentResult = await new AxeBuilder({ page }).analyze()
      expect(
        adjustmentResult.violations.filter(
          ({ impact }) => impact === 'serious' || impact === 'critical',
        ),
      ).toEqual([])
    }
  })

  for (const input of ['pointer', 'keyboard']) {
    test(`処理中も進捗を読み取り${input}でキャンセルできる`, async ({
      page,
    }) => {
      await importImage(page, true)
      await page.getByRole('button', { name: 'Studio', exact: true }).click()
      const studio = page.getByRole('dialog', { name: '拡張ツール' })
      await studio.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
      const selection = studio.getByRole('tabpanel', {
        name: '選択範囲',
        exact: true,
      })
      await selection.getByLabel('X座標', { exact: true }).fill('0')
      await selection.getByLabel('Y座標', { exact: true }).fill('0')
      await selection.getByRole('button', { name: '自動選択を実行' }).click()
      await expect(
        studio.getByText('自動選択を更新しました。', { exact: true }),
      ).toBeVisible()
      await studio.getByRole('button', { name: '閉じる', exact: true }).click()
      await page.getByRole('tab', { name: '調整', exact: true }).click()
      await page.getByRole('checkbox', { name: '選択範囲だけに適用' }).check()
      await page.getByRole('slider', { name: '明るさ', exact: true }).fill('40')

      await page
        .getByRole('slider', { name: 'ぼかし', exact: true })
        .fill('100')
      await page.getByRole('slider', { name: 'ノイズ', exact: true }).fill('50')
      const workerStarted = page.waitForEvent('worker', {
        predicate: (worker) => worker.url().includes('selectionFilter.worker'),
      })
      const apply = page.getByRole('button', {
        name: '選択範囲へフィルターを適用',
        exact: true,
      })
      await apply.click()
      await workerStarted
      const progress = page.getByRole('progressbar', {
        name: '選択範囲フィルターの進捗',
      })
      await expect(progress).toBeVisible()
      const cancel = page.getByRole('button', {
        name: 'フィルターをキャンセル',
        exact: true,
      })
      await expect(cancel).toBeEnabled()
      expect(
        await cancel.evaluate((element) => Boolean(element.closest('[inert]'))),
      ).toBe(false)
      if (input === 'pointer') {
        await cancel.click()
      } else {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (
            await cancel.evaluate(
              (element) => element === element.ownerDocument.activeElement,
            )
          )
            break
          await page.keyboard.press('Tab')
        }
        await expect(cancel).toBeFocused()
        await page.keyboard.press('Enter')
      }
      await expect(progress).toBeHidden()
      await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '')
      await expect(apply).toBeFocused()
      await page.getByRole('tab', { name: 'レイヤー', exact: true }).click()
      await expect(
        page.getByRole('list', { name: 'レイヤー' }).getByRole('listitem'),
      ).toHaveCount(1)
    })
  }
})
