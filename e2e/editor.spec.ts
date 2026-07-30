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
    await expect(
      menu.getByRole('button', { name: 'プロジェクトを開く' }),
    ).toBeVisible()
    await expect(
      menu.getByRole('button', { name: 'プロジェクトを保存' }),
    ).toBeVisible()

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

  test('不正なプロジェクトのエラーを日本語で表示する', async ({ page }) => {
    await page
      .locator('input[type="file"][accept=".pwx.json,.json,application/json"]')
      .setInputFiles({
        name: 'broken.pwx.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{not json', 'utf8'),
      })

    await expect(
      page.getByText('プロジェクトファイルのJSON形式が正しくありません。', {
        exact: true,
      }),
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
    const imageInput = page.locator(
      'input[type="file"][accept="image/png,image/jpeg,image/webp"]',
    )

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
        __finishPixelweaveWrite: () => finishWrite?.(),
        showSaveFilePicker: async () => ({
          createWritable: async () => ({
            write: async () =>
              new Promise<void>((resolve) => {
                finishWrite = resolve
              }),
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
