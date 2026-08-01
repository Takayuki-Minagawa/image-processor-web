import { parseDesignTemplate, type ParsedDesignTemplate } from './schema'

export const DESIGN_TEMPLATE_PACK_SCHEMA_VERSION = 1 as const

export interface DesignTemplateCatalogEntry {
  id: string
  packId: string
  name: string
  localizedName?: string
  category: string
  tags: readonly string[]
  width: number
  height: number
  pageCount: number
}

export interface DesignTemplatePack {
  schemaVersion: typeof DESIGN_TEMPLATE_PACK_SCHEMA_VERSION
  id: string
  templates: readonly unknown[]
}

export interface DesignTemplatePackManifest {
  id: string
  templateCount: number
  load: () => Promise<DesignTemplatePack>
}

const isSlug = (value: string): boolean =>
  /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value)

export class DesignTemplateRegistry {
  readonly #catalog: readonly DesignTemplateCatalogEntry[]
  readonly #entries = new Map<string, DesignTemplateCatalogEntry>()
  readonly #manifests = new Map<string, DesignTemplatePackManifest>()
  readonly #packs = new Map<
    string,
    Promise<Map<string, ParsedDesignTemplate>>
  >()

  constructor(
    catalog: readonly DesignTemplateCatalogEntry[],
    manifests: readonly DesignTemplatePackManifest[],
  ) {
    this.#catalog = [...catalog]
    for (const manifest of manifests) {
      if (
        !isSlug(manifest.id) ||
        this.#manifests.has(manifest.id) ||
        !Number.isSafeInteger(manifest.templateCount) ||
        manifest.templateCount < 1
      ) {
        throw new TypeError(`Invalid template pack manifest: ${manifest.id}`)
      }
      this.#manifests.set(manifest.id, manifest)
    }
    const counts = new Map<string, number>()
    for (const entry of catalog) {
      if (
        !isSlug(entry.id) ||
        this.#entries.has(entry.id) ||
        !this.#manifests.has(entry.packId)
      ) {
        throw new TypeError(`Invalid template catalog entry: ${entry.id}`)
      }
      this.#entries.set(entry.id, entry)
      counts.set(entry.packId, (counts.get(entry.packId) ?? 0) + 1)
    }
    for (const manifest of manifests) {
      if (counts.get(manifest.id) !== manifest.templateCount) {
        throw new TypeError(
          `${manifest.id} template count does not match its index.`,
        )
      }
    }
  }

  list(): readonly DesignTemplateCatalogEntry[] {
    return this.#catalog
  }

  getEntry(id: string): DesignTemplateCatalogEntry | undefined {
    return this.#entries.get(id)
  }

  search(query: string, category?: string): DesignTemplateCatalogEntry[] {
    const normalized = query.normalize('NFKC').trim().toLocaleLowerCase()
    return this.#catalog.filter((entry) => {
      if (category !== undefined && entry.category !== category) return false
      if (!normalized) return true
      const haystack = [
        entry.name,
        entry.localizedName ?? '',
        entry.category,
        ...entry.tags,
      ]
        .join(' ')
        .normalize('NFKC')
        .toLocaleLowerCase()
      return normalized.split(/\s+/u).every((token) => haystack.includes(token))
    })
  }

  async loadTemplate(id: string): Promise<ParsedDesignTemplate> {
    const entry = this.#entries.get(id)
    if (!entry) throw new RangeError(`Unknown design template: ${id}`)
    const template = (await this.#loadPack(entry.packId)).get(id)
    if (!template) {
      throw new TypeError(
        `${entry.packId} does not contain indexed template ${id}.`,
      )
    }
    return template
  }

  #loadPack(packId: string): Promise<Map<string, ParsedDesignTemplate>> {
    const cached = this.#packs.get(packId)
    if (cached) return cached
    const manifest = this.#manifests.get(packId)
    if (!manifest)
      return Promise.reject(new RangeError(`Unknown pack: ${packId}`))
    const promise = manifest.load().then((pack) => {
      if (
        pack.schemaVersion !== DESIGN_TEMPLATE_PACK_SCHEMA_VERSION ||
        pack.id !== manifest.id ||
        pack.templates.length !== manifest.templateCount
      ) {
        throw new TypeError(`${manifest.id} does not match its manifest.`)
      }
      const parsed = new Map<string, ParsedDesignTemplate>()
      for (const source of pack.templates) {
        const result = parseDesignTemplate(source)
        const entry = this.#entries.get(result.template.id)
        if (
          !entry ||
          entry.packId !== pack.id ||
          parsed.has(result.template.id)
        ) {
          throw new TypeError(
            `${pack.id} contains an unknown or duplicate template.`,
          )
        }
        if (
          entry.width !== result.template.document.width ||
          entry.height !== result.template.document.height ||
          entry.pageCount !== result.template.document.pages.length
        ) {
          throw new TypeError(
            `${entry.id} metadata does not match its template.`,
          )
        }
        parsed.set(result.template.id, result)
      }
      return parsed
    })
    this.#packs.set(packId, promise)
    return promise
  }
}
