import { describe, expect, it } from 'vitest'
import {
  activateProjectPage,
  addProjectPage,
  deleteProjectPage,
  duplicateProjectPage,
  projectPagesForExport,
  reorderProjectPage,
  setProjectPageBackground,
  setProjectPageTimeline,
  synchronizeActivePage,
} from './designDocument'
import {
  createProjectDocument,
  parseProject,
  serializeProject,
} from './project'
import type { ProjectLayerNode } from './types'

const timestamp = '2026-08-01T00:00:00.000Z'
const later = '2026-08-01T00:01:00.000Z'

const project = () =>
  createProjectDocument({
    canvasSize: { width: 1080, height: 1080 },
    fabricCanvas: { objects: [] },
    metadata: { name: 'Pages', createdAt: timestamp },
    updatedAt: timestamp,
  })

describe('design document page operations', () => {
  it('adds, activates, reorders, and deletes pages while keeping aliases in sync', () => {
    const added = addProjectPage(
      project(),
      {
        id: 'story',
        canvasSize: { width: 1080, height: 1920 },
      },
      { updatedAt: later },
    )
    expect(added.pages.map(({ id }) => id)).toEqual(['page-1', 'story'])
    expect(added.activePageId).toBe('story')
    expect(added.canvasSize).toBe(added.pages[1].canvasSize)
    expect(added.updatedAt).toBe(later)

    const reordered = reorderProjectPage(added, 'story', 0, {
      updatedAt: later,
    })
    expect(reordered.pages.map(({ id }) => id)).toEqual(['story', 'page-1'])

    const activated = activateProjectPage(reordered, 'page-1', {
      updatedAt: later,
    })
    expect(activated.fabricCanvas).toBe(activated.pages[1].fabricCanvas)

    const deleted = deleteProjectPage(activated, 'page-1', {
      updatedAt: later,
    })
    expect(deleted.activePageId).toBe('story')
    expect(deleted.pages).toHaveLength(1)
    expect(() => deleteProjectPage(deleted, 'story')).toThrow(/at least one/)
  })

  it('duplicates a page as an independent renderer payload', () => {
    const original = project()
    const duplicated = duplicateProjectPage(original, 'page-1', {
      updatedAt: later,
    })

    expect(duplicated.pages).toHaveLength(2)
    expect(duplicated.pages[1].id).not.toBe('page-1')
    expect(duplicated.pages[1].name).toBe('Page 1 copy')
    expect(duplicated.pages[1].fabricCanvas).toEqual(
      duplicated.pages[0].fabricCanvas,
    )
    expect(duplicated.pages[1].fabricCanvas).not.toBe(
      duplicated.pages[0].fabricCanvas,
    )
  })

  it('commits the active Fabric snapshot into the canonical page before switching', () => {
    const base = project()
    const node: ProjectLayerNode = {
      id: 'photo',
      name: 'Photo',
      kind: 'layer',
      layerType: 'image',
      visible: true,
      locked: false,
      opacity: 1,
    }
    const synchronized = synchronizeActivePage(
      base,
      {
        canvasSize: { width: 1200, height: 628 },
        fabricCanvas: {
          objects: [{ type: 'Image', editorId: 'photo' }],
        },
        editorState: { guides: [], snapTolerance: 6 },
        layerTree: [node],
        background: { kind: 'color', color: '#112233' },
      },
      { updatedAt: later },
    )

    expect(synchronized.pages[0]).toMatchObject({
      canvasSize: { width: 1200, height: 628 },
      editorState: { snapTolerance: 6 },
      layerTree: [{ id: 'photo' }],
      background: { kind: 'color', color: '#112233' },
    })
    expect(synchronized.fabricCanvas).toBe(synchronized.pages[0].fabricCanvas)
    expect(parseProject(serializeProject(synchronized))).toEqual(synchronized)
  })

  it('updates page backgrounds and resolves export ranges in page order', () => {
    const added = addProjectPage(project(), {
      id: 'second',
      canvasSize: { width: 800, height: 600 },
    })
    const updated = setProjectPageBackground(
      added,
      'page-1',
      {
        kind: 'gradient',
        gradientType: 'linear',
        angle: 45,
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#ffffff' },
        ],
      },
      { updatedAt: later },
    )

    expect(projectPagesForExport(updated, { kind: 'active' })).toEqual([
      updated.pages[1],
    ])
    expect(
      projectPagesForExport(updated, {
        kind: 'selected',
        pageIds: ['page-1', 'second'],
      }).map(({ id }) => id),
    ).toEqual(['page-1', 'second'])
    expect(() =>
      projectPagesForExport(updated, {
        kind: 'selected',
        pageIds: ['missing'],
      }),
    ).toThrow(/invalid/)
  })

  it('sets and removes the optional schema-v4 timeline', () => {
    const base = project()
    const animated = setProjectPageTimeline(
      base,
      'page-1',
      {
        durationMs: 1_000,
        elements: {},
      },
      { updatedAt: later },
    )
    expect(animated.pages[0].timeline).toEqual({
      durationMs: 1_000,
      elements: {},
    })

    const staticProject = setProjectPageTimeline(animated, 'page-1', null, {
      updatedAt: later,
    })
    expect(staticProject.pages[0]).not.toHaveProperty('timeline')
  })
})
