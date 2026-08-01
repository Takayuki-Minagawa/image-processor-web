import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'

const MODEL_URL = /https:\/\/huggingface\.co\/Heliosoph\/u2net-onnx\/resolve\//
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

interface StoredZipEntryView {
  name: string
  data: Uint8Array
}

const readStoredZipEntries = (archive: Uint8Array): StoredZipEntryView[] => {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  )
  const decoder = new TextDecoder()
  const entries: StoredZipEntryView[] = []
  let offset = 0

  while (
    offset + 30 <= archive.byteLength &&
    view.getUint32(offset, true) === 0x0403_4b50
  ) {
    const method = view.getUint16(offset + 8, true)
    if (method !== 0) {
      throw new Error(
        `E2E ZIP parser only accepts stored entries, got ${method}.`,
      )
    }
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + size
    if (dataEnd > archive.byteLength) {
      throw new Error('E2E ZIP parser encountered a truncated entry.')
    }
    entries.push({
      name: decoder.decode(archive.subarray(nameStart, nameStart + nameLength)),
      data: archive.slice(dataStart, dataEnd),
    })
    offset = dataEnd
  }

  return entries
}

const readPngDimensions = (
  data: Uint8Array,
): { width: number; height: number } => {
  if (
    data.byteLength < 24 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47
  ) {
    throw new Error('Expected a PNG entry in the generated ZIP.')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  }
}

const startLongTaskObservation = async (page: Page): Promise<boolean> =>
  page.evaluate<boolean>(`(() => {
    const target = globalThis
    target.__pixelweaveLongTaskObserver?.disconnect()
    target.__pixelweaveLongTaskDurations = []
    if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      return false
    }
    target.__pixelweaveLongTaskObserver = new PerformanceObserver((list) => {
      target.__pixelweaveLongTaskDurations.push(
        ...list.getEntries().map((entry) => entry.duration),
      )
    })
    target.__pixelweaveLongTaskObserver.observe({ entryTypes: ['longtask'] })
    return true
  })()`)

const stopLongTaskObservation = async (page: Page): Promise<number[]> =>
  page.evaluate<number[]>(`(() => {
    const target = globalThis
    const pending = target.__pixelweaveLongTaskObserver
      ?.takeRecords()
      .map((entry) => entry.duration) ?? []
    target.__pixelweaveLongTaskObserver?.disconnect()
    target.__pixelweaveLongTaskObserver = undefined
    return [...(target.__pixelweaveLongTaskDurations ?? []), ...pending]
  })()`)

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

