import {
  getActiveProjectPage,
  validateProjectDocument,
  validateProjectPage,
} from './project'
import type {
  JsonObject,
  ProjectCanvasSize,
  ProjectDocument,
  ProjectEditorState,
  ProjectLayerTree,
  ProjectPage,
  ProjectPageBackground,
  ProjectPagePhysicalSize,
  ProjectPageTimeline,
} from './types'

export interface CreateProjectPageInput {
  id?: string
  name?: string
  canvasSize: ProjectCanvasSize
  fabricCanvas?: JsonObject
  editorState?: Partial<ProjectEditorState>
  layerTree?: ProjectLayerTree
  background?: ProjectPageBackground
  physicalSize?: ProjectPagePhysicalSize
  timeline?: ProjectPageTimeline
  thumbnail?: string
}

export interface ActivePageView {
  canvasSize: ProjectCanvasSize
  fabricCanvas: JsonObject
  editorState: ProjectEditorState
  layerTree?: ProjectLayerTree
  background?: ProjectPageBackground
  physicalSize?: ProjectPagePhysicalSize
  timeline?: ProjectPageTimeline
  thumbnail?: string
}

export interface DocumentMutationOptions {
  updatedAt?: string
}

export interface AddPageOptions extends DocumentMutationOptions {
  activate?: boolean
  index?: number
}

export type ProjectPageExportScope =
  | { kind: 'active' }
  | { kind: 'all' }
  | { kind: 'selected'; pageIds: readonly string[] }

let fallbackPageCounter = 0

const createPageId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `page-${globalThis.crypto.randomUUID()}`
  }
  fallbackPageCounter += 1
  return `page-${Date.now().toString(36)}-${fallbackPageCounter.toString(36)}`
}

const mutationTimestamp = (options: DocumentMutationOptions): string =>
  options.updatedAt ?? new Date().toISOString()

const nextPageName = (pages: readonly ProjectPage[]): string => {
  const names = new Set(pages.map(({ name }) => name))
  let sequence = pages.length + 1
  while (names.has(`Page ${sequence}`)) sequence += 1
  return `Page ${sequence}`
}

export const createProjectPage = (input: CreateProjectPageInput): ProjectPage =>
  validateProjectPage({
    id: input.id ?? createPageId(),
    name: input.name ?? 'Page 1',
    canvasSize: input.canvasSize,
    fabricCanvas: input.fabricCanvas ?? { objects: [] },
    editorState: {
      guides: [],
      snapTolerance: 8,
      ...input.editorState,
    },
    ...(input.layerTree === undefined ? {} : { layerTree: input.layerTree }),
    ...(input.background === undefined ? {} : { background: input.background }),
    ...(input.physicalSize === undefined
      ? {}
      : { physicalSize: input.physicalSize }),
    ...(input.timeline === undefined ? {} : { timeline: input.timeline }),
    ...(input.thumbnail === undefined ? {} : { thumbnail: input.thumbnail }),
  })

const replaceDocumentPages = (
  project: ProjectDocument,
  pages: ProjectPage[],
  activePageId: string,
  options: DocumentMutationOptions,
): ProjectDocument =>
  validateProjectDocument({
    appId: project.appId,
    schemaVersion: project.schemaVersion,
    pages,
    activePageId,
    metadata: project.metadata,
    updatedAt: mutationTimestamp(options),
  })

/**
 * Commits the currently enlivened canvas into its canonical page record. This
 * is the bridge used before page switching, autosave, or full-document export.
 */
export const synchronizeActivePage = (
  project: ProjectDocument,
  view: ActivePageView = {
    canvasSize: project.canvasSize,
    fabricCanvas: project.fabricCanvas,
    editorState: project.editorState,
  },
  options: DocumentMutationOptions = {},
): ProjectDocument => {
  const activePage = getActiveProjectPage(project)
  const candidate: ProjectPage = {
    ...activePage,
    canvasSize: view.canvasSize,
    fabricCanvas: view.fabricCanvas,
    editorState: view.editorState,
    layerTree: view.layerTree ?? activePage.layerTree,
    background: view.background ?? activePage.background,
    physicalSize: view.physicalSize ?? activePage.physicalSize,
  }
  if (Object.hasOwn(view, 'timeline')) {
    if (view.timeline === undefined) delete candidate.timeline
    else candidate.timeline = view.timeline
  }
  if (Object.hasOwn(view, 'thumbnail')) {
    if (view.thumbnail === undefined) delete candidate.thumbnail
    else candidate.thumbnail = view.thumbnail
  }
  const replacement = validateProjectPage(candidate)
  return replaceDocumentPages(
    project,
    project.pages.map((page) =>
      page.id === project.activePageId ? replacement : page,
    ),
    project.activePageId,
    options,
  )
}

export const activateProjectPage = (
  project: ProjectDocument,
  pageId: string,
  options: DocumentMutationOptions = {},
): ProjectDocument => {
  if (!project.pages.some((page) => page.id === pageId)) {
    throw new RangeError(`Page "${pageId}" does not exist.`)
  }
  if (project.activePageId === pageId) return project
  return replaceDocumentPages(project, project.pages, pageId, options)
}

