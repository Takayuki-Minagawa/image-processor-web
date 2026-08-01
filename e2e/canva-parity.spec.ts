import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  test,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
} from '@playwright/test'

async function openEditor(page: Page): Promise<void> {
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) =>
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`,
    ),
  )
  const response = await page.goto('./')
  expect(response?.status()).toBe(200)
  try {
    await expect(
      page.getByRole('region', { name: '画像編集キャンバス' }),
    ).toBeVisible()
  } catch (error) {
    throw new Error(
      [
        `Editor did not render at ${page.url()}.`,
        `Page errors: ${pageErrors.join(' | ') || 'none'}.`,
        `Failed requests: ${failedRequests.join(' | ') || 'none'}.`,
        `Body: ${(await page.locator('body').innerText()).slice(0, 500) || '(empty)'}.`,
      ].join('\n'),
      { cause: error },
    )
  }
}

async function openDesignStudio(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Studio' }).click()
  const dialog = page.getByRole('dialog', { name: '拡張ツール' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'デザイン' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(
    dialog.getByRole('heading', { name: 'デザイン機能' }),
  ).toBeVisible()
  return dialog
}

async function expectNoSeriousAccessibilityViolations(
  page: Page,
  include?: string,
): Promise<void> {
  const builder = new AxeBuilder({ page })
  const result = await (include ? builder.include(include) : builder).analyze()
  const seriousViolations = result.violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical',
  )
  expect(seriousViolations, JSON.stringify(seriousViolations, null, 2)).toEqual(
    [],
  )
}

async function expectStoredZip(
  download: Download,
  expectedEntries?: readonly string[],
): Promise<string[]> {
  expect(download.suggestedFilename()).toMatch(/\.zip$/u)
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const archive = Buffer.concat(chunks)
  expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  )
  const entryNames: string[] = []
  let offset = 0
  while (
    offset + 30 <= archive.byteLength &&
    view.getUint32(offset, true) === 0x0403_4b50
  ) {
    const flags = view.getUint16(offset + 6, true)
    const compression = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    expect(flags & 0x0008).toBe(0)
    expect(compression).toBe(0)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + compressedSize
    expect(dataEnd).toBeLessThanOrEqual(archive.byteLength)
    entryNames.push(
      new TextDecoder().decode(
        archive.subarray(nameStart, nameStart + nameLength),
      ),
    )
    offset = dataEnd
  }
  expect(entryNames.length).toBeGreaterThan(0)
  expect(view.getUint32(offset, true)).toBe(0x0201_4b50)
  if (expectedEntries) {
    expect(entryNames).toEqual(expectedEntries)
  }
  return entryNames
}

async function dispatchLongPress(
  context: BrowserContext,
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const cdp = await context.newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    })
    await page.waitForTimeout(600)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
  } finally {
    await cdp.detach()
  }
}

async function dispatchPinchOut(
  context: BrowserContext,
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const cdp = await context.newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 24, y },
        { x: x + 24, y },
      ],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 64, y },
        { x: x + 64, y },
      ],
    })
    await page.waitForTimeout(100)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
  } finally {
    await cdp.detach()
  }
}

test.describe('Canva parity design workflow', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page)
  })

  test('検索した複数ページテンプレートを編集可能なデザインとして展開する', async ({
    page,
  }) => {
    const dialog = await openDesignStudio(page)
    const designPanel = dialog.getByRole('tabpanel', { name: 'デザイン' })
    const designNavigation = designPanel.getByRole('navigation', {
      name: 'デザイン機能',
    })

    await designNavigation
      .getByRole('button', { name: 'テンプレート', exact: true })
      .click()
    await designPanel.getByRole('searchbox', { name: '検索' }).fill('ピッチ')

    const pitchDeck = designPanel.getByRole('button', {
      name: /ピッチデッキ.*3/u,
    })
    await expect(pitchDeck).toBeVisible()
    await pitchDeck.click()

    await expect(
      page.getByText('テンプレートを編集可能なレイヤーへ展開しました。', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '')

    await designNavigation
      .getByRole('button', { name: 'ページ', exact: true })
      .click()
    const pageItems = designPanel
      .locator('.design-page-strip')
      .getByRole('listitem')
    await expect(pageItems).toHaveCount(3)
    await expect(pageItems.nth(0)).toContainText('Title')
    await expect(pageItems.nth(1)).toContainText('Content 1')
    await expect(pageItems.nth(2)).toContainText('Content 2')

    await designPanel.getByRole('button', { name: '複製', exact: true }).click()
    await expect(pageItems).toHaveCount(4)
    await expect(pageItems.nth(1)).toContainText('Title copy')

    const switchDurationMs = await pageItems.nth(2).evaluate(async (item) => {
      const button = item.querySelector('button')
      if (!button) {
        throw new Error('Page switch button was not found.')
      }
      const startedAt = performance.now()
      ;(button as unknown as { click: () => void }).click()
      while (!item.classList.contains('active')) {
        if (performance.now() - startedAt >= 2_000) {
          throw new Error('Page switch did not complete within 2 seconds.')
        }
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
      }
      return performance.now() - startedAt
    })
    expect(switchDurationMs).toBeLessThan(1_000)
    await expect(pageItems.nth(2)).toHaveClass(/active/u)

    await designNavigation
      .getByRole('button', { name: '出力', exact: true })
      .click()
    await designPanel
      .getByRole('button', { name: 'PNG（ZIP）', exact: true })
      .click()
    await designPanel.getByLabel('ページ範囲').selectOption('selected')
    const selectedPages = designPanel.getByRole('group', {
      name: '書き出すページ',
    })
    const selectedPageCheckboxes = selectedPages.getByRole('checkbox')
    await expect(selectedPageCheckboxes).toHaveCount(4)
    for (let index = 0; index < 4; index += 1) {
      await selectedPageCheckboxes.nth(index).setChecked(false)
    }
    await selectedPageCheckboxes.nth(0).setChecked(true)
    await selectedPageCheckboxes.nth(3).setChecked(true)

    const exportButton = designPanel.getByRole('button', {
      name: '書き出す',
      exact: true,
    })
    const downloadPromise = page.waitForEvent('download')
    const exportFrameDelayMs = await exportButton.evaluate(async (button) => {
      const startedAt = performance.now()
      button.click()
      const browser = globalThis as unknown as {
        requestAnimationFrame: (callback: () => void) => number
      }
      return await new Promise<number>((resolve) => {
        browser.requestAnimationFrame(() =>
          resolve(performance.now() - startedAt),
        )
      })
    })
    expect(exportFrameDelayMs).toBeLessThan(500)
    await expectStoredZip(await downloadPromise, [
      '01-Title.png',
      '02-Content-2.png',
    ])
    await expect(
      page.getByText('デザインを書き出しました。', { exact: true }),
    ).toBeVisible()
    await expect(designPanel.locator('.design-export-progress')).toHaveCount(0)

    await designPanel.getByLabel('ページ範囲').selectOption('all')
    const allPagesDownload = page.waitForEvent('download')
    await exportButton.click()
    await expectStoredZip(await allPagesDownload, [
      '01-Title.png',
      '02-Title-copy.png',
      '03-Content-1.png',
      '04-Content-2.png',
    ])
    await expect(designPanel.locator('.design-export-progress')).toHaveCount(0)

    await expectNoSeriousAccessibilityViolations(page, '.modal')
    await dialog.getByRole('button', { name: '閉じる' }).click()
    await expect(dialog).toBeHidden()

    const layerList = page.getByRole('list', { name: 'レイヤー' })
    await expect(
      layerList.getByRole('button', {
        name: 'レイヤー「headline」を選択',
      }),
    ).toBeVisible()
    await expect(
      layerList.getByRole('button', {
        name: 'レイヤー「body-copy」を選択',
      }),
    ).toBeVisible()
    await expect(layerList.getByRole('listitem')).toHaveCount(6)
  })

  test('保存したブランドをUIに反映し、テンプレート適用を1回でUndoする', async ({
    page,
  }) => {
    const dialog = await openDesignStudio(page)
    const panel = dialog.getByRole('tabpanel', { name: 'デザイン' })
    const navigation = panel.getByRole('navigation', { name: 'デザイン機能' })

    await navigation
      .getByRole('button', { name: 'テンプレート', exact: true })
      .click()
    await panel.getByLabel('名前', { exact: true }).fill('E2E Brand')
    await panel.getByLabel('プライマリー').fill('#123456')
    await panel.getByLabel('セカンダリー').fill('#abcdef')
    await panel.getByLabel('アクセント').fill('#fedcba')
    await panel.getByLabel('見出しフォント').selectOption('manrope')
    await panel.getByLabel('本文フォント').selectOption('bitter')
    await panel
      .getByRole('button', { name: 'ブランドを保存', exact: true })
      .click()

    await expect(
      page.getByText('E2E Brandをこの端末に保存しました。', {
        exact: true,
      }),
    ).toBeVisible()
    const savedBrands = panel.getByLabel('保存済みブランド')
    await expect(
      savedBrands.locator('option', { hasText: 'E2E Brand' }),
    ).toHaveCount(1)
    await expect(savedBrands).not.toHaveValue('')

    await navigation
      .getByRole('button', { name: 'ページ', exact: true })
      .click()
    await expect(
      panel.getByRole('button', { name: 'E2E Brand: primary' }),
    ).toHaveAttribute('title', 'primary: #123456')
    await expect(
      panel.getByRole('button', { name: 'E2E Brand: secondary' }),
    ).toHaveAttribute('title', 'secondary: #abcdef')

    await navigation
      .getByRole('button', { name: 'テキスト', exact: true })
      .click()
    const fontSelect = panel.getByRole('combobox', {
      name: 'フォント',
      exact: true,
    })
    expect(
      await fontSelect.evaluate((select) =>
        Array.from(
          select.querySelectorAll('optgroup option'),
          ({ textContent }) => textContent,
        ),
      ),
    ).toEqual(['見出しフォント: Manrope', '本文フォント: Bitter'])

    await navigation
      .getByRole('button', { name: 'テンプレート', exact: true })
      .click()
    await panel.getByRole('searchbox', { name: '検索' }).fill('ボールドSNS')
    await panel.getByRole('button', { name: /ボールドSNS投稿/u }).click()
    await expect(
      page.getByText('テンプレートを編集可能なレイヤーへ展開しました。', {
        exact: true,
      }),
    ).toBeVisible()

    await dialog.getByRole('button', { name: '閉じる' }).click()
    const layers = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    await expect(layers).toHaveCount(6)

    const undo = page.getByRole('button', { name: '元に戻す' })
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(
      page.getByText('1つ前の状態に戻しました。', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(layers).toHaveCount(0)
    await expect(undo).toBeDisabled()
  })

  test('ページ構造の追加を文書履歴からUndo・Redoする', async ({ page }) => {
    let dialog = await openDesignStudio(page)
    let panel = dialog.getByRole('tabpanel', { name: 'デザイン' })
    await panel
      .getByRole('navigation', { name: 'デザイン機能' })
      .getByRole('button', { name: 'ページ', exact: true })
      .click()
    let pageItems = panel.locator('.design-page-strip').getByRole('listitem')
    await expect(pageItems).toHaveCount(1)
    await panel
      .getByRole('button', { name: 'ページを追加', exact: true })
      .click()
    await expect(pageItems).toHaveCount(2)
    await dialog.getByRole('button', { name: '閉じる' }).click()

    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(
      page.getByText('1つ前の状態に戻しました。', { exact: true }),
    ).toBeVisible()

    dialog = await openDesignStudio(page)
    panel = dialog.getByRole('tabpanel', { name: 'デザイン' })
    await panel
      .getByRole('navigation', { name: 'デザイン機能' })
      .getByRole('button', { name: 'ページ', exact: true })
      .click()
    pageItems = panel.locator('.design-page-strip').getByRole('listitem')
    await expect(pageItems).toHaveCount(1)
    await dialog.getByRole('button', { name: '閉じる' }).click()

    await page.getByRole('button', { name: 'やり直す' }).click()
    await expect(
      page.getByText('操作をやり直しました。', { exact: true }),
    ).toBeVisible()

    dialog = await openDesignStudio(page)
    panel = dialog.getByRole('tabpanel', { name: 'デザイン' })
    await panel
      .getByRole('navigation', { name: 'デザイン機能' })
      .getByRole('button', { name: 'ページ', exact: true })
      .click()
    await expect(
      panel.locator('.design-page-strip').getByRole('listitem'),
    ).toHaveCount(2)
  })

  test('10ページの4KプロジェクトをStudioで開き1秒未満で最終ページへ切り替える', async ({
    page,
  }) => {
    const timestamp = new Date().toISOString()
    const pages = Array.from({ length: 10 }, (_, index) => ({
      id: `page-${index + 1}`,
      name: `4K Page ${index + 1}`,
      canvasSize: { width: 4096, height: 4096 },
      fabricCanvas: { version: '7.4.0', objects: [] },
      editorState: { guides: [], snapTolerance: 8 },
    }))
    await page
      .locator('input[type="file"][accept=".pwx.json,.json,application/json"]')
      .setInputFiles({
        name: 'ten-4k-pages.pwx.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            appId: 'image-processor-web',
            schemaVersion: 4,
            pages,
            activePageId: pages[0].id,
            metadata: { name: '10 page 4K', createdAt: timestamp },
            updatedAt: timestamp,
          }),
          'utf8',
        ),
      })
    await expect(
      page.getByText('プロジェクトを開きました。', { exact: true }),
    ).toBeVisible()

    const dialog = await openDesignStudio(page)
    const panel = dialog.getByRole('tabpanel', { name: 'デザイン' })
    await panel
      .getByRole('navigation', { name: 'デザイン機能' })
      .getByRole('button', { name: 'ページ', exact: true })
      .click()
    const pageItems = panel.locator('.design-page-strip').getByRole('listitem')
    await expect(pageItems).toHaveCount(10)

    const lastPage = pageItems.last()
    const switchDurationMs = await lastPage.evaluate(async (item) => {
      const button = item.querySelector('button')
      if (!button) throw new Error('Page switch button was not found.')
      const startedAt = performance.now()
      button.click()
      while (!item.classList.contains('active')) {
        if (performance.now() - startedAt >= 2_000) {
          throw new Error('Page switch did not complete within 2 seconds.')
        }
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
      }
      return performance.now() - startedAt
    })
    expect(switchDurationMs).toBeLessThan(1_000)
    await expect(lastPage).toHaveClass(/active/u)
    await expect(lastPage).toContainText('4K Page 10')
  })

  test('素材・縦書き・グループ・グラフ・アニメーションを編集しZIP出力する', async ({
    page,
  }) => {
    const dialog = await openDesignStudio(page)
    const panel = dialog.getByRole('tabpanel', { name: 'デザイン' })
    const navigation = panel.getByRole('navigation', { name: 'デザイン機能' })
    const layerItems = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')

    await navigation.getByRole('button', { name: '素材', exact: true }).click()
    await panel.getByRole('button', { name: /^星/u }).click()
    await expect(layerItems).toHaveCount(1)

    await navigation
      .getByRole('button', { name: 'テキスト', exact: true })
      .click()
    await panel.getByLabel('テキスト').fill('縦書きデザイン')
    await panel.getByRole('checkbox', { name: '横書き' }).check()
    await panel.getByRole('button', { name: '追加', exact: true }).click()
    await expect(layerItems).toHaveCount(2)

    await navigation.getByRole('button', { name: '図表', exact: true }).click()
    await panel
      .getByRole('textbox', { name: 'CSVデータ', exact: true })
      .fill('Month,Sales\nJan,12\nFeb,18\nMar,25')
    await panel
      .getByRole('button', { name: 'グラフを追加', exact: true })
      .click()
    await expect(page.locator('.statusbar')).toContainText('3 レイヤー')

    await dialog.getByRole('button', { name: '閉じる' }).click()
    const layerList = page.getByRole('list', { name: 'レイヤー' })
    await layerList
      .getByRole('button', { name: 'レイヤー「Star」を選択' })
      .click()
    await layerList
      .getByRole('button', { name: 'レイヤー「Text」を選択' })
      .click({ modifiers: ['Shift'] })

    const reopened = await openDesignStudio(page)
    const reopenedPanel = reopened.getByRole('tabpanel', { name: 'デザイン' })
    const reopenedNavigation = reopenedPanel.getByRole('navigation', {
      name: 'デザイン機能',
    })
    await reopenedNavigation
      .getByRole('button', { name: '素材', exact: true })
      .click()
    await reopenedPanel
      .getByRole('button', { name: 'グループ化', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'レイヤー「Group」を選択' }),
    ).toBeAttached()

    await reopenedNavigation
      .getByRole('button', { name: 'アニメーション', exact: true })
      .click()
    await reopenedPanel
      .getByRole('button', { name: '適用', exact: true })
      .click()
    await reopenedPanel
      .getByRole('button', { name: 'プレビュー再生', exact: true })
      .click()
    const preview = page.getByRole('dialog', { name: 'Page 1' })
    await expect(preview.getByRole('img', { name: 'Page 1' })).toBeVisible()
    await preview.getByRole('button', { name: '閉じる' }).click()

    await reopenedNavigation
      .getByRole('button', { name: '出力', exact: true })
      .click()
    await reopenedPanel
      .getByRole('button', { name: 'PNG（ZIP）', exact: true })
      .click()
    await reopenedPanel.getByLabel('ページ範囲').selectOption('active')
    const downloadPromise = page.waitForEvent('download')
    await reopenedPanel
      .getByRole('button', { name: '書き出す', exact: true })
      .click()
    await expectStoredZip(await downloadPromise)
    await expect(
      page.getByText('デザインを書き出しました。', { exact: true }),
    ).toBeVisible()
  })
})

test.describe('Canva parity mobile workflow', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })

  test('スマホ配置でタッチ操作と全画面デザインパネルを利用できる', async ({
    context,
    page,
  }) => {
    await openEditor(page)

    const toolRail = page.locator('.tool-rail')
    const editorMain = page.locator('.editor-main')
    const [toolRailBox, editorMainBox] = await Promise.all([
      toolRail.boundingBox(),
      editorMain.boundingBox(),
    ])
    expect(toolRailBox).not.toBeNull()
    expect(editorMainBox).not.toBeNull()
    expect(toolRailBox!.y).toBeGreaterThanOrEqual(
      editorMainBox!.y + editorMainBox!.height - 1,
    )

    const firstToolTarget = await toolRail
      .locator('.tool-button')
      .first()
      .boundingBox()
    expect(firstToolTarget).not.toBeNull()
    expect(firstToolTarget!.width).toBeGreaterThanOrEqual(44)
    expect(firstToolTarget!.height).toBeGreaterThanOrEqual(44)

    const inspector = page.getByRole('complementary', {
      name: 'インスペクター',
    })
    await inspector
      .getByRole('button', { name: 'インスペクターを閉じる' })
      .click()
    await expect(inspector).toHaveClass(/closed/u)

    const viewportBox = await page.locator('.canvas-viewport').boundingBox()
    expect(viewportBox).not.toBeNull()
    const touchX = viewportBox!.x + viewportBox!.width / 2
    const touchY = viewportBox!.y + Math.min(viewportBox!.height / 2, 140)
    await dispatchLongPress(context, page, touchX, touchY)

    await expect(inspector).toHaveClass(/open/u)
    await expect(
      inspector.getByRole('tab', { name: 'レイヤー' }),
    ).toHaveAttribute('aria-selected', 'true')
    await expectNoSeriousAccessibilityViolations(page)

    await inspector
      .getByRole('button', { name: 'インスペクターを閉じる' })
      .click()
    const zoomValue = page.locator('.zoom-value')
    const zoomBeforePinch = await zoomValue.innerText()
    await dispatchPinchOut(context, page, touchX, touchY)
    await expect.poll(() => zoomValue.innerText()).not.toBe(zoomBeforePinch)

    await page.getByRole('button', { name: 'メニュー' }).click()
    const menu = page.getByRole('dialog', { name: 'ファイルメニュー' })
    await menu.getByRole('button', { name: '拡張ツールを開く' }).click()

    const studio = page.getByRole('dialog', { name: '拡張ツール' })
    await expect(studio).toBeVisible()
    const studioBox = await studio.boundingBox()
    expect(studioBox).not.toBeNull()
    expect(studioBox!.x).toBeCloseTo(0, 0)
    expect(studioBox!.y).toBeCloseTo(0, 0)
    expect(studioBox!.width).toBeCloseTo(390, 0)
    expect(studioBox!.height).toBeCloseTo(844, 0)
    await expect(
      studio.getByRole('heading', { name: 'デザイン機能' }),
    ).toBeVisible()
    await expect(
      studio.getByRole('button', { name: 'ページ', exact: true }),
    ).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page, '.modal')

    const panel = studio.getByRole('tabpanel', { name: 'デザイン' })
    const navigation = panel.getByRole('navigation', { name: 'デザイン機能' })
    await navigation
      .getByRole('button', { name: 'テンプレート', exact: true })
      .click()
    await panel.getByRole('searchbox', { name: '検索' }).fill('ボールドSNS')
    await panel.getByRole('button', { name: /ボールドSNS投稿/u }).click()
    await expect(
      page.getByText('テンプレートを編集可能なレイヤーへ展開しました。', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '')

    await navigation
      .getByRole('button', { name: 'テキスト', exact: true })
      .click()
    await panel.getByLabel('テキスト').fill('モバイルで追加')
    await panel.getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.locator('.statusbar')).toContainText('7 レイヤー')

    await navigation.getByRole('button', { name: '出力', exact: true }).click()
    await panel.getByRole('button', { name: 'PNG（ZIP）', exact: true }).click()
    await panel.getByLabel('ページ範囲').selectOption('active')
    const downloadPromise = page.waitForEvent('download')
    await panel.getByRole('button', { name: '書き出す', exact: true }).click()
    await expectStoredZip(await downloadPromise)
  })
})

test.describe('Canva parity tablet workflow', () => {
  test.use({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: true,
  })

  test('iPad相当でテンプレート・テキスト・ZIP出力を完了できる', async ({
    page,
  }) => {
    await openEditor(page)
    const railBox = await page.locator('.tool-rail').boundingBox()
    const mainBox = await page.locator('.editor-main').boundingBox()
    expect(railBox).not.toBeNull()
    expect(mainBox).not.toBeNull()
    expect(railBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height - 1)

    const studio = await openDesignStudio(page)
    const studioBox = await studio.boundingBox()
    expect(studioBox).not.toBeNull()
    expect(studioBox!.x).toBeCloseTo(0, 0)
    expect(studioBox!.y).toBeCloseTo(0, 0)
    expect(studioBox!.width).toBeCloseTo(1024, 0)
    expect(studioBox!.height).toBeCloseTo(768, 0)
    await expectNoSeriousAccessibilityViolations(page, '.modal')

    const panel = studio.getByRole('tabpanel', { name: 'デザイン' })
    const navigation = panel.getByRole('navigation', { name: 'デザイン機能' })
    await navigation
      .getByRole('button', { name: 'テンプレート', exact: true })
      .click()
    await panel.getByRole('searchbox', { name: '検索' }).fill('ボールドSNS')
    await panel.getByRole('button', { name: /ボールドSNS投稿/u }).click()
    await expect(
      page.getByText('テンプレートを編集可能なレイヤーへ展開しました。', {
        exact: true,
      }),
    ).toBeVisible()

    await navigation
      .getByRole('button', { name: 'テキスト', exact: true })
      .click()
    await panel.getByLabel('テキスト').fill('タブレットで追加')
    await panel.getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.locator('.statusbar')).toContainText('7 レイヤー')

    await navigation.getByRole('button', { name: '出力', exact: true }).click()
    await panel.getByRole('button', { name: 'PNG（ZIP）', exact: true }).click()
    await panel.getByLabel('ページ範囲').selectOption('active')
    const downloadPromise = page.waitForEvent('download')
    await panel.getByRole('button', { name: '書き出す', exact: true }).click()
    await expectStoredZip(await downloadPromise, ['01-Title.png'])
    await expect(
      page.getByText('デザインを書き出しました。', { exact: true }),
    ).toBeVisible()
  })
})
