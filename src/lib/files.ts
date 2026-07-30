import { IMAGE_HEADER_READ_BYTES, parseImageDimensions } from './imageMetadata'
import {
  MAX_IMAGE_BYTES,
  imageDimensionsAreSafe,
  SUPPORTED_IMAGE_MIME_TYPES,
} from './imageSafety'

const IMAGE_TYPES = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES)

export const MAX_PROJECT_BYTES = 100 * 1024 * 1024

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

const matchesPng = (bytes: Uint8Array): boolean =>
  bytes.length >= 8 &&
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
    (value, index) => bytes[index] === value,
  )

const matchesJpeg = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 &&
  bytes[0] === 0xff &&
  bytes[1] === 0xd8 &&
  bytes[2] === 0xff

const matchesWebp = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 &&
  new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'RIFF' &&
  new TextDecoder('ascii').decode(bytes.slice(8, 12)) === 'WEBP'

export async function validateImageHeader(file: File): Promise<void> {
  if (!IMAGE_TYPES.has(file.type)) {
    throw new FileValidationError(
      'PNG、JPEG、WebPのいずれかを選択してください。',
    )
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new FileValidationError('画像は50 MB以下にしてください。')
  }

  const bytes = new Uint8Array(
    await file
      .slice(0, Math.min(file.size, IMAGE_HEADER_READ_BYTES))
      .arrayBuffer(),
  )
  const valid =
    (file.type === 'image/png' && matchesPng(bytes)) ||
    (file.type === 'image/jpeg' && matchesJpeg(bytes)) ||
    (file.type === 'image/webp' && matchesWebp(bytes))

  if (!valid) {
    throw new FileValidationError(
      'ファイルの内容と画像形式が一致しません。安全のため読み込みを中止しました。',
    )
  }

  const declaredDimensions = parseImageDimensions(bytes, file.type)
  if (!declaredDimensions) {
    throw new FileValidationError('画像の寸法を安全に確認できませんでした。')
  }

  if (!imageDimensionsAreSafe(declaredDimensions)) {
    throw new FileValidationError(
      '画像寸法が上限（各辺8,192 px、合計64 MP）を超えています。',
    )
  }
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new FileValidationError('画像を読み込めませんでした。'))
      }
    })
    reader.addEventListener('error', () => {
      reject(
        reader.error ?? new FileValidationError('画像を読み込めませんでした。'),
      )
    })
    reader.readAsDataURL(file)
  })
}

export function sanitizeFileStem(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)

  return normalized || 'untitled'
}

export function downloadUrl(url: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.click()
}

export function downloadText(
  source: string,
  fileName: string,
  type = 'application/json',
): void {
  const url = URL.createObjectURL(new Blob([source], { type }))
  try {
    downloadUrl(url, fileName)
  } finally {
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
