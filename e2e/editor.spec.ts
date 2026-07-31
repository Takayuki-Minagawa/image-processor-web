import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'

const HISTORY_COMMIT_DELAY = 450

async function openEditor(page: Page): Promise<void> {
  await page.goto('./')
  await expect(
    page.getByRole('region', { name: '画像編集キャンバス' }),
  ).toBeVisible()
}

async function createCanvas(
  page: Page,
  name = 'E2Eキャンバス',
  width = 640,
  height = 360,
): Promise<void> {
  await page.getByRole('button', { name: '新規' }).click()
  const dialog = page.getByRole('dialog', { name: '新しいキャンバス' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('プロジェクト名').fill(name)
  await dialog.getByLabel('幅 (px)').fill(String(width))
  await dialog.getByLabel('高さ (px)').fill(String(height))
  await dialog.getByRole('button', { name: '作成' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByLabel('プロジェクト名')).toHaveValue(name)
  await expect(
    page.getByText(`${width} × ${height}px`, { exact: true }),
  ).toBeVisible()
}

async function addLayerAndWait(
  page: Page,
  accessibleName: '矩形を追加' | 'テキストを追加',
): Promise<void> {
  await page.getByRole('button', { name: accessibleName }).click()
  // Editor snapshots are intentionally transaction-debounced by 280 ms.
  await page.waitForTimeout(HISTORY_COMMIT_DELAY)
}

test.describe('Pixelweave editor', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page)
  })

  test('初期表示が主要なアクセシブルnameを公開する', async ({ page }) => {
    await expect(page.getByText('Pixelweave', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '画像を開いて、つくり始める' }),
    ).toBeVisible()
    await expect(page.getByLabel('プロジェクト名')).toHaveValue(
      '無題のデザイン',
    )

    await expect(
      page.getByRole('complementary', { name: '編集ツール' }),
    ).toBeVisible()
    await expect(
      page.getByRole('toolbar', { name: '基本ツール' }),
    ).toBeVisible()
    await expect(
      page.getByRole('toolbar', { name: '追加ツール' }),
    ).toBeVisible()
    await expect(
      page.getByRole('complementary', { name: 'インスペクター' }),
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: 'レイヤー' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('list', { name: 'レイヤー' })).toBeVisible()
    await expect(
      page.getByLabel(
        '無題のデザインの編集キャンバス。レイヤーパネルと数値入力で代替操作できます。',
      ),
    ).toBeVisible()

    await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'やり直す' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '書き出す' })).toBeVisible()

    const accessibility = await new AxeBuilder({ page }).analyze()
    const seriousViolations = accessibility.violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    )
    expect(
      seriousViolations,
      JSON.stringify(seriousViolations, null, 2),
    ).toEqual([])
  })

  test('表示テーマ・言語・簡易マニュアルを切り替えられる', async ({ page }) => {
    const languageToggle = page.getByRole('button', {
      name: '英語表示に切り替え',
    })
    await expect(languageToggle).toBeVisible()
    await languageToggle.click()

    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Switch to light mode' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#f5f7fb',
    )

    const manual = page.getByRole('button', { name: 'Manual' })
    await manual.click()
    const dialog = page.getByRole('dialog', { name: 'Quick guide' })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText('1. Open an image or start a canvas', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByText('About local processing', { exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(manual).toBeFocused()

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('新規キャンバスを指定した名前と寸法で作成する', async ({ page }) => {
    await createCanvas(page, 'バナー案', 960, 540)

    await expect(
      page.getByLabel(
        'バナー案の編集キャンバス。レイヤーパネルと数値入力で代替操作できます。',
      ),
    ).toBeVisible()
    await expect(
      page.getByText('新しいキャンバスを作成しました。', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'レイヤー' }).getByRole('listitem'),
    ).toHaveCount(0)
  })

  test('矩形とテキストを追加し、レイヤーパネルから選択する', async ({
    page,
  }) => {
    await createCanvas(page)
    await addLayerAndWait(page, '矩形を追加')
    await addLayerAndWait(page, 'テキストを追加')

    const layerList = page.getByRole('list', { name: 'レイヤー' })
    const rectangle = layerList
      .getByRole('listitem')
      .filter({ hasText: 'Rectangle' })
    const text = layerList.getByRole('listitem').filter({ hasText: 'Text' })
    const rectangleSelect = rectangle.getByRole('button', {
      name: 'レイヤー「Rectangle」を選択',
    })
    const textSelect = text.getByRole('button', {
      name: 'レイヤー「Text」を選択',
    })

    await expect(layerList.getByRole('listitem')).toHaveCount(2)
    await expect(textSelect).toHaveAttribute('aria-pressed', 'true')
    await expect(rectangleSelect).toHaveAttribute('aria-pressed', 'false')

    await rectangleSelect.click()
    await expect(rectangleSelect).toHaveAttribute('aria-pressed', 'true')
    await expect(textSelect).toHaveAttribute('aria-pressed', 'false')
    await expect(
      page.getByRole('toolbar', { name: 'レイヤー操作' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '複製' })).toBeEnabled()
  })

  test('Undo/Redoと主要キーボードショートカットが動作する', async ({
    page,
  }) => {
    await createCanvas(page)
    await addLayerAndWait(page, '矩形を追加')
    await addLayerAndWait(page, 'テキストを追加')

    const layerOptions = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    const undo = page.getByRole('button', { name: '元に戻す' })
    const redo = page.getByRole('button', { name: 'やり直す' })

    await expect(layerOptions).toHaveCount(2)
    await expect(undo).toBeEnabled()

    await undo.click()
    await expect(layerOptions).toHaveCount(1)
    await expect(redo).toBeEnabled()

    await redo.click()
    await expect(layerOptions).toHaveCount(2)

    await page.keyboard.press('Control+z')
    await expect(layerOptions).toHaveCount(1)
    await page.keyboard.press('Control+y')
    await expect(layerOptions).toHaveCount(2)

    await page.keyboard.press('b')
    await expect(
      page.getByRole('button', { name: 'ブラシ (B)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Control+v')
    await expect(
      page.getByRole('button', { name: 'ブラシ (B)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Alt+e')
    await expect(
      page.getByRole('button', { name: 'ブラシ (B)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Shift+h')
    await expect(
      page.getByRole('button', { name: 'ブラシ (B)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('e')
    await expect(
      page.getByRole('button', { name: '消しゴム (E)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('h')
    await expect(
      page.getByRole('button', { name: '手のひら (H)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('v')
    await expect(
      page.getByRole('button', { name: '選択・変形 (V)' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Shift+/')
    await expect(
      page.getByRole('dialog', { name: 'キーボードショートカット' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('dialog', { name: 'キーボードショートカット' }),
    ).toBeHidden()
  })

  test('モバイルメニューから主要なファイル操作を開ける', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 720 })

    const menuButton = page.getByRole('button', { name: 'メニュー' })
    await expect(menuButton).toBeVisible()
    await menuButton.click()

    const menu = page.getByRole('dialog', { name: 'ファイルメニュー' })
    await expect(menu).toBeVisible()
    const closeMenu = menu.getByRole('button', { name: '閉じる' })
    await expect(closeMenu).toBeFocused()
    const dialogAccessibility = await new AxeBuilder({ page })
      .include('.modal')
      .analyze()
    expect(
      dialogAccessibility.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical',
      ),
    ).toEqual([])
    await expect(
      menu.getByRole('button', { name: 'プロジェクトを開く' }),
    ).toBeVisible()
    await expect(
      menu.getByRole('button', { name: 'プロジェクトを保存' }),
    ).toBeVisible()

    await page.keyboard.press('Shift+Tab')
    await expect(
      menu.getByRole('button', { name: '拡張ツールを開く' }),
    ).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(closeMenu).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(menuButton).toBeFocused()

    await menuButton.click()
    await menu.getByRole('button', { name: '新しいキャンバス' }).click()
    await expect(
      page.getByRole('dialog', { name: '新しいキャンバス' }),
    ).toBeVisible()
  })

  test('名称変更を自動保存し、未保存のまま離脱すると警告する', async ({
    page,
  }) => {
    await createCanvas(page, '変更前', 320, 180)

    const cleanEventCancelled = await page.evaluate<boolean>(
      `(() => {
        const event = new Event('beforeunload', { cancelable: true });
        return !globalThis.dispatchEvent(event);
      })()`,
    )
    expect(cleanEventCancelled).toBe(false)

    await addLayerAndWait(page, '矩形を追加')
    await page.getByLabel('プロジェクト名').fill('名称だけ変更')

    const dirtyEventCancelled = await page.evaluate<boolean>(
      `(() => {
        const event = new Event('beforeunload', { cancelable: true });
        return !globalThis.dispatchEvent(event);
      })()`,
    )
    expect(dirtyEventCancelled).toBe(true)

    await expect(page.getByText('自動保存済み', { exact: true })).toBeVisible({
      timeout: 5_000,
    })

    const autosavedSource = await page.evaluate<string | null>(
      `(async () => {
        const fallback = globalThis.localStorage.getItem(
          'image-processor-web:autosave:v1',
        );
        try {
          const root = await globalThis.navigator.storage.getDirectory();
          const handle = await root.getFileHandle(
            'autosave.image-processor-web.json',
          );
          return await (await handle.getFile()).text();
        } catch {
          return fallback;
        }
      })()`,
    )
    expect(autosavedSource).not.toBeNull()
    const autosaved = JSON.parse(autosavedSource!) as {
      metadata: { name: string }
      fabricCanvas: { objects: unknown[] }
    }
    expect(autosaved.metadata.name).toBe('名称だけ変更')
    expect(autosaved.fabricCanvas.objects).toHaveLength(1)
  })

  test('自動保存の検証失敗を処理し、具体的な上限理由を表示する', async ({
    page,
  }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))
    const timestamp = new Date().toISOString()
    const objects = Array.from({ length: 500 }, (_, index) => ({
      type: 'Rect',
      version: '7.4.0',
      originX: 'left',
      originY: 'top',
      left: index % 25,
      top: Math.floor(index / 25),
      width: 1,
      height: 1,
      fill: '#111827',
      strokeWidth: 0,
      editorId: `limit-layer-${index}`,
      editorName: `Limit layer ${index + 1}`,
      editorLocked: false,
    }))

    await page
      .locator('input[type="file"][accept=".pwx.json,.json,application/json"]')
      .setInputFiles({
        name: 'layer-limit.pwx.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            appId: 'image-processor-web',
            schemaVersion: 1,
            canvasSize: { width: 320, height: 180 },
            fabricCanvas: { version: '7.4.0', objects },
            metadata: {
              name: 'レイヤー上限',
              createdAt: timestamp,
            },
            updatedAt: timestamp,
          }),
          'utf8',
        ),
      })

    await expect(
      page.getByText('プロジェクトを開きました。', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '矩形を追加' }).click()

    await expect(
      page.getByText(
        'プロジェクトのレイヤー数が上限（500件）を超えています。',
        { exact: true },
      ),
    ).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('自動保存失敗', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('未保存の編集がある場合は自動保存の復元前に確認する', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const timestamp = new Date().toISOString()
      localStorage.setItem(
        'image-processor-web:autosave:v1',
        JSON.stringify({
          appId: 'image-processor-web',
          schemaVersion: 1,
          canvasSize: { width: 320, height: 180 },
          fabricCanvas: { objects: [] },
          metadata: {
            name: '復元対象',
            createdAt: timestamp,
          },
          updatedAt: timestamp,
        }),
      )
    })
    await page.reload()

    const restore = page.getByRole('button', { name: '復元する' })
    await expect(restore).toBeVisible()
    await addLayerAndWait(page, '矩形を追加')

    const dismissConfirmation = page.waitForEvent('dialog').then((dialog) => {
      expect(dialog.message()).toContain('現在の未保存の編集を閉じて')
      return dialog.dismiss()
    })
    await restore.click()
    await dismissConfirmation

    await expect(page.getByLabel('プロジェクト名')).toHaveValue(
      '無題のデザイン',
    )
    await expect(
      page.getByRole('list', { name: 'レイヤー' }).getByRole('listitem'),
    ).toHaveCount(1)

    const acceptConfirmation = page.waitForEvent('dialog').then((dialog) => {
      expect(dialog.message()).toContain('現在の未保存の編集を閉じて')
      return dialog.accept()
    })
    await restore.click()
    await acceptConfirmation

    await expect(page.getByLabel('プロジェクト名')).toHaveValue('復元対象')
    await expect(
      page.getByRole('list', { name: 'レイヤー' }).getByRole('listitem'),
    ).toHaveCount(0)
  })

  test('不正なプロジェクトのエラーを日本語で表示する', async ({ page }) => {
    const projectInput = page.locator(
      'input[type="file"][accept=".pwx.json,.json,application/json"]',
    )
    await projectInput.setInputFiles({
      name: 'broken.pwx.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not json', 'utf8'),
    })

    await expect(
      page.getByText('プロジェクトファイルのJSON形式が正しくありません。', {
        exact: true,
      }),
    ).toBeVisible()

    const timestamp = new Date().toISOString()
    await projectInput.setInputFiles({
      name: 'oversized.pwx.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          appId: 'image-processor-web',
          schemaVersion: 1,
          canvasSize: { width: 9_000, height: 100 },
          fabricCanvas: { objects: [] },
          metadata: {
            name: '大きすぎるプロジェクト',
            createdAt: timestamp,
          },
          updatedAt: timestamp,
        }),
        'utf8',
      ),
    })
    await expect(
      page.getByText(
        '画像寸法が上限（各辺8,192 px、合計64 MP）を超えています。',
        { exact: true },
      ),
    ).toBeVisible()
  })

  test('連続したレイヤー追加を別々のUndo単位として扱う', async ({ page }) => {
    await createCanvas(page)
    await page.getByRole('button', { name: '矩形を追加' }).click()
    await page.getByRole('button', { name: 'テキストを追加' }).click()

    const layerOptions = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    await expect(layerOptions).toHaveCount(2)
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(layerOptions).toHaveCount(1)
  })

  test('書き出しダイアログで形式・品質・倍率を操作できる', async ({ page }) => {
    await createCanvas(page, '書き出し確認', 320, 240)
    await addLayerAndWait(page, '矩形を追加')
    await page.getByRole('button', { name: '書き出す' }).click()

    const dialog = page.getByRole('dialog', { name: '画像を書き出す' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio', { name: /^PNG/ })).toBeChecked()
    await expect(dialog.getByRole('slider', { name: '品質' })).toBeDisabled()
    await expect(dialog.getByLabel('出力倍率')).toHaveValue('1')
    await expect(
      dialog.getByText('320 × 240 px', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByText('書き出し確認.png', { exact: true }),
    ).toBeVisible()

    await dialog.getByRole('radio', { name: /^JPG/ }).check()
    await expect(dialog.getByRole('slider', { name: '品質' })).toBeEnabled()
    await dialog.getByLabel('出力倍率').selectOption('2')
    await expect(
      dialog.getByText('640 × 480 px', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByText('書き出し確認.jpg', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'ダウンロード' }),
    ).toBeEnabled()

    await dialog.getByRole('button', { name: 'キャンセル' }).click()
    await expect(dialog).toBeHidden()
  })

  test('PNGを読み込み、画像調整を適用できる', async ({ page }) => {
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const imageInput = page.getByLabel('画像ファイルを選択')

    await imageInput.setInputFiles({
      name: 'sample.png',
      mimeType: 'image/png',
      buffer: onePixelPng,
    })

    const imageLayer = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
      .filter({ hasText: 'sample' })
    await expect(imageLayer).toBeVisible()
    await expect(
      imageLayer.getByRole('button', {
        name: 'レイヤー「sample」を選択',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('1 × 1px', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: '調整' }).click()
    const brightness = page.getByRole('slider', { name: '明るさ' })
    await brightness.fill('0.25')
    await expect(
      page.getByRole('button', { name: '調整をリセット' }),
    ).toBeEnabled()

    await page.getByRole('button', { name: '矩形を追加' }).click()
    await page.getByRole('tab', { name: 'レイヤー' }).click()
    await imageLayer
      .getByRole('button', { name: 'レイヤー「sample」を選択' })
      .click()
    await page.getByRole('tab', { name: '調整' }).click()
    await expect(brightness).toHaveValue('0.25')

    await page.evaluate(() => {
      Reflect.deleteProperty(globalThis, 'showSaveFilePicker')
    })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '保存', exact: true }).click(),
    ])
    const projectPath = await download.path()
    expect(projectPath).not.toBeNull()
    const project = JSON.parse(await readFile(projectPath!, 'utf8')) as {
      fabricCanvas: {
        objects: Array<{
          type: string
          left: number
          top: number
          scaleX: number
          scaleY: number
        }>
      }
    }
    const image = project.fabricCanvas.objects.find(
      (object) => object.type.toLowerCase() === 'image',
    )
    expect(image).toMatchObject({
      left: 0,
      top: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })

  test('プロジェクト保存と再読込でレイヤーを復元する', async ({ page }) => {
    await createCanvas(page, '往復確認', 400, 300)
    await addLayerAndWait(page, '矩形を追加')

    await page.evaluate(() => {
      Reflect.deleteProperty(globalThis, 'showSaveFilePicker')
    })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '保存', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toBe('往復確認.pwx.json')
    const downloadedPath = await download.path()
    expect(downloadedPath).not.toBeNull()

    await createCanvas(page, '空', 200, 100)
    await page
      .locator('input[type="file"][accept=".pwx.json,.json,application/json"]')
      .setInputFiles(downloadedPath!)

    await expect(page.getByLabel('プロジェクト名')).toHaveValue('往復確認')
    await expect(
      page
        .getByRole('list', { name: 'レイヤー' })
        .getByRole('listitem')
        .filter({ hasText: 'Rectangle' }),
    ).toBeVisible()
    await expect(page.getByText('400 × 300px', { exact: true })).toBeVisible()
  })

  test('保存中は編集操作を止め、完了後に再開する', async ({ page }) => {
    await createCanvas(page, '保存競合確認', 400, 300)
    await addLayerAndWait(page, '矩形を追加')

    await page.evaluate(() => {
      let finishWrite: (() => void) | undefined
      Object.assign(globalThis, {
        __pixelweaveWritePending: false,
        __finishPixelweaveWrite: () => finishWrite?.(),
        showSaveFilePicker: async () => ({
          createWritable: async () => ({
            write: async () => {
              ;(
                globalThis as typeof globalThis & {
                  __pixelweaveWritePending?: boolean
                }
              ).__pixelweaveWritePending = true
              return new Promise<void>((resolve) => {
                finishWrite = resolve
              })
            },
            close: async () => undefined,
          }),
        }),
      })
    })

    await page.getByRole('button', { name: '保存', exact: true }).click()
    const app = page.locator('.app-shell')
    await expect(app).toHaveAttribute('inert', '')

    await page.keyboard.press('Control+z')
    await expect(
      page
        .getByRole('list', { name: 'レイヤー', includeHidden: true })
        .getByRole('listitem', { includeHidden: true }),
    ).toHaveCount(1)

    await page.waitForFunction(
      () =>
        (
          globalThis as typeof globalThis & {
            __pixelweaveWritePending?: boolean
          }
        ).__pixelweaveWritePending === true,
    )
    await page.evaluate(() => {
      ;(
        globalThis as typeof globalThis & {
          __finishPixelweaveWrite?: () => void
        }
      ).__finishPixelweaveWrite?.()
    })

    await expect(app).not.toHaveAttribute('inert', '')
    await expect(
      page.getByText('プロジェクトを保存しました。', { exact: true }),
    ).toBeVisible()
  })
})
