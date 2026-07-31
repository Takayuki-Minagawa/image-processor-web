import type { AppLocale } from '../uiPreferences'

interface ManualCopy {
  steps: Array<{ title: string; description: string }>
  privacyTitle: string
  privacy: string
}

const MANUAL_COPY: Record<AppLocale, ManualCopy> = {
  ja: {
    steps: [
      {
        title: '1. 画像を開く、または新規作成',
        description:
          '「開く」で画像やプロジェクトを読み込むか、「新規」で空のキャンバスを作成します。画像を画面へドラッグ&ドロップすることもできます。',
      },
      {
        title: '2. ツールとレイヤーで編集',
        description:
          '左のツールで選択・描画・テキストを追加し、右のパネルでレイヤーや画像調整を行います。',
      },
      {
        title: '3. プロジェクトを保存',
        description:
          '「保存」で編集を .pwx.json プロジェクトとして保存します。大切な編集は明示的に保存してください。',
      },
      {
        title: '4. 画像を書き出す',
        description:
          '「書き出す」から PNG、JPG、WebP、SVG を選び、完成画像を端末へダウンロードします。',
      },
    ],
    privacyTitle: '端末内での処理について',
    privacy:
      '通常の画像編集はブラウザ内で処理されます。背景除去モデルは、画面で同意した場合にだけ取得しますが、画像そのものを取得先へ送信しません。',
  },
  en: {
    steps: [
      {
        title: '1. Open an image or start a canvas',
        description:
          'Use Open to load an image or project, or New to start with a blank canvas. You can also drag and drop an image into the editor.',
      },
      {
        title: '2. Edit with tools and layers',
        description:
          'Use the tools on the left to select, draw, and add text. Use the right-hand panel to manage layers and make image adjustments.',
      },
      {
        title: '3. Save the project',
        description:
          'Choose Save to store your work as a .pwx.json project. Explicitly save important work.',
      },
      {
        title: '4. Export the finished image',
        description:
          'Choose Export, then select PNG, JPG, WebP, or SVG to download the finished image to your device.',
      },
    ],
    privacyTitle: 'About local processing',
    privacy:
      'Normal image edits are processed in your browser. A background-removal model is downloaded only after you consent in the app; your image itself is not sent to the download source.',
  },
}

export default function ManualContent({ locale }: { locale: AppLocale }) {
  const copy = MANUAL_COPY[locale]

  return (
    <div className="manual-content">
      <ol className="manual-steps">
        {copy.steps.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
      <aside className="manual-privacy-note">
        <span aria-hidden="true">⌑</span>
        <div>
          <strong>{copy.privacyTitle}</strong>
          <p>{copy.privacy}</p>
        </div>
      </aside>
    </div>
  )
}