async function createSmallCanvas(
  page: Page,
  name: string,
  width = 96,
  height = 64,
): Promise<void> {
  await page.getByRole('button', { name: '新規' }).click()
  const dialog = page.getByRole('dialog', { name: '新しいキャンバス' })
  await dialog.getByLabel('プロジェクト名').fill(name)
  await dialog.getByLabel('幅 (px)').fill(String(width))
  await dialog.getByLabel('高さ (px)').fill(String(height))
  await dialog.getByRole('button', { name: '作成' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByText(`${width} × ${height}px`, { exact: true }),
  ).toBeVisible()
}

async function addColoredRectangle(page: Page, color: string): Promise<void> {
  await page.getByLabel('描画色').fill(color)
  await page.getByRole('button', { name: '矩形を追加' }).click()
  await expect(
    page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
      .filter({ hasText: 'Rectangle' }),
  ).toBeVisible()
}

async function createPatternedPng(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate<number[]>(`(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not create the E2E pattern canvas.')
    }

    context.fillStyle = '#183153'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#f59e0b'
    context.fillRect(24, 16, 48, 32)
    context.fillStyle = '#7c3aed'
    context.fillRect(36, 24, 24, 16)

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('Could not encode the E2E pattern as PNG.'))
      }, 'image/png')
    })
    return [...new Uint8Array(await blob.arrayBuffer())]
  })()`)
  return Buffer.from(bytes)
}

async function openStudio(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Studio' }).click()
  const dialog = page.getByRole('dialog', { name: '拡張ツール' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeStudio(page: Page, dialog: Locator): Promise<void> {
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '')
  await dialog.getByRole('button', { name: '閉じる' }).click()
  await expect(dialog).toBeHidden()
}

async function expectNoSeriousAccessibilityViolations(
  page: Page,
  panelName = 'visible studio panel',
): Promise<void> {
  const accessibility = await new AxeBuilder({ page })
    .include('.modal')
    .analyze()
  const seriousViolations = accessibility.violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical',
  )
  expect(
    seriousViolations,
    `${panelName}: ${JSON.stringify(seriousViolations, null, 2)}`,
  ).toEqual([])
}

test.describe('Feature expansion studio', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page)
  })

  test('名称から12件のロゴ候補を生成し、通常レイヤーとして挿入・編集できる', async ({
    page,
  }, testInfo) => {
    testInfo.snapshotSuffix = ''
    const dialog = await openStudio(page)
    await expectNoSeriousAccessibilityViolations(page)

    await dialog.getByRole('tab', { name: 'ロゴ生成' }).click()
    const logoPanel = dialog.getByRole('tabpanel', {
      name: 'ロゴ生成',
    })
    await logoPanel.getByLabel('名称').fill('North Star E2E')
    await logoPanel.getByLabel('イニシャル').fill('NS')
    await logoPanel.getByRole('button', { name: '候補を生成' }).click()

    const candidates = logoPanel
      .getByRole('list', { name: 'ロゴ候補' })
      .getByRole('button', { name: /^候補 \d+:/u })
    await expect(candidates).toHaveCount(12)
    await expect(candidates.nth(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(
      logoPanel.getByRole('list', { name: 'ロゴ候補' }),
    ).toHaveScreenshot('logo-candidates.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.05,
      threshold: 0.25,
    })

    await candidates.nth(1).click()
    await expect(candidates.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await logoPanel.getByRole('button', { name: '選択した候補を挿入' }).click()
    await expect(logoPanel.getByRole('status')).toContainText('挿入しました')

    await closeStudio(page, dialog)

    const layerList = page.getByRole('list', { name: 'レイヤー' })
    await expect
      .poll(() => layerList.getByRole('listitem').count())
      .toBeGreaterThan(1)

    const firstLayerSelect = layerList
      .getByRole('button', { name: /^レイヤー「.+」を選択$/u })
      .first()
    await firstLayerSelect.dblclick()
    const rename = layerList.getByLabel('レイヤー名')
    await rename.fill('Editable E2E logo layer')
    await rename.press('Enter')

    await expect(
      layerList.getByRole('button', {
        name: 'レイヤー「Editable E2E logo layer」を選択',
      }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('complementary', { name: 'インスペクター' })
        .getByRole('slider')
        .first(),
    ).toBeVisible()
  })

  test('Filter・Selection・Batch・Background・Scriptの主要パネルに重大なアクセシビリティ違反がない', async ({
    page,
  }) => {
    const dialog = await openStudio(page)

    await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
    await expect(
      dialog.getByRole('region', { name: '詳細フィルター' }),
    ).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page, 'Filter panel')

    const advancedTools = dialog.getByRole('region', { name: '高度ツール' })
    await expect(
      advancedTools.getByRole('tabpanel', { name: '選択範囲' }),
    ).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page, 'Selection panel')

    await advancedTools.getByRole('tab', { name: '背景除去' }).click()
    await expect(
      advancedTools.getByRole('tabpanel', { name: '背景除去' }),
    ).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page, 'Background panel')

    await advancedTools
      .getByRole('tab', { name: 'スクリプト', exact: true })
      .click()
    await expect(
      advancedTools.getByRole('tabpanel', {
        name: 'スクリプト',
        exact: true,
      }),
    ).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page, 'Script panel')

    await dialog.getByRole('tab', { name: '自動化・バッチ' }).click()
    await dialog.getByRole('tab', { name: 'バッチ変換' }).click()
    await expect(
      dialog.getByRole('tabpanel', { name: 'バッチ変換' }),
    ).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page, 'Batch panel')
  })

  test('禁止スクリプトを拒否し、複数の許可コマンドを1つのUndo単位で実行する', async ({
    page,
  }) => {
    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
    await dialog.getByRole('tab', { name: 'スクリプト', exact: true }).click()

    const scriptPanel = dialog.getByRole('tabpanel', {
      name: 'スクリプト',
      exact: true,
    })
    const editorScript = scriptPanel.getByLabel('エディタースクリプト')
    await editorScript.fill('fetch("https://example.invalid");')
    await scriptPanel
      .getByRole('button', { name: '安全性を確認して実行' })
      .click()

    await expect(dialog.getByRole('alert')).toContainText(/fetch/iu)
    await expect(dialog.getByRole('alert')).toContainText(/forbidden/iu)

    await editorScript.fill(`
      editor.addText("Script headline", {
        left: 32,
        top: 48,
        fill: "#112233",
        fontSize: 40,
        name: "Script headline"
      });
      editor.addText("Script caption", {
        left: 32,
        top: 108,
        fill: "#445566",
        fontSize: 20,
        name: "Script caption"
      });
    `)
    await scriptPanel
      .getByRole('button', { name: '安全性を確認して実行' })
      .click()
    await expect(
      dialog
        .getByRole('region', { name: '高度ツール' })
        .getByText('2件の安全なコマンドを作成しました。', { exact: true }),
    ).toBeVisible()

    await closeStudio(page, dialog)

    const layerItems = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    await expect(layerItems).toHaveCount(2)
    await expect(page.getByRole('button', { name: '元に戻す' })).toBeEnabled()

    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(layerItems).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'やり直す' })).toBeEnabled()
  })

  test('SVG書き出しで範囲を選択でき、ラスターレイヤーの埋め込み方針を説明する', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '矩形を追加' }).click()
    await page.getByRole('button', { name: '書き出す' }).click()
    const dialog = page.getByRole('dialog', { name: '画像を書き出す' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('radio', { name: /^SVG/u }).check()
    const scope = dialog.getByLabel('SVGの範囲')
    await expect(scope).toHaveValue('document')
    await expect(
      scope.getByRole('option', { name: 'キャンバス全体' }),
    ).toHaveCount(1)
    await expect(
      scope.getByRole('option', { name: '選択オブジェクト' }),
    ).toHaveCount(1)
    await expect(
      dialog.getByText('画像レイヤーはData URLとしてSVG内へ埋め込まれます。', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(dialog.getByRole('slider', { name: '品質' })).toBeDisabled()
    await expect(dialog.getByLabel('出力倍率')).toBeDisabled()
    await expect(dialog.getByText(/viewBox/u)).toContainText('1280 × 720')

    await scope.selectOption('selection')
    await expect(
      dialog.getByText('選択範囲のviewBox', { exact: true }),
    ).toBeVisible()

    await dialog.getByRole('button', { name: 'キャンセル' }).click()
    await expect(dialog).toBeHidden()
  })

  test('ルーラーから任意位置へガイドをドラッグし、Undo・Redoできる', async ({
    page,
  }) => {
    await createSmallCanvas(page, 'Guide drag E2E', 400, 200)
    const ruler = page.getByRole('button', { name: '縦ガイド' })
    const canvas = page.locator('.canvas-viewport canvas.upper-canvas')
    await ruler.dragTo(canvas, {
      force: true,
      targetPosition: { x: 560, y: 300 },
    })

    await page.evaluate(() => {
      Reflect.deleteProperty(globalThis, 'showSaveFilePicker')
    })
    const readGuides = async (): Promise<
      Array<{ axis: 'x' | 'y'; position: number }>
    > => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '保存', exact: true }).click(),
      ])
      const path = await download.path()
      expect(path).not.toBeNull()
      const project = JSON.parse(await readFile(path!, 'utf8')) as {
        activePageId: string
        pages: Array<{
          id: string
          editorState: {
            guides: Array<{ axis: 'x' | 'y'; position: number }>
          }
        }>
      }
      const activePage = project.pages.find(
        ({ id }) => id === project.activePageId,
      )
      expect(
        activePage,
        'Saved project must contain its active page.',
      ).toBeTruthy()
      return activePage!.editorState.guides
    }

    const guides = await readGuides()
    expect(guides).toHaveLength(1)
    expect(guides[0]).toMatchObject({ axis: 'x' })
    expect(guides[0].position).toBeGreaterThan(200)
    expect(guides[0].position).toBeLessThanOrEqual(400)

    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByRole('button', { name: 'やり直す' })).toBeEnabled()
    expect(await readGuides()).toEqual([])

    await page.getByRole('button', { name: 'やり直す' }).click()
    expect(await readGuides()).toEqual(guides)
  })

  test('記録開始からクイック操作を実行し、マクロとして停止・保存する', async ({
    page,
  }) => {
    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '自動化・バッチ' }).click()

    const macroPanel = dialog.getByRole('tabpanel', { name: 'マクロ' })
    await macroPanel.getByLabel('マクロ名').fill('E2E quick recipe')
    await macroPanel.getByRole('button', { name: '記録を開始' }).click()
    await expect(macroPanel.getByText('記録中: 0件のコマンド')).toBeVisible()

    const canvasSize = dialog.getByRole('group', {
      name: 'キャンバスサイズ',
    })
    await canvasSize.getByLabel('幅').fill('720')
    await canvasSize.getByLabel('高さ').fill('480')
    await canvasSize
      .getByRole('button', { name: 'キャンバスをリサイズ' })
      .click()
    await expect(macroPanel.getByText('記録中: 1件のコマンド')).toBeVisible()

    const watermark = dialog.getByRole('group', { name: '透かし' })
    await watermark.getByLabel('テキスト').fill('Macro E2E')
    await watermark.getByRole('button', { name: '透かしを追加' }).click()
    await expect(macroPanel.getByText('記録中: 2件のコマンド')).toBeVisible()

    await macroPanel.getByRole('button', { name: '記録を停止して保存' }).click()
    await expect(macroPanel.getByLabel('マクロを選択')).toContainText(
      'E2E quick recipe',
    )
    await expect(dialog.getByRole('status')).toHaveText(
      '2件のコマンドをマクロとして保存しました。',
    )

    await closeStudio(page, dialog)
    await expect(page.getByText('720 × 480px', { exact: true })).toBeVisible()
    await expect(
      page
        .getByRole('list', { name: 'レイヤー' })
        .getByRole('listitem')
        .filter({ hasText: 'Watermark' }),
    ).toBeVisible()
  })

  test('フィルターを含むマクロを記録・書き出し・再読込・再生し、Undo 1回で戻す', async ({
    page,
  }) => {
    await createSmallCanvas(page, 'Macro round trip E2E')
    await page.getByLabel('画像ファイルを選択').setInputFiles({
      name: 'macro-source.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    })
    await expect(
      page
        .getByRole('list', { name: 'レイヤー' })
        .getByRole('listitem')
        .filter({ hasText: 'macro-source' }),
    ).toBeVisible()

    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '自動化・バッチ' }).click()
    const macroPanel = dialog.getByRole('tabpanel', { name: 'マクロ' })
    await macroPanel.getByLabel('マクロ名').fill('Filter round trip')
    await macroPanel.getByRole('button', { name: '記録を開始' }).click()

    const filter = dialog.getByRole('group', { name: '画像フィルター' })
    await filter.getByLabel('種類').selectOption('contrast')
    await filter.getByLabel('値').fill('0.25')
    await filter.getByRole('button', { name: 'フィルターを適用' }).click()
    await expect(macroPanel.getByText('記録中: 1件のコマンド')).toBeVisible()

    const canvasSize = dialog.getByRole('group', {
      name: 'キャンバスサイズ',
    })
    await canvasSize.getByLabel('幅').fill('80')
    await canvasSize.getByLabel('高さ').fill('56')
    await canvasSize
      .getByRole('button', { name: 'キャンバスをリサイズ' })
      .click()
    await expect(macroPanel.getByText('記録中: 2件のコマンド')).toBeVisible()
    await macroPanel.getByRole('button', { name: '記録を停止して保存' }).click()
    await expect(macroPanel.getByLabel('マクロを選択')).toContainText(
      'Filter round trip',
    )

    const [macroDownload] = await Promise.all([
      page.waitForEvent('download'),
      macroPanel.getByRole('button', { name: 'JSONを書き出し' }).click(),
    ])
    expect(macroDownload.suggestedFilename()).toMatch(/\.pwxmacro\.json$/u)
    const macroPath = await macroDownload.path()
    expect(macroPath).not.toBeNull()
    const macroSource = await readFile(macroPath!, 'utf8')
    const macroJson = JSON.parse(macroSource) as {
      commands: Array<{ type: string; filter?: string }>
    }
    expect(macroJson.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'applyFilter', filter: 'contrast' }),
        expect.objectContaining({ type: 'resizeCanvas' }),
      ]),
    )

    await macroPanel
      .getByLabel('マクロJSONを読み込み')
      .setInputFiles(macroPath!)
    const automationStatus = dialog
      .getByRole('region', { name: '自動化と一括書き出し' })
      .getByRole('status')
    await expect(automationStatus).toHaveText('マクロJSONを読み込みました。')

    await canvasSize.getByLabel('幅').fill('72')
    await canvasSize.getByLabel('高さ').fill('48')
    await canvasSize
      .getByRole('button', { name: 'キャンバスをリサイズ' })
      .click()
    await expect(page.getByText('72 × 48px', { exact: true })).toBeVisible()

    await macroPanel
      .getByRole('button', { name: '現在のドキュメントへ再生' })
      .click()
    await expect(automationStatus).toHaveText(
      'マクロ「Filter round trip」を再生しました。',
    )
    await closeStudio(page, dialog)

    await expect(page.getByText('80 × 56px', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByText('72 × 48px', { exact: true })).toBeVisible()
  })

  test('50画像をWorkerで変換し、UI応答・進捗・50件のZIP出力を確認する', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await createSmallCanvas(page, 'Batch 50 E2E')
    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '自動化・バッチ' }).click()
    await dialog.getByRole('tab', { name: 'バッチ変換' }).click()
    let batchPanel = dialog.getByRole('tabpanel', { name: 'バッチ変換' })

    await batchPanel.getByLabel(/画像ファイル（最大\d+件）/u).setInputFiles(
      Array.from({ length: 50 }, (_, index) => ({
        name: `batch-${String(index + 1).padStart(2, '0')}.png`,
        mimeType: 'image/png',
        buffer: ONE_PIXEL_PNG,
      })),
    )
    await expect(batchPanel.getByText('50件を選択中')).toBeVisible()
    await batchPanel.getByLabel('幅（px）').fill('16')
    await batchPanel.getByLabel('高さ（px）').fill('16')
    await batchPanel.getByLabel('保存方法').selectOption('zip')

    expect(await startLongTaskObservation(page)).toBe(true)
    const downloadPromise = page.waitForEvent('download')
    await batchPanel.getByRole('button', { name: 'バッチ変換を開始' }).click()

    await dialog.getByRole('tab', { name: 'ロゴ生成' }).click()
    await expect(dialog.getByRole('tab', { name: 'ロゴ生成' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await dialog.getByRole('tab', { name: '自動化・バッチ' }).click()
    await expect(
      dialog.getByRole('tab', { name: '自動化・バッチ' }),
    ).toHaveAttribute('aria-selected', 'true')
    await dialog.getByRole('tab', { name: 'バッチ変換' }).click()
    batchPanel = dialog.getByRole('tabpanel', { name: 'バッチ変換' })

    const download = await downloadPromise
    await expect(
      batchPanel.getByText('完了 50件 / 失敗 0件 / 全50件', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      batchPanel.getByRole('progressbar', { name: 'バッチ変換の進捗' }),
    ).toHaveAttribute('value', '50')

    const longTasks = await stopLongTaskObservation(page)
    expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(200)

    expect(download.suggestedFilename()).toMatch(/-batch\.zip$/u)
    const downloadPath = await download.path()
    expect(downloadPath).not.toBeNull()
    const entries = readStoredZipEntries(await readFile(downloadPath!))
    expect(entries).toHaveLength(50)
    expect(new Set(entries.map(({ name }) => name)).size).toBe(50)
    expect(
      entries.every(({ data }) => readPngDimensions(data).width === 16),
    ).toBe(true)
    expect(
      entries.every(({ data }) => readPngDimensions(data).height === 16),
    ).toBe(true)
  })

  test('なげなわをポインターで描き、マーチングアンツの選択範囲へフィルターを適用する', async ({
    page,
  }) => {
    await createSmallCanvas(page, 'Lasso E2E')
    await addColoredRectangle(page, '#2563eb')

    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()

    const advancedTools = dialog.getByRole('region', { name: '高度ツール' })
    const selectionPanel = advancedTools.getByRole('tabpanel', {
      name: '選択範囲',
    })
    const lasso = selectionPanel.getByRole('img', {
      name: 'なげなわ描画領域',
    })
    await lasso.scrollIntoViewIfNeeded()
    const bounds = await lasso.boundingBox()
    expect(bounds).not.toBeNull()

    const insetX = bounds!.width * 0.2
    const insetY = bounds!.height * 0.2
    const right = bounds!.x + bounds!.width - insetX
    const bottom = bounds!.y + bounds!.height - insetY
    await page.mouse.move(bounds!.x + insetX, bounds!.y + insetY)
    await page.mouse.down()
    await page.mouse.move(right, bounds!.y + insetY, { steps: 4 })
    await page.mouse.move(right, bottom, { steps: 4 })
    await page.mouse.move(bounds!.x + insetX, bottom, { steps: 4 })
    await page.mouse.move(bounds!.x + insetX, bounds!.y + insetY, {
      steps: 4,
    })
    await page.mouse.up()

    await expect(
      advancedTools.getByText('なげなわ選択を更新しました。', {
        exact: true,
      }),
    ).toBeVisible()
    const marchingAnts = selectionPanel.locator('.marching-ants-overlay')
    await expect(marchingAnts).toBeVisible()
    await expect(marchingAnts.locator('path').first()).toHaveAttribute(
      'd',
      /[ML]/u,
    )

    await closeStudio(page, dialog)

    const inspector = page.getByRole('complementary', {
      name: 'インスペクター',
    })
    await inspector.getByRole('tab', { name: '調整' }).click()
    await inspector
      .getByRole('checkbox', {
        name: '選択範囲だけに適用',
      })
      .check()
    await inspector.getByRole('slider', { name: '明るさ' }).fill('0.25')
    await inspector
      .getByRole('button', { name: '選択範囲へフィルターを適用' })
      .click()

    await expect(
      page.getByText('選択範囲へフィルターを適用しました。', {
        exact: true,
      }),
    ).toBeVisible()
    await inspector.getByRole('tab', { name: 'レイヤー' }).click()
    const layerItems = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    await expect(layerItems).toHaveCount(2)
    await expect(
      layerItems.filter({ hasText: 'Selection filter' }),
    ).toHaveCount(1)

    const undo = page.getByRole('button', { name: '元に戻す' })
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(layerItems).toHaveCount(1)
    await expect(
      layerItems.filter({ hasText: 'Selection filter' }),
    ).toHaveCount(0)
  })

  test('自動選択からフェザーと部分フィルターを適用し、Undo・Redo後の実キャンバスをgolden比較する', async ({
    page,
  }, testInfo) => {
    testInfo.snapshotSuffix = ''
    await createSmallCanvas(page, 'Magic wand filter E2E')
    await page.getByLabel('画像ファイルを選択').setInputFiles({
      name: 'wand-pattern.png',
      mimeType: 'image/png',
      buffer: await createPatternedPng(page),
    })
    await expect(
      page
        .getByRole('list', { name: 'レイヤー' })
        .getByRole('listitem')
        .filter({ hasText: 'wand-pattern' }),
    ).toBeVisible()

    let dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
    let advancedTools = dialog.getByRole('region', { name: '高度ツール' })
    let selectionPanel = advancedTools.getByRole('tabpanel', {
      name: '選択範囲',
    })
    await selectionPanel.getByLabel('X座標').fill('4')
    await selectionPanel.getByLabel('Y座標').fill('4')
    await selectionPanel.getByLabel('許容値').fill('0')
    await selectionPanel.getByRole('button', { name: '自動選択を実行' }).click()
    await expect(
      advancedTools.getByText('自動選択を更新しました。', { exact: true }),
    ).toBeVisible()

    await selectionPanel.getByLabel('調整半径').fill('3')
    await selectionPanel.getByRole('button', { name: 'ぼかす' }).click()
    await expect(
      advancedTools.getByText('選択範囲を調整しました。', { exact: true }),
    ).toBeVisible()
    await closeStudio(page, dialog)

    const inspector = page.getByRole('complementary', {
      name: 'インスペクター',
    })
    await inspector.getByRole('tab', { name: '調整' }).click()
    await inspector
      .getByRole('checkbox', { name: '選択範囲だけに適用' })
      .check()
    await inspector.getByRole('slider', { name: '明るさ' }).fill('0.45')
    await inspector
      .getByRole('button', { name: '選択範囲へフィルターを適用' })
      .click()
    await expect(
      page.getByText('選択範囲へフィルターを適用しました。', {
        exact: true,
      }),
    ).toBeVisible()

    await inspector.getByRole('tab', { name: 'レイヤー' }).click()
    const layerItems = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    await expect(layerItems).toHaveCount(2)
    await expect(
      layerItems.filter({ hasText: 'Selection filter' }),
    ).toHaveCount(1)

    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(layerItems).toHaveCount(1)
    await expect(
      layerItems.filter({ hasText: 'Selection filter' }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'やり直す' }).click()
    await expect(layerItems).toHaveCount(2)
    await expect(
      layerItems.filter({ hasText: 'Selection filter' }),
    ).toHaveCount(1)

    dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
    advancedTools = dialog.getByRole('region', { name: '高度ツール' })
    selectionPanel = advancedTools.getByRole('tabpanel', {
      name: '選択範囲',
    })
    await selectionPanel.getByRole('button', { name: '解除' }).click()
    await expect(
      advancedTools.getByText('選択範囲を解除しました。', { exact: true }),
    ).toBeVisible()
    await closeStudio(page, dialog)

    await expect(
      page.locator('.canvas-viewport canvas.lower-canvas'),
    ).toHaveScreenshot('magic-wand-feather-filter-canvas.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    })
  })

  test('4096×4096の自動選択を専用Workerへ転送する', async ({ page }) => {
    test.setTimeout(120_000)
    await createSmallCanvas(page, '4096 worker selection E2E', 4096, 4096)
    await addColoredRectangle(page, '#2563eb')

    await page.evaluate(`(() => {
      const NativeWorker = globalThis.Worker
      globalThis.__pixelweaveSelectionWorkerJobs = []
      class TrackedWorker extends NativeWorker {
        constructor(url, options) {
          super(url, options)
          this.__pixelweaveWorkerUrl = String(url)
        }
        postMessage(message, transfer) {
          if (message?.type === 'run' && message.job?.kind === 'flood-fill') {
            globalThis.__pixelweaveSelectionWorkerJobs.push({
              url: this.__pixelweaveWorkerUrl,
              kind: message.job.kind,
              width: message.job.image?.width,
              height: message.job.image?.height,
              byteLength: message.job.image?.data?.byteLength,
            })
          }
          if (transfer === undefined) super.postMessage(message)
          else super.postMessage(message, transfer)
        }
      }
      globalThis.Worker = TrackedWorker
    })()`)

    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
    const advancedTools = dialog.getByRole('region', { name: '高度ツール' })
    const selectionPanel = advancedTools.getByRole('tabpanel', {
      name: '選択範囲',
    })
    await selectionPanel.getByLabel('X座標').fill('0')
    await selectionPanel.getByLabel('Y座標').fill('0')
    await selectionPanel.getByLabel('許容値').fill('0')
    expect(await startLongTaskObservation(page)).toBe(true)
    await selectionPanel.getByRole('button', { name: '自動選択を実行' }).click()
    await advancedTools.getByRole('tab', { name: '背景除去' }).click()
    await expect(
      advancedTools.getByRole('tab', { name: '背景除去' }),
    ).toHaveAttribute('aria-selected', 'true')
    await advancedTools.getByRole('tab', { name: '選択範囲' }).click()
    await expect(
      advancedTools.getByText('自動選択を更新しました。', { exact: true }),
    ).toBeVisible({ timeout: 90_000 })
    const longTasks = await stopLongTaskObservation(page)
    expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(200)

    const workerJobs = await page.evaluate<
      Array<{
        url: string
        kind: string
        width: number
        height: number
        byteLength: number
      }>
    >(`globalThis.__pixelweaveSelectionWorkerJobs`)
    expect(workerJobs).toEqual([
      expect.objectContaining({
        url: expect.stringContaining('selection.worker'),
        kind: 'flood-fill',
        width: 4096,
        height: 4096,
        byteLength: 4096 * 4096 * 4,
      }),
    ])
  })

  test('キャンバスから主要色を抽出し、配色提案と塗り・縁取りへ適用する', async ({
    page,
  }) => {
    await createSmallCanvas(page, 'Palette E2E')
    await addColoredRectangle(page, '#123456')

    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: 'ロゴ生成' }).click()
    const logoPanel = dialog.getByRole('tabpanel', { name: 'ロゴ生成' })
    await logoPanel
      .getByRole('button', { name: '現在のキャンバスから色を抽出' })
      .click()

    await expect(
      logoPanel.getByText(/現在のキャンバスから\d+色を抽出しました。/u),
    ).toBeVisible()
    const extractedColor = logoPanel.getByRole('button', {
      name: /抽出色 #123456.*ロゴ候補へ適用/iu,
    })
    await expect(extractedColor).toBeVisible()
    await extractedColor.click()
    await expect(extractedColor).toHaveAttribute('aria-pressed', 'true')

    await logoPanel
      .getByRole('button', { name: 'トライアドの配色を選択' })
      .click()
    await expect(logoPanel.getByLabel('配色ルール')).toHaveValue('triadic')

    await logoPanel.getByRole('button', { name: '選択色を塗りに適用' }).click()
    await expect(
      logoPanel.getByText('#123456を選択オブジェクトの塗りに適用しました。', {
        exact: true,
      }),
    ).toBeVisible()
    await logoPanel
      .getByRole('button', { name: '選択色を縁取りに適用' })
      .click()
    await expect(
      logoPanel.getByText('#123456を選択オブジェクトの縁取りに適用しました。', {
        exact: true,
      }),
    ).toBeVisible()
  })

  test('生成ロゴを通常レイヤーへ挿入し、7種のアイコンPNGへ一括出力する', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await createSmallCanvas(page, 'Logo icon E2E', 128, 128)
    let dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: 'ロゴ生成' }).click()
    const logoPanel = dialog.getByRole('tabpanel', { name: 'ロゴ生成' })
    await logoPanel.getByLabel('名称').fill('Orbit Seven')
    await logoPanel.getByLabel('イニシャル').fill('O7')
    await logoPanel.getByRole('button', { name: '候補を生成' }).click()
    await logoPanel.getByRole('button', { name: /^候補 1:/u }).click()
    await logoPanel.getByRole('button', { name: '選択した候補を挿入' }).click()
    await expect(logoPanel.getByRole('status')).toContainText('挿入しました')
    await closeStudio(page, dialog)

    const layerItems = page
      .getByRole('list', { name: 'レイヤー' })
      .getByRole('listitem')
    await expect.poll(() => layerItems.count()).toBeGreaterThan(0)
    await expect(
      page
        .getByRole('complementary', { name: 'インスペクター' })
        .getByRole('slider')
        .first(),
    ).toBeVisible()

    dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '自動化・バッチ' }).click()
    await dialog.getByRole('tab', { name: 'アイコン書き出し' }).click()
    const iconPanel = dialog.getByRole('tabpanel', {
      name: 'アイコン書き出し',
    })
    await expect(
      iconPanel.getByRole('checkbox', { name: /^Favicon 16/u }),
    ).toBeChecked()
    await expect(
      iconPanel.getByRole('checkbox', { name: /^OGP 1200 × 630/u }),
    ).toBeChecked()
    await iconPanel.getByLabel('保存方法').selectOption('zip')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      iconPanel
        .getByRole('button', { name: '選択したプリセットを書き出し' })
        .click(),
    ])
    expect(download.suggestedFilename()).toMatch(/-icons\.zip$/u)
    const downloadPath = await download.path()
    expect(downloadPath).not.toBeNull()
    const entries = readStoredZipEntries(await readFile(downloadPath!))
    const expectedDimensions = new Map<string, [number, number]>([
      ['favicon-16.png', [16, 16]],
      ['favicon-32.png', [32, 32]],
      ['favicon-48.png', [48, 48]],
      ['pwa-192.png', [192, 192]],
      ['pwa-512.png', [512, 512]],
      ['apple-touch-icon.png', [180, 180]],
      ['ogp.png', [1200, 630]],
    ])
    expect(entries.map(({ name }) => name).sort()).toEqual(
      [...expectedDimensions.keys()].sort(),
    )
    for (const entry of entries) {
      const [width, height] = expectedDimensions.get(entry.name)!
      expect(readPngDimensions(entry.data)).toEqual({ width, height })
    }
  })

  test('詳細フィルターのパラメーターUIを画像比較する', async ({
    page,
  }, testInfo) => {
    testInfo.snapshotSuffix = ''
    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
    const filterPanel = dialog.getByRole('region', {
      name: '詳細フィルター',
    })
    const preview = filterPanel.getByRole('region', {
      name: '実画像フィルタープレビュー',
    })
    await filterPanel
      .getByRole('checkbox', { name: 'レベル補正を有効化' })
      .check()
    await filterPanel.getByLabel('入力ブラック').fill('24')
    await filterPanel.getByLabel('ガンマ').fill('1.25')
    await expect(preview).toHaveAttribute('aria-busy', 'true')
    await expect(preview).toHaveAttribute('aria-busy', 'false')
    await expect(
      preview.getByRole('img', { name: 'フィルター適用後のプレビュー' }),
    ).toBeVisible()

    const levels = filterPanel.locator('[data-filter-id="levels"]')
    await levels.scrollIntoViewIfNeeded()

    await expect(levels).toHaveScreenshot('advanced-levels-filter.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.05,
      threshold: 0.25,
    })
  })

  test('背景モデルは明示同意と実行操作の後だけ取得を開始する', async ({
    page,
  }) => {
    let modelRequests = 0
    await page.route(MODEL_URL, async (route) => {
      modelRequests += 1
      await route.fulfill({
        status: 503,
        contentType: 'application/octet-stream',
        body: 'mocked model unavailable',
      })
    })
    await createSmallCanvas(page, 'Consent E2E')
    await addColoredRectangle(page, '#22c55e')

    const dialog = await openStudio(page)
    await dialog.getByRole('tab', { name: '選択・背景・スクリプト' }).click()
    const advancedTools = dialog.getByRole('region', { name: '高度ツール' })
    await advancedTools.getByRole('tab', { name: '背景除去' }).click()
    const backgroundPanel = advancedTools.getByRole('tabpanel', {
      name: '背景除去',
    })
    const removeBackground = backgroundPanel.getByRole('button', {
      name: '背景を除去',
    })

    await expect(
      backgroundPanel.getByRole('checkbox', {
        name: 'ローカルAIモデルを使用する',
      }),
    ).toBeChecked()
    await expect(removeBackground).toBeDisabled()
    expect(modelRequests).toBe(0)

    await backgroundPanel
      .getByRole('checkbox', {
        name: '表示されたモデルを端末内で取得・実行することに同意する',
      })
      .check()
    await expect(removeBackground).toBeEnabled()
    expect(modelRequests).toBe(0)

    await removeBackground.click()
    await expect.poll(() => modelRequests).toBe(1)
    await expect(
      advancedTools.getByText(
        /モデル処理に失敗したため簡易推定を使用しました。/u,
      ),
    ).toBeVisible()
    expect(modelRequests).toBe(1)
  })
})