export const addProjectPage = (
  project: ProjectDocument,
  input: CreateProjectPageInput,
  options: AddPageOptions = {},
): ProjectDocument => {
  const page = createProjectPage({
    ...input,
    name: input.name ?? nextPageName(project.pages),
  })
  if (project.pages.some(({ id }) => id === page.id)) {
    throw new RangeError(`Page id "${page.id}" is already in use.`)
  }
  const index = options.index ?? project.pages.length
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > project.pages.length
  ) {
    throw new RangeError('The page insertion index is outside the document.')
  }
  const pages = [...project.pages]
  pages.splice(index, 0, page)
  return replaceDocumentPages(
    project,
    pages,
    options.activate === false ? project.activePageId : page.id,
    options,
  )
}

export const duplicateProjectPage = (
  project: ProjectDocument,
  pageId: string = project.activePageId,
  options: AddPageOptions = {},
): ProjectDocument => {
  const sourceIndex = project.pages.findIndex((page) => page.id === pageId)
  if (sourceIndex < 0) {
    throw new RangeError(`Page "${pageId}" does not exist.`)
  }
  const source = project.pages[sourceIndex]
  const copy = structuredClone(source) as ProjectPage
  copy.id = createPageId()
  copy.name = `${source.name} copy`
  delete copy.thumbnail
  return addProjectPage(project, copy, {
    ...options,
    index: options.index ?? sourceIndex + 1,
  })
}

export const deleteProjectPage = (
  project: ProjectDocument,
  pageId: string,
  options: DocumentMutationOptions = {},
): ProjectDocument => {
  if (project.pages.length === 1) {
    throw new RangeError('A design document must keep at least one page.')
  }
  const index = project.pages.findIndex((page) => page.id === pageId)
  if (index < 0) {
    throw new RangeError(`Page "${pageId}" does not exist.`)
  }
  const pages = project.pages.filter((page) => page.id !== pageId)
  const activePageId =
    project.activePageId === pageId
      ? pages[Math.min(index, pages.length - 1)].id
      : project.activePageId
  return replaceDocumentPages(project, pages, activePageId, options)
}

export const reorderProjectPage = (
  project: ProjectDocument,
  pageId: string,
  targetIndex: number,
  options: DocumentMutationOptions = {},
): ProjectDocument => {
  const sourceIndex = project.pages.findIndex((page) => page.id === pageId)
  if (sourceIndex < 0) {
    throw new RangeError(`Page "${pageId}" does not exist.`)
  }
  if (
    !Number.isSafeInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= project.pages.length
  ) {
    throw new RangeError('The target page index is outside the document.')
  }
  if (sourceIndex === targetIndex) return project
  const pages = [...project.pages]
  const [page] = pages.splice(sourceIndex, 1)
  pages.splice(targetIndex, 0, page)
  return replaceDocumentPages(project, pages, project.activePageId, options)
}

export const setProjectPageBackground = (
  project: ProjectDocument,
  pageId: string,
  background: ProjectPageBackground,
  options: DocumentMutationOptions = {},
): ProjectDocument => {
  let found = false
  const pages = project.pages.map((page) => {
    if (page.id !== pageId) return page
    found = true
    return validateProjectPage({ ...page, background })
  })
  if (!found) {
    throw new RangeError(`Page "${pageId}" does not exist.`)
  }
  return replaceDocumentPages(project, pages, project.activePageId, options)
}

export const updateProjectPageLayerTree = (
  project: ProjectDocument,
  pageId: string,
  layerTree: ProjectLayerTree,
  options: DocumentMutationOptions = {},
): ProjectDocument => {
  let found = false
  const pages = project.pages.map((page) => {
    if (page.id !== pageId) return page
    found = true
    return validateProjectPage({ ...page, layerTree })
  })
  if (!found) {
    throw new RangeError(`Page "${pageId}" does not exist.`)
  }
  return replaceDocumentPages(project, pages, project.activePageId, options)
}

export const setProjectPageTimeline = (
  project: ProjectDocument,
  pageId: string,
  timeline: ProjectPageTimeline | null,
  options: DocumentMutationOptions = {},
): ProjectDocument => {
  let found = false
  const pages = project.pages.map((page) => {
    if (page.id !== pageId) return page
    found = true
    const candidate = { ...page }
    if (timeline === null) delete candidate.timeline
    else candidate.timeline = timeline
    return validateProjectPage(candidate)
  })
  if (!found) {
    throw new RangeError(`Page "${pageId}" does not exist.`)
  }
  return replaceDocumentPages(project, pages, project.activePageId, options)
}

export const projectPagesForExport = (
  project: ProjectDocument,
  scope: ProjectPageExportScope,
): ProjectPage[] => {
  if (scope.kind === 'active') return [getActiveProjectPage(project)]
  if (scope.kind === 'all') return [...project.pages]
  const selected = new Set(scope.pageIds)
  const pages = project.pages.filter((page) => selected.has(page.id))
  if (pages.length !== selected.size || pages.length === 0) {
    throw new RangeError('The export page selection is empty or invalid.')
  }
  return pages
}
