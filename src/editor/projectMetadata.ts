import type { JsonObject } from './types'

/** Shared by actual saves and the pre-commit PDF import size check. */
export const createEditorProjectMetadata = (
  name: string,
  createdAt: string,
  sourceFileName?: string,
): JsonObject => ({
  name: name.trim() || '無題のデザイン',
  createdAt,
  ...(sourceFileName ? { sourceFileName } : {}),
})
