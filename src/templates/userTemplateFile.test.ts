import { describe, expect, it } from 'vitest'
import { createProjectDocument } from '../editor/project'
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectDocument,
  type ProjectLayerNode,
  type ProjectPage,
} from '../editor/types'
import {
  USER_TEMPLATE_APP_ID,
  USER_TEMPLATE_FILE_KIND,
  USER_TEMPLATE_FILE_SCHEMA_VERSION,
  parseUserTemplateFile,
  serializeUserTemplateFile,
} from './userTemplateFile'

const timestamp = '2026-08-01T02:03:04.000Z'

const layer = (
  id: string,
  name: string,
  layerType: string,
): ProjectLayerNode => ({
  id,
  name,
  kind: 'layer',
  layerType,
  visible: true,
  locked: false,
  opacity: 1,
})

const project = (): ProjectDocument => {
  const cover: ProjectPage = {
    id: 'cover',
    name: 'Cover',
    canvasSize: { width: 1080, height: 1080 },
    fabricCanvas: {
      version: '7.4.0',
      objects: [
        {
          type: 'Group',
          editorKind: 'group',
          editorId: 'content',
          objects: [
            { type: 'Rect', editorId: 'frame', fill: '#112233' },
            { type: 'IText', editorId: 'headline', text: 'Exact fidelity' },
          ],
        },
      ],
    },
    editorState: {
      guides: [{ axis: 'x', position: 540 }],
      snapTolerance: 6,
    },
    layerTree: [
      {
        id: 'content',
        name: 'Content',
        kind: 'group',
        visible: true,
        locked: false,
        opacity: 0.9,
        children: [
          layer('frame', 'Frame', 'shape'),
          layer('headline', 'Headline', 'text'),
        ],
      },
    ],
    background: {
      kind: 'gradient',
      gradientType: 'linear',
      angle: 35,
      stops: [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#ccddee' },
      ],
    },
    timeline: {
      durationMs: 2_500,
      transition: {
        type: 'fade',
        durationMs: 300,
        easing: 'ease-in-out',
      },
      elements: {
        headline: [
          {
            id: 'headline-enter',
            phase: 'enter',
            effect: 'slide-up',
            start: { mode: 'with-page', delayMs: 120 },
            durationMs: 480,
            easing: 'ease-out',
            distancePx: 36,
          },
          {
            id: 'headline-pulse',
            phase: 'emphasis',
            effect: 'pulse',
            start: { mode: 'after-previous', delayMs: 80 },
            durationMs: 300,
          },
        ],
      },
    },
  }
  const details: ProjectPage = {
    id: 'details',
    name: 'Details',
    canvasSize: { width: 1920, height: 1080 },
    fabricCanvas: {
      version: '7.4.0',
      objects: [{ type: 'Rect', editorId: 'detail-card', fill: '#ffffff' }],
    },
    editorState: { guides: [], snapTolerance: 8 },
    layerTree: [layer('detail-card', 'Detail card', 'shape')],
    background: { kind: 'color', color: '#20242a' },
    timeline: {
      durationMs: 1_500,
      elements: {},
    },
  }
  return createProjectDocument({
    pages: [cover, details],
    activePageId: 'details',
    metadata: {
      name: 'Reusable campaign',
      createdAt: timestamp,
      tags: ['campaign', 'exact-fidelity'],
    },
    updatedAt: timestamp,
  })
}

describe('user template file codec', () => {
  it('round-trips schema-v4 pages, layer trees, and timelines exactly', () => {
    const original = project()
    const source = serializeUserTemplateFile(original)
    const envelope = JSON.parse(source) as Record<string, unknown>
    const nested = envelope.project as Record<string, unknown>

    expect(envelope).toMatchObject({
      appId: USER_TEMPLATE_APP_ID,
      kind: USER_TEMPLATE_FILE_KIND,
      schemaVersion: USER_TEMPLATE_FILE_SCHEMA_VERSION,
    })
    expect(nested.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(nested).not.toHaveProperty('canvasSize')
    expect(nested).not.toHaveProperty('fabricCanvas')
    expect(nested).not.toHaveProperty('editorState')

    const restored = parseUserTemplateFile(source)
    expect(restored).toEqual(original)
    expect(restored.pages).toEqual(original.pages)
    expect(restored.pages[0].layerTree).toEqual(original.pages[0].layerTree)
    expect(restored.pages[0].timeline).toEqual(original.pages[0].timeline)
  })

  it('rejects malformed JSON and invalid or unknown envelope identities', () => {
    expect(() => parseUserTemplateFile('{broken')).toThrowError(
      expect.objectContaining({
        code: 'invalid-json',
      }),
    )
    expect(() => parseUserTemplateFile('[]')).toThrowError(
      expect.objectContaining({
        code: 'invalid-envelope',
      }),
    )

    const envelope = JSON.parse(serializeUserTemplateFile(project())) as Record<
      string,
      unknown
    >
    expect(() =>
      parseUserTemplateFile(
        JSON.stringify({ ...envelope, appId: 'another-editor' }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-app' }))
    expect(() =>
      parseUserTemplateFile(JSON.stringify({ ...envelope, schemaVersion: 99 })),
    ).toThrowError(
      expect.objectContaining({
        code: 'unsupported-version',
      }),
    )
    expect(() =>
      parseUserTemplateFile(
        JSON.stringify({ ...envelope, kind: 'ordinary-project' }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-envelope',
      }),
    )
    expect(() =>
      parseUserTemplateFile(JSON.stringify({ ...envelope, surprise: true })),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-envelope',
      }),
    )
  })

  it('isolates malformed nested projects behind an invalid-project error', () => {
    const envelope = JSON.parse(serializeUserTemplateFile(project())) as Record<
      string,
      unknown
    >
    const nested = envelope.project as Record<string, unknown>
    const pages = nested.pages as Array<Record<string, unknown>>
    const timeline = pages[0].timeline as Record<string, unknown>
    timeline.elements = {
      missingLayer: [
        {
          id: 'unsafe-animation',
          phase: 'enter',
          effect: 'fade',
          start: { mode: 'with-page' },
          durationMs: 200,
        },
      ],
    }

    expect(() => parseUserTemplateFile(JSON.stringify(envelope))).toThrowError(
      expect.objectContaining({
        code: 'invalid-project',
        message: expect.stringContaining('missingLayer'),
      }),
    )
  })

  it('uses existing project migrations for older nested project documents', () => {
    const envelope = JSON.parse(serializeUserTemplateFile(project())) as Record<
      string,
      unknown
    >
    const nested = envelope.project as Record<string, unknown>
    nested.schemaVersion = 3

    const migrated = parseUserTemplateFile(JSON.stringify(envelope))

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(migrated.pages).toHaveLength(2)
    expect(migrated.pages[0].layerTree[0]).toMatchObject({ id: 'content' })
    expect(migrated.pages[0].timeline?.elements.headline).toHaveLength(2)
  })

  it('refuses to serialize an invalid project as a trusted template', () => {
    const invalid = { ...project(), pages: [] } as unknown as ProjectDocument
    expect(() => serializeUserTemplateFile(invalid)).toThrowError(
      expect.objectContaining({
        code: 'invalid-project',
      }),
    )
  })
})
