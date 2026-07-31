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

  it('reports malformed JSON separately from schema errors', () => {
    expect(() => parseProject('{not json')).toThrowError(
      expect.objectContaining<ProjectFormatError>({
        name: 'ProjectFormatError',
        code: 'invalid-json',
        message: expect.any(String) as string,
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

  it.each([0, 3, 99])(
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

    expect(validateProjectDocument(legacy)).toEqual({
      ...current,
      schemaVersion: 2,
      editorState: {
        guides: [],
        snapTolerance: 8,
      },
    })
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
