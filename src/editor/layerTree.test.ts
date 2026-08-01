import { describe, expect, it } from 'vitest'
import { encodeSelectionMaskForProject } from '../selection/codec'
import { SelectionMask } from '../selection/mask'
import {
  attachLayerClip,
  deriveLayerTreeFromRenderer,
  flattenLayerTree,
  groupLayerNodes,
  moveLayerNode,
  reconcileLayerTreeWithRenderer,
  setLayerMask,
  ungroupLayerNode,
  validateProjectLayerTree,
} from './layerTree'
import type { JsonObject, ProjectLayerNode, ProjectLayerTree } from './types'

const layer = (id: string): ProjectLayerNode => ({
  id,
  name: id,
  kind: 'layer',
  layerType: 'image',
  visible: true,
  locked: false,
  opacity: 1,
})

describe('project layer tree', () => {
  it('supports nested groups and exposes stable parent/depth paths', () => {
    const tree = validateProjectLayerTree([
      {
        id: 'outer',
        name: 'Outer',
        kind: 'group',
        children: [
          {
            id: 'middle',
            name: 'Middle',
            kind: 'group',
            children: [
              {
                id: 'inner',
                name: 'Inner',
                kind: 'group',
                children: [layer('photo')],
              },
            ],
          },
        ],
      },
    ])

    expect(
      flattenLayerTree(tree).map(({ node, parentId, depth, path }) => ({
        id: node.id,
        parentId,
        depth,
        path,
      })),
    ).toEqual([
      { id: 'outer', parentId: null, depth: 0, path: [0] },
      { id: 'middle', parentId: 'outer', depth: 1, path: [0, 0] },
      { id: 'inner', parentId: 'middle', depth: 2, path: [0, 0, 0] },
      { id: 'photo', parentId: 'inner', depth: 3, path: [0, 0, 0, 0] },
    ])
  })

  it('groups and ungroups siblings without changing their stacking order', () => {
    const original = [layer('back'), layer('photo'), layer('caption')]
    const grouped = groupLayerNodes(original, ['photo', 'caption'], {
      id: 'content',
      name: 'Content',
    })

    expect(grouped.map(({ id }) => id)).toEqual(['back', 'content'])
    expect(grouped[1]).toMatchObject({
      kind: 'group',
      children: [{ id: 'photo' }, { id: 'caption' }],
    })
    expect(ungroupLayerNode(grouped, 'content')).toEqual(original)
    expect(original).toEqual([layer('back'), layer('photo'), layer('caption')])
  })

  it('moves a layer between groups but rejects moving a group into itself', () => {
    const tree: ProjectLayerTree = [
      {
        id: 'group-a',
        name: 'A',
        kind: 'group',
        visible: true,
        locked: false,
        opacity: 1,
        children: [layer('one')],
      },
      {
        id: 'group-b',
        name: 'B',
        kind: 'group',
        visible: true,
        locked: false,
        opacity: 1,
        children: [layer('two')],
      },
    ]

    const moved = moveLayerNode(tree, 'one', 'group-b', 1)
    expect(
      flattenLayerTree(moved).find(({ node }) => node.id === 'one'),
    ).toMatchObject({ parentId: 'group-b', index: 1 })
    expect(() => moveLayerNode(tree, 'group-a', 'group-a', 0)).toThrowError(
      expect.objectContaining({ code: 'invalid-move' }),
    )
  })

  it('validates clipping references and rejects clipping cycles', () => {
    const tree = [layer('frame'), layer('photo'), layer('overlay')]
    const clipped = attachLayerClip(tree, 'photo', {
      frameLayerId: 'frame',
      fit: 'cover',
      position: { x: 0.5, y: 0.4 },
      scale: 1.2,
      rotation: 0,
    })
    expect(clipped[1]).toMatchObject({
      clip: { frameLayerId: 'frame', position: { x: 0.5, y: 0.4 } },
    })

    expect(() =>
      attachLayerClip(clipped, 'frame', {
        frameLayerId: 'photo',
        fit: 'cover',
        position: { x: 0.5, y: 0.5 },
        scale: 1,
        rotation: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-clip' }))
  })

  it('stores a lossless grayscale layer mask and can disable or remove it', () => {
    const payload = encodeSelectionMaskForProject(
      SelectionMask.fromBytes(2, 2, new Uint8Array([0, 80, 160, 255])),
    )
    const masked = setLayerMask([layer('photo')], 'photo', {
      enabled: false,
      inverted: true,
      opacity: 0.75,
      offsetX: 4,
      offsetY: 8,
      payload,
    })
    expect(masked[0]).toMatchObject({
      mask: { enabled: false, inverted: true, opacity: 0.75, payload },
    })
    expect(setLayerMask(masked, 'photo', null)).toEqual([layer('photo')])
  })

  it('repairs absent and duplicate legacy renderer ids deterministically', () => {
    const renderer: JsonObject = {
      objects: [
        { type: 'Rect', editorId: 'shared', editorName: 'First' },
        { type: 'Image', editorId: 'shared', editorName: 'Second' },
        { type: 'IText' },
      ],
    }
    const migrated = deriveLayerTreeFromRenderer(renderer)
    const ids = migrated.layerTree.map(({ id }) => id)

    expect(ids).toEqual(['shared', 'layer-2', 'layer-3'])
    expect(
      (migrated.fabricCanvas.objects as JsonObject[]).map(
        ({ editorId }) => editorId,
      ),
    ).toEqual(ids)
    expect(renderer.objects).not.toBe(migrated.fabricCanvas.objects)
  })

  it('repairs legacy renderer names without mutating the source payload', () => {
    const unsafeName = `  ${'A'.repeat(230)}\nignored\t  `
    const renderer: JsonObject = {
      objects: [{ type: 'Rect', editorId: 'legacy', editorName: unsafeName }],
    }

    const migrated = deriveLayerTreeFromRenderer(renderer)
    const migratedObject = (
      migrated.fabricCanvas.objects as Array<Record<string, unknown>>
    )[0]

    expect(migrated.layerTree[0].name).toHaveLength(200)
    expect(
      [...migrated.layerTree[0].name].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint > 0x1f && codePoint !== 0x7f
      }),
    ).toBe(true)
    expect(migratedObject.editorName).toBe(migrated.layerTree[0].name)
    expect((renderer.objects as JsonObject[])[0].editorName).toBe(unsafeName)
  })

  it('derives nested groups, clip references, and lossless masks', () => {
    const payload = encodeSelectionMaskForProject(
      SelectionMask.fromBytes(2, 2, new Uint8Array([0, 64, 192, 255])),
    )
    const renderer = {
      objects: [
        {
          type: 'Group',
          editorKind: 'group',
          editorId: 'group',
          editorName: 'Group',
          objects: [
            {
              type: 'Image',
              editorId: 'photo',
              editorName: 'Photo',
              editorClipFrameId: 'frame',
              clipPath: { type: 'Ellipse', editorName: 'Circle frame' },
              editorLayerMask: payload,
              editorLayerMaskEnabled: false,
            },
          ],
        },
      ],
    } as unknown as JsonObject
    const migrated = deriveLayerTreeFromRenderer(renderer)

    expect(migrated.layerTree).toMatchObject([
      {
        id: 'group',
        kind: 'group',
        children: [
          { id: 'frame', kind: 'layer', layerType: 'frame' },
          {
            id: 'photo',
            kind: 'layer',
            clip: { frameLayerId: 'frame' },
            mask: { enabled: false, payload },
          },
        ],
      },
    ])
    const rendererGroup = (
      migrated.fabricCanvas.objects as Array<Record<string, unknown>>
    )[0]
    const rendererPhoto = (
      rendererGroup.objects as Array<Record<string, unknown>>
    )[0]
    expect(rendererPhoto.editorClipFrameId).toBe('frame')
    expect(rendererPhoto.clipPath).toMatchObject({ editorId: 'frame' })
  })

  it('does not mistake a serialized mask clipPath for a clipping-frame layer', () => {
    const payload = encodeSelectionMaskForProject(
      SelectionMask.fromBytes(2, 2, new Uint8Array([0, 64, 192, 255])),
    )
    const migrated = deriveLayerTreeFromRenderer({
      objects: [
        {
          type: 'Image',
          editorId: 'photo',
          editorLayerMask: payload,
          editorLayerMaskEnabled: true,
          clipPath: { type: 'Group', objects: [{ type: 'Rect' }] },
        },
      ],
    } as unknown as JsonObject)

    expect(migrated.layerTree).toMatchObject([
      {
        id: 'photo',
        kind: 'layer',
        mask: { enabled: true, payload },
      },
    ])
    expect(migrated.layerTree).toHaveLength(1)
    expect(migrated.layerTree[0]).not.toHaveProperty('clip')
  })

  it('reconciles canonical metadata for nested groups, clips, and masks', () => {
    const payload = encodeSelectionMaskForProject(
      SelectionMask.fromBytes(2, 2, new Uint8Array([0, 64, 192, 255])),
    )
    const renderer = {
      objects: [
        {
          type: 'Group',
          editorKind: 'group',
          editorId: 'content',
          objects: [
            {
              type: 'Image',
              editorId: 'photo',
              editorClipFrameId: 'frame',
              clipPath: {
                type: 'Ellipse',
                editorId: 'frame',
                editorKind: 'frame',
                clipPath: { type: 'Group', objects: [{ type: 'Rect' }] },
              },
              editorLayerMask: payload,
              editorLayerMaskEnabled: false,
            },
          ],
        },
      ],
    } as unknown as JsonObject
    const derived = deriveLayerTreeFromRenderer(renderer)
    const canonical = structuredClone(derived.layerTree) as ProjectLayerTree
    const group = canonical[0]
    if (group.kind !== 'group') throw new Error('Expected a group fixture.')
    group.name = 'Canonical content'
    group.opacity = 0.75
    const frame = group.children[0]
    frame.name = 'Canonical frame'
    const photo = group.children[1]
    photo.name = 'Canonical photo'
    photo.locked = true
    if (photo.kind !== 'layer' || !photo.clip || !photo.mask) {
      throw new Error('Expected a clipped and masked layer fixture.')
    }
    photo.clip = {
      ...photo.clip,
      fit: 'contain',
      position: { x: 0.25, y: 0.8 },
      scale: 1.4,
      rotation: 17,
    }
    photo.mask = {
      ...photo.mask,
      inverted: true,
      opacity: 0.65,
      offsetX: 12,
      offsetY: -7,
    }

    const reconciled = reconcileLayerTreeWithRenderer(renderer, canonical)
    expect(reconciled.layerTree).toEqual(canonical)
    const rendererGroup = (
      reconciled.fabricCanvas.objects as Array<Record<string, unknown>>
    )[0]
    const rendererPhoto = (
      rendererGroup.objects as Array<Record<string, unknown>>
    )[0]
    expect(rendererGroup).toMatchObject({
      editorName: 'Canonical content',
      opacity: 0.75,
    })
    expect(rendererPhoto).toMatchObject({
      editorName: 'Canonical photo',
      editorLocked: true,
      editorLayerMask: payload,
      editorLayerMaskEnabled: false,
      editorClipSettings: {
        fit: 'contain',
        position: { x: 0.25, y: 0.8 },
        scale: 1.4,
        rotation: 17,
      },
      editorLayerMaskSettings: {
        inverted: true,
        opacity: 0.65,
        offsetX: 12,
        offsetY: -7,
      },
    })
    expect(rendererPhoto.clipPath).toMatchObject({
      editorId: 'frame',
      editorName: 'Canonical frame',
    })
    expect(
      deriveLayerTreeFromRenderer(reconciled.fabricCanvas).layerTree,
    ).toEqual(canonical)
  })

  it('rejects renderer/canonical id, order, and hierarchy contradictions', () => {
    const renderer: JsonObject = {
      objects: [
        { type: 'Rect', editorId: 'back' },
        { type: 'IText', editorId: 'title' },
      ],
    }
    const derived = deriveLayerTreeFromRenderer(renderer).layerTree
    const wrongId = structuredClone(derived) as ProjectLayerTree
    wrongId[0].id = 'other'
    expect(() => reconcileLayerTreeWithRenderer(renderer, wrongId)).toThrow(
      /does not match the renderer.*other/u,
    )

    expect(() =>
      reconcileLayerTreeWithRenderer(renderer, [
        {
          id: 'content',
          name: 'Content',
          kind: 'group',
          visible: true,
          locked: false,
          opacity: 1,
          children: derived,
        },
      ]),
    ).toThrow(/does not match the renderer/u)

    expect(() =>
      reconcileLayerTreeWithRenderer(renderer, [...derived].reverse()),
    ).toThrow(/does not match the renderer/u)
  })
})
