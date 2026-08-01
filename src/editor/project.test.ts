import { describe, expect, it } from 'vitest'
import {
  ProjectFormatError,
  createProjectDocument,
  parseProject,
  serializeProject,
  validateProjectDocument,
} from './project'
import {
  PROJECT_APP_ID,
  PROJECT_SCHEMA_VERSION,
  type ProjectDocument,
} from './types'
import { SelectionMask } from '../selection/mask'
import { encodeSelectionMaskForProject } from '../selection/codec'
import legacyProjectV1 from './fixtures/project-v1.pwx.json?raw'
import { designSizeToPixels } from './designPresets'

const timestamp = '2026-07-30T03:00:00.000Z'

const makeProject = (): ProjectDocument =>
  createProjectDocument({
    canvasSize: { width: 1280, height: 720 },
    fabricCanvas: {
      version: '7.4.0',
      objects: [{ type: 'Rect', left: 20, visible: true }],
    },
    metadata: {
      name: 'Sample',
      createdAt: timestamp,
      sourceFileName: 'photo.png',
      tags: ['test', 'mvp'],
    },
    updatedAt: timestamp,
  })

describe('project schema', () => {
  it('creates the stable versioned envelope with metadata defaults', () => {
    const project = createProjectDocument({
      canvasSize: { width: 640, height: 480 },
      editorState: {
        guides: [],
        snapTolerance: 8,
      },
      fabricCanvas: { objects: [] },
      updatedAt: timestamp,
    })

    expect(project).toMatchObject({
      appId: PROJECT_APP_ID,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      canvasSize: { width: 640, height: 480 },
      metadata: {
        name: 'Untitled project',
        createdAt: timestamp,
      },
      updatedAt: timestamp,
    })
  })

  it('round-trips a project without losing Fabric JSON or metadata', () => {
    const project = makeProject()
    expect(parseProject(serializeProject(project))).toEqual(project)
  })

  it('round-trips print dimensions and rejects metadata that mismatches pixels', () => {
    const canvasSize = designSizeToPixels(210, 297, 'mm', 300)
    const project = createProjectDocument({
      canvasSize,
      fabricCanvas: { objects: [] },
      physicalSize: {
        unit: 'mm',
        widthMm: 210,
        heightMm: 297,
        sourceDpi: 300,
      },
      updatedAt: timestamp,
    })

    expect(
      parseProject(serializeProject(project)).pages[0].physicalSize,
    ).toEqual({
      unit: 'mm',
      widthMm: 210,
      heightMm: 297,
      sourceDpi: 300,
    })
    expect(() =>
      validateProjectDocument({
        ...project,
        pages: [
          {
            ...project.pages[0],
            physicalSize: {
              unit: 'mm',
              widthMm: 100,
              heightMm: 100,
              sourceDpi: 300,
            },
          },
        ],
      }),
    ).toThrow(/does not match/u)
  })

  it('reports malformed JSON separately from schema errors', () => {
    expect(() => parseProject('{not json')).toThrowError(
      expect.objectContaining<ProjectFormatError>({
        name: 'ProjectFormatError',
        code: 'invalid-json',
        message: expect.any(String) as string,
      }),
    )
  })

  it('rejects hostile JSON nesting with the project error contract', () => {
    const current = makeProject()
    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth < 180; depth += 1) nested = { nested }
    const source = JSON.stringify({
      ...current,
      pages: [
        {
          ...current.pages[0],
          fabricCanvas: { ...current.fabricCanvas, nested },
        },
      ],
    })

    expect(() => parseProject(source)).toThrowError(
      expect.objectContaining<ProjectFormatError>({
        name: 'ProjectFormatError',
        code: 'invalid-schema',
        message: expect.stringContaining('nesting depth'),
      }),
    )
  })

  it('rejects files produced by another application', () => {
    const value = { ...makeProject(), appId: 'another-editor' }
    expect(() => validateProjectDocument(value)).toThrowError(
      expect.objectContaining<ProjectFormatError>({
        name: 'ProjectFormatError',
        code: 'invalid-app',
        message: expect.any(String) as string,
      }),
    )
  })

  it.each([0, 5, 99])(
    'rejects unsupported schema version %s with a migration-ready error',
    (schemaVersion) => {
      const value = { ...makeProject(), schemaVersion }
      expect(() => validateProjectDocument(value)).toThrowError(
        expect.objectContaining<ProjectFormatError>({
          name: 'ProjectFormatError',
          code: 'unsupported-version',
          message: expect.any(String) as string,
        }),
      )
    },
  )

  it('migrates schema version 1 documents without losing renderer data', () => {
    const current = makeProject()
    const legacy = {
      appId: current.appId,
      schemaVersion: 1,
      canvasSize: current.canvasSize,
      fabricCanvas: current.fabricCanvas,
      metadata: current.metadata,
      updatedAt: current.updatedAt,
    }

    expect(validateProjectDocument(legacy)).toEqual(current)
  })

  it('migrates the checked-in version 1 golden project fixture', () => {
    const migrated = parseProject(legacyProjectV1)

    expect(migrated).toMatchObject({
      appId: PROJECT_APP_ID,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      canvasSize: { width: 320, height: 180 },
      metadata: {
        name: 'Version 1 golden project',
        sourceFileName: 'legacy.png',
      },
      editorState: {
        guides: [],
        snapTolerance: 8,
      },
    })
    expect(migrated.fabricCanvas.objects).toHaveLength(1)
    expect(migrated.pages).toHaveLength(1)
    expect(migrated.pages[0].layerTree).toHaveLength(1)
  })

  it('migrates schema version 2 editor state into its single canonical page', () => {
    const current = makeProject()
    const migrated = validateProjectDocument({
      appId: PROJECT_APP_ID,
      schemaVersion: 2,
      canvasSize: current.canvasSize,
      fabricCanvas: current.fabricCanvas,
      editorState: {
        guides: [{ axis: 'x', position: 320 }],
        snapTolerance: 5,
      },
      metadata: current.metadata,
      updatedAt: timestamp,
    })

    expect(migrated.pages).toHaveLength(1)
    expect(migrated.pages[0].editorState).toEqual({
      guides: [{ axis: 'x', position: 320 }],
      snapTolerance: 5,
    })
    expect(migrated.editorState).toBe(migrated.pages[0].editorState)
  })

  it('repairs unsafe legacy layer names during migration', () => {
    const current = makeProject()
    const unsafeName = `${'x'.repeat(240)}\nlegacy`
    const source = JSON.stringify({
      appId: PROJECT_APP_ID,
      schemaVersion: 2,
      canvasSize: current.canvasSize,
      fabricCanvas: {
        objects: [{ type: 'Rect', editorId: 'legacy', editorName: unsafeName }],
      },
      editorState: { guides: [], snapTolerance: 8 },
      metadata: current.metadata,
      updatedAt: timestamp,
    })

    const migrated = parseProject(source)
    expect(migrated.pages[0].layerTree[0].name).toHaveLength(200)
    expect(migrated.pages[0].layerTree[0].name).not.toContain('\n')
    expect(() => serializeProject(migrated)).not.toThrow()
  })

  it('serializes pages as the source of truth without duplicating active renderer data', () => {
    const project = makeProject()
    const source = serializeProject(project)
    const persisted = JSON.parse(source) as Record<string, unknown>

    expect(persisted.pages).toBeDefined()
    expect(persisted.activePageId).toBe('page-1')
    expect(persisted).not.toHaveProperty('canvasSize')
    expect(persisted).not.toHaveProperty('fabricCanvas')
    expect(persisted).not.toHaveProperty('editorState')
    expect(parseProject(source)).toEqual(project)
  })

  it('migrates schema version 3 multi-page documents to version 4', () => {
    const first = makeProject()
    const page = first.pages[0]
    const source = {
      appId: PROJECT_APP_ID,
      schemaVersion: 3,
      pages: [
        page,
        {
          ...page,
          id: 'page-2',
          name: 'Second page',
          canvasSize: { width: 1080, height: 1920 },
          editorState: { guides: [], snapTolerance: 8 },
        },
      ],
      activePageId: 'page-2',
      metadata: first.metadata,
      updatedAt: timestamp,
    }

    const migrated = validateProjectDocument(source)
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(migrated.pages).toHaveLength(2)
    expect(migrated.canvasSize).toEqual({ width: 1080, height: 1920 })
    expect(migrated.fabricCanvas).toBe(migrated.pages[1].fabricCanvas)
  })

  it('round-trips schema version 4 page transitions and element animations', () => {
    const animated = createProjectDocument({
      canvasSize: { width: 1280, height: 720 },
      fabricCanvas: {
        objects: [{ type: 'IText', editorId: 'heading' }],
      },
      timeline: {
        durationMs: 3_000,
        transition: {
          type: 'slide-left',
          durationMs: 300,
          easing: 'ease-in-out',
        },
        elements: {
          heading: [
            {
              id: 'heading-enter',
              phase: 'enter',
              effect: 'slide-up',
              start: { mode: 'with-page', delayMs: 200 },
              durationMs: 500,
              easing: 'ease-out',
              distancePx: 48,
            },
            {
              id: 'heading-pulse',
              phase: 'emphasis',
              effect: 'pulse',
              start: { mode: 'after-previous', delayMs: 100 },
              durationMs: 400,
            },
          ],
        },
      },
      updatedAt: timestamp,
    })

    expect(parseProject(serializeProject(animated))).toEqual(animated)
    expect(animated.pages[0].timeline?.elements.heading).toHaveLength(2)
  })

  it('validates after-previous timing in the same global order as playback', () => {
    expect(() =>
      createProjectDocument({
        canvasSize: { width: 800, height: 600 },
        fabricCanvas: {
          objects: [
            { type: 'Rect', editorId: 'first' },
            { type: 'Rect', editorId: 'second' },
          ],
        },
        timeline: {
          durationMs: 1_000,
          elements: {
            first: [
              {
                id: 'first-enter',
                phase: 'enter',
                effect: 'fade',
                start: { mode: 'with-page' },
                durationMs: 600,
              },
            ],
            second: [
              {
                id: 'second-enter',
                phase: 'enter',
                effect: 'fade',
                start: { mode: 'after-previous' },
                durationMs: 500,
              },
            ],
          },
        },
        updatedAt: timestamp,
      }),
    ).toThrow(/beyond the page duration/u)
  })

  it('rejects a zero-duration visible transition before runtime playback', () => {
    expect(() =>
      createProjectDocument({
        canvasSize: { width: 800, height: 600 },
        fabricCanvas: { objects: [] },
        timeline: {
          durationMs: 1_000,
          transition: { type: 'fade', durationMs: 0 },
          elements: {},
        },
        updatedAt: timestamp,
      }),
    ).toThrow(/transition is invalid/u)
  })

  it('validates inactive renderer payloads before a multi-page project opens', () => {
    const current = makeProject()
    expect(() =>
      validateProjectDocument({
        appId: PROJECT_APP_ID,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        pages: [
          current.pages[0],
          {
            ...current.pages[0],
            id: 'unsafe-page',
            name: 'Unsafe',
            fabricCanvas: {
              objects: [
                {
                  type: 'Image',
                  editorId: 'remote-image',
                  src: 'https://example.com/image.png',
                },
              ],
            },
            layerTree: undefined,
          },
        ],
        activePageId: 'page-1',
        metadata: current.metadata,
        updatedAt: timestamp,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-schema',
        message: expect.stringContaining('cannot be restored safely'),
      }),
    )
  })

  it('rejects a schema-v4 canonical layer tree that contradicts Fabric', () => {
    const current = makeProject()
    const contradictoryTree = structuredClone(
      current.pages[0].layerTree,
    ) as ProjectDocument['pages'][number]['layerTree']
    contradictoryTree[0].id = 'not-the-renderer-layer'

    expect(() =>
      validateProjectDocument({
        ...current,
        pages: [
          {
            ...current.pages[0],
            layerTree: contradictoryTree,
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-schema',
        message: expect.stringContaining(
          'Canonical layer tree does not match the renderer',
        ),
      }),
    )
  })

  it('validates version 2 guides and compressed selection-mask metadata', () => {
    const selectionMask = encodeSelectionMaskForProject(
      SelectionMask.fromBytes(
        4,
        3,
        new Uint8Array([0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0]),
      ),
    )
    const project = createProjectDocument({
      canvasSize: { width: 4, height: 3 },
      fabricCanvas: { objects: [] },
      editorState: {
        guides: [
          { axis: 'x', position: 2 },
          { axis: 'y', position: 1.5 },
        ],
        snapTolerance: 6,
        selectionMask,
      },
      updatedAt: timestamp,
    })

    expect(parseProject(serializeProject(project)).editorState).toEqual(
      project.editorState,
    )
  })

  it('rejects a Base64 mask whose decoded payload is corrupt', () => {
    const project = makeProject()
    expect(() =>
      validateProjectDocument({
        ...project,
        editorState: {
          guides: [],
          snapTolerance: 8,
          selectionMask: {
            width: project.canvasSize.width,
            height: project.canvasSize.height,
            encoding: 'rle-base64',
            data: 'AQID',
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-schema',
        message: expect.stringContaining('valid bounded mask payload'),
      }),
    )
  })

  it('rejects guides outside the canvas and mismatched masks', () => {
    const project = makeProject()
    expect(() =>
      validateProjectDocument({
        ...project,
        editorState: {
          guides: [{ axis: 'x', position: 1281 }],
          snapTolerance: 8,
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-schema',
        message: expect.stringContaining('position'),
      }),
    )

    expect(() =>
      validateProjectDocument({
        ...project,
        editorState: {
          guides: [],
          snapTolerance: 8,
          selectionMask: {
            width: 1,
            height: 1,
            encoding: 'rle-base64',
            data: 'AA==',
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-schema',
        message: expect.stringContaining('dimensions'),
      }),
    )
  })

  it.each([
    [{ width: 0, height: 480 }, 'canvasSize.width'],
    [{ width: 640.5, height: 480 }, 'canvasSize.width'],
    [{ width: 640, height: -1 }, 'canvasSize.height'],
  ])('rejects invalid canvas dimensions %j', (canvasSize, field) => {
    const value = { ...makeProject(), canvasSize }
    expect(() => validateProjectDocument(value)).toThrowError(
      expect.objectContaining({
        code: 'invalid-schema',
        message: expect.stringContaining(field),
      }),
    )
  })

  it('rejects invalid timestamps and incomplete metadata', () => {
    expect(() =>
      validateProjectDocument({
        ...makeProject(),
        updatedAt: 'yesterday',
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-schema' }))

    expect(() =>
      validateProjectDocument({
        ...makeProject(),
        metadata: { createdAt: timestamp },
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-schema' }))
  })

  it('rejects non-JSON and circular renderer data before serialization', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const project = {
      ...makeProject(),
      fabricCanvas: circular,
    } as unknown as ProjectDocument

    expect(() => serializeProject(project)).toThrowError(
      expect.objectContaining<ProjectFormatError>({
        name: 'ProjectFormatError',
        code: 'invalid-schema',
        message: expect.any(String) as string,
      }),
    )
  })
})
