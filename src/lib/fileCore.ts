export const MAX_PROJECT_BYTES = 100 * 1024 * 1024

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
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
