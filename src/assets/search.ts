import type { AssetCatalogEntry, AssetSearchOptions } from './types'

export const normalizeAssetSearchText = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

const scoreEntry = (entry: AssetCatalogEntry, query: string): number => {
  if (query.length === 0) return 1
  const names = [entry.name.en, entry.name.ja].map(normalizeAssetSearchText)
  const tags = [entry.tags.en, entry.tags.ja].map(normalizeAssetSearchText)
  const tokens = query.split(' ').filter(Boolean)
  let score = 0

  for (const token of tokens) {
    const exactName = names.some((name) => name === token)
    const prefixedName = names.some((name) => name.startsWith(token))
    const nameContains = names.some((name) => name.includes(token))
    const tagContains = tags.some((tag) => tag.includes(token))
    if (!exactName && !prefixedName && !nameContains && !tagContains) {
      return 0
    }
    score += exactName ? 100 : prefixedName ? 60 : nameContains ? 35 : 15
  }

  return score
}

export function searchAssetCatalog(
  entries: readonly AssetCatalogEntry[],
  query: string,
  options: AssetSearchOptions = {},
): AssetCatalogEntry[] {
  const normalizedQuery = normalizeAssetSearchText(query)
  const acceptedKinds = options.kinds && new Set(options.kinds)
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)))

  return entries
    .filter(
      (entry) =>
        (!acceptedKinds || acceptedKinds.has(entry.kind)) &&
        (options.category === undefined || entry.category === options.category),
    )
    .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.entry.order ?? Number.MAX_SAFE_INTEGER) -
          (b.entry.order ?? Number.MAX_SAFE_INTEGER) ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, limit)
    .map(({ entry }) => entry)
}
