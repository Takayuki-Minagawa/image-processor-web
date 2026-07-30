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

  it.each([0, 2, 99])(
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
