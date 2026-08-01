import { decodeSelectionMaskFromProject } from '../selection/codec'
import type {
  EncodedLayerMask,
  JsonObject,
  ProjectClipReference,
  ProjectLayerGroup,
  ProjectLayerMask,
  ProjectLayerNode,
  ProjectLayerTree,
  ProjectLayerTreeNode,
} from './types'

export const MAX_LAYER_TREE_DEPTH = 32
export const MAX_LAYER_TREE_NODES = 2_000
export const MAX_LAYER_NAME_LENGTH = 200
export const MAX_LAYER_MASK_DATA_CHARACTERS = 128 * 1024 * 1024

export type LayerTreeErrorCode =
  | 'invalid-tree'
  | 'duplicate-id'
  | 'missing-node'
  | 'invalid-group'
  | 'invalid-move'
  | 'invalid-clip'
  | 'invalid-mask'

export class LayerTreeError extends Error {
  readonly code: LayerTreeErrorCode

  constructor(code: LayerTreeErrorCode, message: string) {
    super(message)
    this.name = 'LayerTreeError'
    this.code = code
  }
}

export interface FlatLayerTreeEntry {
  node: ProjectLayerTreeNode
  parentId: string | null
  depth: number
  index: number
  path: readonly number[]
}

export interface CreateLayerGroupInput {
  id: string
  name?: string
  visible?: boolean
  locked?: boolean
  opacity?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })

const normalizedName = (value: unknown, fallback: string): string => {
  const candidate = typeof value === 'string' ? value.trim() : ''
  const name = candidate || fallback
  if (name.length > MAX_LAYER_NAME_LENGTH || containsControlCharacter(name)) {
    throw new LayerTreeError(
      'invalid-tree',
      `Layer name must contain at most ${MAX_LAYER_NAME_LENGTH} safe characters.`,
    )
  }
  return name
}

/**
 * Renderer payloads from older releases did not constrain layer names. Keep
 * the strict canonical-tree validator above, but repair legacy renderer data
 * when deriving a tree so one malformed display label cannot make the whole
 * document impossible to save or reopen.
 */
export const repairRendererLayerName = (
  value: unknown,
  fallback: string,
): string => {
  const withoutControls =
    typeof value === 'string'
      ? [...value]
          .filter((character) => {
            const codePoint = character.codePointAt(0) ?? 0
            return codePoint > 0x1f && codePoint !== 0x7f
          })
          .join('')
          .trim()
      : ''
  const candidate = withoutControls || fallback
  let repaired = ''
  for (const character of candidate) {
    if (repaired.length + character.length > MAX_LAYER_NAME_LENGTH) break
    repaired += character
  }
  return repaired || fallback.slice(0, MAX_LAYER_NAME_LENGTH)
}

const normalizedOpacity = (value: unknown, fallback = 1): number => {
  const opacity = value === undefined ? fallback : value
  if (!finiteNumber(opacity) || opacity < 0 || opacity > 1) {
    throw new LayerTreeError(
      'invalid-tree',
      'Layer opacity must be between 0 and 1.',
    )
  }
  return opacity
}

const validateEncodedMask = (
  value: unknown,
  budget: { encodedCharacters: number },
): EncodedLayerMask => {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.width) ||
    (value.width as number) <= 0 ||
    !Number.isSafeInteger(value.height) ||
    (value.height as number) <= 0 ||
    value.encoding !== 'rle-base64' ||
    typeof value.data !== 'string' ||
    value.data.length === 0 ||
    value.data.length > MAX_LAYER_MASK_DATA_CHARACTERS
  ) {
    throw new LayerTreeError('invalid-mask', 'Layer mask payload is invalid.')
  }
  const payload: EncodedLayerMask = {
    width: value.width as number,
    height: value.height as number,
    encoding: 'rle-base64',
    data: value.data,
  }
  budget.encodedCharacters += payload.data.length
  if (budget.encodedCharacters > MAX_LAYER_MASK_DATA_CHARACTERS) {
    throw new LayerTreeError(
      'invalid-mask',
      'Aggregate layer mask data exceeds the per-page limit.',
    )
  }
  try {
    decodeSelectionMaskFromProject(payload)
  } catch {
    throw new LayerTreeError(
      'invalid-mask',
      'Layer mask payload is corrupt or exceeds the mask limits.',
    )
  }
  return payload
}

const validateLayerMask = (
  value: unknown,
  budget: { encodedCharacters: number },
): ProjectLayerMask => {
  if (!isRecord(value)) {
    throw new LayerTreeError('invalid-mask', 'Layer mask must be an object.')
  }
  const enabled = value.enabled === undefined ? true : value.enabled
  const inverted = value.inverted === undefined ? false : value.inverted
  const opacity = value.opacity === undefined ? 1 : value.opacity
  const offsetX = value.offsetX === undefined ? 0 : value.offsetX
  const offsetY = value.offsetY === undefined ? 0 : value.offsetY
  if (
    typeof enabled !== 'boolean' ||
    typeof inverted !== 'boolean' ||
    !finiteNumber(opacity) ||
    opacity < 0 ||
    opacity > 1 ||
    !finiteNumber(offsetX) ||
    !finiteNumber(offsetY)
  ) {
    throw new LayerTreeError('invalid-mask', 'Layer mask settings are invalid.')
  }
  return {
    enabled,
    inverted,
    opacity,
    offsetX,
    offsetY,
    payload: validateEncodedMask(value.payload, budget),
  }
}

const validateClip = (value: unknown): ProjectClipReference => {
  if (!isRecord(value) || !safeId(value.frameLayerId)) {
    throw new LayerTreeError(
      'invalid-clip',
      'A clipping reference requires a valid frame layer id.',
    )
  }
  const fit = value.fit ?? 'cover'
  const position = value.position ?? { x: 0.5, y: 0.5 }
  const scale = value.scale ?? 1
  const rotation = value.rotation ?? 0
  if (
    (fit !== 'cover' && fit !== 'contain' && fit !== 'fill') ||
    !isRecord(position) ||
    !finiteNumber(position.x) ||
    position.x < 0 ||
    position.x > 1 ||
    !finiteNumber(position.y) ||
    position.y < 0 ||
    position.y > 1 ||
    !finiteNumber(scale) ||
    scale <= 0 ||
    scale > 1_000 ||
    !finiteNumber(rotation)
  ) {
    throw new LayerTreeError(
      'invalid-clip',
      'Clipping position, scale, rotation, or fit is invalid.',
    )
  }
  return {
    frameLayerId: value.frameLayerId,
    fit,
    position: { x: position.x, y: position.y },
    scale,
    rotation,
  }
}

const validateNodeBase = (
  value: Record<string, unknown>,
  fallbackName: string,
) => {
  if (!safeId(value.id)) {
    throw new LayerTreeError('invalid-tree', 'Every layer requires a safe id.')
  }
  const visible = value.visible === undefined ? true : value.visible
  const locked = value.locked === undefined ? false : value.locked
  if (typeof visible !== 'boolean' || typeof locked !== 'boolean') {
    throw new LayerTreeError(
      'invalid-tree',
      'Layer visibility and lock state must be boolean.',
    )
  }
  return {
    id: value.id,
    name: normalizedName(value.name, fallbackName),
    visible,
    locked,
    opacity: normalizedOpacity(value.opacity),
  }
}

/**
 * Validates and normalizes an untrusted editorId tree. It also verifies clip
 * references after collecting all nodes, so ordering does not affect validity.
 */
export const validateProjectLayerTree = (value: unknown): ProjectLayerTree => {
  if (!Array.isArray(value)) {
    throw new LayerTreeError('invalid-tree', 'Layer tree must be an array.')
  }

  let nodeCount = 0
  const maskBudget = { encodedCharacters: 0 }
  const ids = new Set<string>()
  const nodesById = new Map<string, ProjectLayerTreeNode>()

  const visit = (candidate: unknown, depth: number): ProjectLayerTreeNode => {
    if (!isRecord(candidate) || depth > MAX_LAYER_TREE_DEPTH) {
      throw new LayerTreeError(
        'invalid-tree',
        `Layer groups may be nested at most ${MAX_LAYER_TREE_DEPTH} levels.`,
      )
    }
    nodeCount += 1
    if (nodeCount > MAX_LAYER_TREE_NODES) {
      throw new LayerTreeError(
        'invalid-tree',
        `A page may contain at most ${MAX_LAYER_TREE_NODES} layer nodes.`,
      )
    }
    const base = validateNodeBase(candidate, `Layer ${nodeCount}`)
    if (ids.has(base.id)) {
      throw new LayerTreeError(
        'duplicate-id',
        `Layer id "${base.id}" appears more than once.`,
      )
    }
    ids.add(base.id)

    let node: ProjectLayerTreeNode
    if (candidate.kind === 'group') {
      if (!Array.isArray(candidate.children)) {
        throw new LayerTreeError(
          'invalid-tree',
          `Group "${base.id}" requires a children array.`,
        )
      }
      node = {
        ...base,
        kind: 'group',
        children: candidate.children.map((child) => visit(child, depth + 1)),
      }
    } else if (candidate.kind === 'layer') {
      const layerType =
        typeof candidate.layerType === 'string' && candidate.layerType.trim()
          ? candidate.layerType.trim().slice(0, 100)
          : 'object'
      node = {
        ...base,
        kind: 'layer',
        layerType,
        ...(candidate.clip === undefined
          ? {}
          : { clip: validateClip(candidate.clip) }),
        ...(candidate.mask === undefined
          ? {}
          : { mask: validateLayerMask(candidate.mask, maskBudget) }),
      }
    } else {
      throw new LayerTreeError(
        'invalid-tree',
        `Layer "${base.id}" has an unknown kind.`,
      )
    }
    nodesById.set(node.id, node)
    return node
  }

  const tree = value.map((node) => visit(node, 1))

  nodesById.forEach((node) => {
    if (node.kind !== 'layer' || !node.clip) return
    const frame = nodesById.get(node.clip.frameLayerId)
    if (!frame || frame.kind !== 'layer' || frame.id === node.id) {
      throw new LayerTreeError(
        'invalid-clip',
        `Layer "${node.id}" references a missing or invalid clipping frame.`,
      )
    }

    const visited = new Set([node.id])
    let cursor: ProjectLayerNode | undefined = frame
    while (cursor?.clip) {
      if (visited.has(cursor.id)) {
        throw new LayerTreeError(
          'invalid-clip',
          'Clipping references must not contain a cycle.',
        )
      }
      visited.add(cursor.id)
      const next = nodesById.get(cursor.clip.frameLayerId)
      cursor = next?.kind === 'layer' ? next : undefined
    }
  })

  return tree
}

export const flattenLayerTree = (
  tree: ProjectLayerTree,
): FlatLayerTreeEntry[] => {
  const output: FlatLayerTreeEntry[] = []
  const visit = (
    nodes: ProjectLayerTree,
    parentId: string | null,
    depth: number,
    parentPath: readonly number[],
  ) => {
    nodes.forEach((node, index) => {
      const path = [...parentPath, index]
      output.push({ node, parentId, depth, index, path })
      if (node.kind === 'group') {
        visit(node.children, node.id, depth + 1, path)
      }
    })
  }
  visit(tree, null, 0, [])
  return output
}

export const findLayerTreeNode = (
  tree: ProjectLayerTree,
  id: string,
): ProjectLayerTreeNode | undefined =>
  flattenLayerTree(tree).find(({ node }) => node.id === id)?.node

const updateChildren = (
  tree: ProjectLayerTree,
  parentId: string | null,
  update: (children: ProjectLayerTree) => ProjectLayerTree,
): ProjectLayerTree => {
  if (parentId === null) return update(tree)
  let found = false
  const visit = (nodes: ProjectLayerTree): ProjectLayerTree =>
    nodes.map((node) => {
      if (node.kind !== 'group') return node
      if (node.id === parentId) {
        found = true
        return { ...node, children: update(node.children) }
      }
      const children = visit(node.children)
      return children === node.children ? node : { ...node, children }
    })
  const result = visit(tree)
  if (!found) {
    throw new LayerTreeError(
      'missing-node',
      `Layer group "${parentId}" was not found.`,
    )
  }
  return result
}

const normalizedTree = (tree: ProjectLayerTree): ProjectLayerTree =>
  validateProjectLayerTree(tree)

export const groupLayerNodes = (
  tree: ProjectLayerTree,
  layerIds: readonly string[],
  input: CreateLayerGroupInput,
): ProjectLayerTree => {
  const uniqueIds = [...new Set(layerIds)]
  if (uniqueIds.length < 2) {
    throw new LayerTreeError(
      'invalid-group',
      'Grouping requires at least two distinct sibling layers.',
    )
  }
  if (findLayerTreeNode(tree, input.id)) {
    throw new LayerTreeError(
      'duplicate-id',
      `Layer id "${input.id}" is already in use.`,
    )
  }
  const entries = flattenLayerTree(tree).filter(({ node }) =>
    uniqueIds.includes(node.id),
  )
  if (entries.length !== uniqueIds.length) {
    throw new LayerTreeError('missing-node', 'A selected layer was not found.')
  }
  const parentId = entries[0].parentId
  if (entries.some((entry) => entry.parentId !== parentId)) {
    throw new LayerTreeError(
      'invalid-group',
      'Only sibling layers can be grouped in one operation.',
    )
  }
  const selected = new Set(uniqueIds)
  const result = updateChildren(tree, parentId, (children) => {
    const firstIndex = children.findIndex((child) => selected.has(child.id))
    const groupedChildren = children.filter((child) => selected.has(child.id))
    const remaining = children.filter((child) => !selected.has(child.id))
    const group: ProjectLayerGroup = {
      id: input.id,
      name: input.name ?? 'Group',
      kind: 'group',
      visible: input.visible ?? true,
      locked: input.locked ?? false,
      opacity: input.opacity ?? 1,
      children: groupedChildren,
    }
    remaining.splice(firstIndex, 0, group)
    return remaining
  })
  return normalizedTree(result)
}

export const ungroupLayerNode = (
  tree: ProjectLayerTree,
  groupId: string,
): ProjectLayerTree => {
  const entry = flattenLayerTree(tree).find(({ node }) => node.id === groupId)
  if (!entry || entry.node.kind !== 'group') {
    throw new LayerTreeError(
      'missing-node',
      `Layer group "${groupId}" was not found.`,
    )
  }
  const group = entry.node
  const result = updateChildren(tree, entry.parentId, (children) => {
    const index = children.findIndex((child) => child.id === groupId)
    return [
      ...children.slice(0, index),
      ...group.children,
      ...children.slice(index + 1),
    ]
  })
  return normalizedTree(result)
}

export const moveLayerNode = (
  tree: ProjectLayerTree,
  layerId: string,
  targetParentId: string | null,
  targetIndex: number,
): ProjectLayerTree => {
  const entry = flattenLayerTree(tree).find(({ node }) => node.id === layerId)
  if (!entry) {
    throw new LayerTreeError(
      'missing-node',
      `Layer "${layerId}" was not found.`,
    )
  }
  if (
    targetParentId === layerId ||
    (entry.node.kind === 'group' &&
      flattenLayerTree(entry.node.children).some(
        ({ node }) => node.id === targetParentId,
      ))
  ) {
    throw new LayerTreeError(
      'invalid-move',
      'A group cannot be moved inside itself or one of its descendants.',
    )
  }
  if (targetParentId !== null) {
    const target = findLayerTreeNode(tree, targetParentId)
    if (!target || target.kind !== 'group') {
      throw new LayerTreeError(
        'invalid-move',
        'The target parent must be an existing group.',
      )
    }
  }
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0) {
    throw new LayerTreeError(
      'invalid-move',
      'The target layer index must be a non-negative integer.',
    )
  }

  let removed = updateChildren(tree, entry.parentId, (children) =>
    children.filter((child) => child.id !== layerId),
  )
  removed = updateChildren(removed, targetParentId, (children) => {
    if (targetIndex > children.length) {
      throw new LayerTreeError(
        'invalid-move',
        'The target layer index is outside its parent.',
      )
    }
    const result = [...children]
    result.splice(targetIndex, 0, entry.node)
    return result
  })
  return normalizedTree(removed)
}

export const attachLayerClip = (
  tree: ProjectLayerTree,
  layerId: string,
  clip: ProjectClipReference | null,
): ProjectLayerTree => {
  let found = false
  const visit = (nodes: ProjectLayerTree): ProjectLayerTree =>
    nodes.map((node) => {
      if (node.id === layerId) {
        if (node.kind !== 'layer') {
          throw new LayerTreeError(
            'invalid-clip',
            'Only content layers can have clipping references.',
          )
        }
        found = true
        return { ...node, clip: clip ?? undefined }
      }
      return node.kind === 'group'
        ? { ...node, children: visit(node.children) }
        : node
    })
  const result = visit(tree)
  if (!found) {
    throw new LayerTreeError(
      'missing-node',
      `Layer "${layerId}" was not found.`,
    )
  }
  return normalizedTree(result)
}

export const setLayerMask = (
  tree: ProjectLayerTree,
  layerId: string,
  mask: ProjectLayerMask | null,
): ProjectLayerTree => {
  let found = false
  const visit = (nodes: ProjectLayerTree): ProjectLayerTree =>
    nodes.map((node) => {
      if (node.id === layerId) {
        if (node.kind !== 'layer') {
          throw new LayerTreeError(
            'invalid-mask',
            'Only content layers can have layer masks.',
          )
        }
        found = true
        return { ...node, mask: mask ?? undefined }
      }
      return node.kind === 'group'
        ? { ...node, children: visit(node.children) }
        : node
    })
  const result = visit(tree)
  if (!found) {
    throw new LayerTreeError(
      'missing-node',
      `Layer "${layerId}" was not found.`,
    )
  }
  return normalizedTree(result)
}

const rendererLayerId = (
  candidate: unknown,
  index: number,
  used: Set<string>,
): string => {
  const preferred = isRecord(candidate) ? candidate.editorId : undefined
  if (safeId(preferred) && !used.has(preferred)) return preferred
  let suffix = index + 1
  while (used.has(`layer-${suffix}`)) suffix += 1
  return `layer-${suffix}`
}

const clipSettingsFromRenderer = (
  value: unknown,
): Omit<ProjectClipReference, 'frameLayerId'> => {
  if (value !== undefined && !isRecord(value)) {
    throw new LayerTreeError(
      'invalid-clip',
      'Renderer clipping settings must be an object.',
    )
  }
  const settings = value ?? {}
  if (settings.position !== undefined && !isRecord(settings.position)) {
    throw new LayerTreeError(
      'invalid-clip',
      'Renderer clipping position must be an object.',
    )
  }
  const position = isRecord(settings.position)
    ? settings.position
    : { x: 0.5, y: 0.5 }
  return {
    fit: settings.fit ?? 'cover',
    position: {
      x: position.x ?? 0.5,
      y: position.y ?? 0.5,
    },
    scale: settings.scale ?? 1,
    rotation: settings.rotation ?? 0,
  } as Omit<ProjectClipReference, 'frameLayerId'>
}

const maskSettingsFromRenderer = (
  value: unknown,
): Pick<ProjectLayerMask, 'inverted' | 'opacity' | 'offsetX' | 'offsetY'> => {
  if (value !== undefined && !isRecord(value)) {
    throw new LayerTreeError(
      'invalid-mask',
      'Renderer layer-mask settings must be an object.',
    )
  }
  const settings = value ?? {}
  return {
    inverted: settings.inverted ?? false,
    opacity: settings.opacity ?? 1,
    offsetX: settings.offsetX ?? 0,
    offsetY: settings.offsetY ?? 0,
  } as Pick<ProjectLayerMask, 'inverted' | 'opacity' | 'offsetX' | 'offsetY'>
}

/**
 * Builds the canonical editorId tree used when a renderer payload has no
 * explicit layer tree. Fabric groups, embedded clip frames, and lossless layer
 * masks are projected into renderer-neutral nodes while ids are repaired in a
 * cloned payload so persistence and renderer restore remain aligned.
 */
export const deriveLayerTreeFromRenderer = (
  fabricCanvas: JsonObject,
): { fabricCanvas: JsonObject; layerTree: ProjectLayerTree } => {
  const objects = Array.isArray(fabricCanvas.objects)
    ? fabricCanvas.objects
    : []
  const used = new Set<string>()
  let sequence = 0

  const baseNode = (record: Record<string, unknown>, id: string) => {
    const name = repairRendererLayerName(record.editorName, `Layer ${sequence}`)
    record.editorName = name
    return {
      id,
      name,
      visible: record.visible !== false,
      locked: record.editorLocked === true,
      opacity:
        finiteNumber(record.opacity) &&
        record.opacity >= 0 &&
        record.opacity <= 1
          ? record.opacity
          : 1,
    }
  }

  const normalizeClipFrame = (
    value: unknown,
    requestedId: unknown,
  ): { renderer: unknown; node?: ProjectLayerNode } => {
    if (!isRecord(value)) return { renderer: value }
    sequence += 1
    const preferred =
      safeId(requestedId) && !used.has(requestedId)
        ? { ...value, editorId: requestedId, editorKind: 'frame' }
        : value
    const id = rendererLayerId(preferred, sequence - 1, used)
    used.add(id)
    const renderer = { ...preferred, editorId: id, editorKind: 'frame' }
    return {
      renderer,
      node: {
        ...baseNode(renderer, id),
        kind: 'layer',
        layerType: 'frame',
      },
    }
  }

  const normalizeObject = (
    value: unknown,
  ): { renderer: unknown; nodes: ProjectLayerTree } => {
    if (!isRecord(value)) return { renderer: value, nodes: [] }
    sequence += 1
    const id = rendererLayerId(value, sequence - 1, used)
    used.add(id)
    const renderer: Record<string, unknown> = { ...value, editorId: id }
    const rawType =
      typeof renderer.editorLayerType === 'string'
        ? renderer.editorLayerType
        : typeof renderer.editorKind === 'string'
          ? renderer.editorKind
          : renderer.type
    const isGroup =
      renderer.editorKind === 'group' ||
      (renderer.editorKind === undefined &&
        typeof renderer.type === 'string' &&
        renderer.type.toLocaleLowerCase() === 'group')
    if (isGroup) {
      const children = Array.isArray(renderer.objects) ? renderer.objects : []
      const normalizedChildren = children.map(normalizeObject)
      renderer.objects = normalizedChildren.map(({ renderer: child }) => child)
      const node: ProjectLayerGroup = {
        ...baseNode(renderer, id),
        kind: 'group',
        children: normalizedChildren.flatMap(({ nodes }) => nodes),
      }
      return { renderer, nodes: [node] }
    }

    // A layer mask is also serialized as a Fabric clipPath. It is an editor
    // layer only when the owning object explicitly identifies it as a frame;
    // otherwise treating the mask geometry as a sibling layer would invent a
    // renderer/canonical-tree mismatch on the next save.
    const clip = safeId(renderer.editorClipFrameId)
      ? normalizeClipFrame(renderer.clipPath, renderer.editorClipFrameId)
      : { renderer: renderer.clipPath }
    if (clip.node) {
      renderer.clipPath = clip.renderer
      renderer.editorClipFrameId = clip.node.id
    }
    const layerType =
      typeof rawType === 'string' && rawType.trim()
        ? rawType.trim().slice(0, 100)
        : 'object'
    const node: ProjectLayerNode = {
      ...baseNode(renderer, id),
      kind: 'layer',
      layerType,
      ...(clip.node
        ? {
            clip: {
              frameLayerId: clip.node.id,
              ...clipSettingsFromRenderer(renderer.editorClipSettings),
            } as ProjectClipReference,
          }
        : {}),
      ...(isRecord(renderer.editorLayerMask)
        ? {
            mask: {
              enabled: renderer.editorLayerMaskEnabled !== false,
              ...maskSettingsFromRenderer(renderer.editorLayerMaskSettings),
              payload: renderer.editorLayerMask as unknown as EncodedLayerMask,
            } as ProjectLayerMask,
          }
        : {}),
    }
    return {
      renderer,
      nodes: clip.node ? [clip.node, node] : [node],
    }
  }

  const normalized = objects.map(normalizeObject)
  const normalizedObjects = normalized.map(({ renderer }) => renderer)
  const layerTree = validateProjectLayerTree(
    normalized.flatMap(({ nodes }) => nodes),
  )
  const normalizedCanvas =
    objects.length === 0
      ? fabricCanvas
      : ({ ...fabricCanvas, objects: normalizedObjects } as JsonObject)
  return {
    fabricCanvas: applyCanonicalNodeMetadata(normalizedCanvas, layerTree),
    layerTree,
  }
}

const layerTreeMismatch = (message: string): never => {
  throw new LayerTreeError(
    'invalid-tree',
    `Canonical layer tree does not match the renderer: ${message}`,
  )
}

const masksReferenceSamePayload = (
  canonical: ProjectLayerMask | undefined,
  renderer: ProjectLayerMask | undefined,
): boolean => {
  if (!canonical || !renderer) return canonical === renderer
  return (
    canonical.enabled === renderer.enabled &&
    canonical.payload.width === renderer.payload.width &&
    canonical.payload.height === renderer.payload.height &&
    canonical.payload.encoding === renderer.payload.encoding &&
    canonical.payload.data === renderer.payload.data
  )
}

const clipSettingsMatch = (
  canonical: ProjectClipReference | undefined,
  renderer: ProjectClipReference | undefined,
): boolean => {
  if (!canonical || !renderer) return canonical === renderer
  return (
    canonical.fit === renderer.fit &&
    canonical.position.x === renderer.position.x &&
    canonical.position.y === renderer.position.y &&
    canonical.scale === renderer.scale &&
    canonical.rotation === renderer.rotation
  )
}

const maskSettingsMatch = (
  canonical: ProjectLayerMask | undefined,
  renderer: ProjectLayerMask | undefined,
): boolean => {
  if (!canonical || !renderer) return canonical === renderer
  return (
    canonical.inverted === renderer.inverted &&
    canonical.opacity === renderer.opacity &&
    canonical.offsetX === renderer.offsetX &&
    canonical.offsetY === renderer.offsetY
  )
}

/**
 * Verifies the persisted renderer and schema-v4 tree describe the same layer
 * identity, stacking order, nesting, clip ownership, and stored mask payload.
 * Presentation-only metadata (name, visibility, locking, and opacity) remains
 * canonical and is projected back into renderer JSON after this check.
 */
const assertLayerTreeMatchesRendererInternal = (
  canonicalTree: ProjectLayerTree,
  rendererTree: ProjectLayerTree,
  compareCanonicalSettings: boolean,
): void => {
  const visit = (
    canonicalNodes: ProjectLayerTree,
    rendererNodes: ProjectLayerTree,
    parentPath: string,
  ): void => {
    if (canonicalNodes.length !== rendererNodes.length) {
      layerTreeMismatch(
        `${parentPath} contains ${canonicalNodes.length} canonical nodes but ${rendererNodes.length} renderer nodes.`,
      )
    }

    canonicalNodes.forEach((canonicalNode, index) => {
      const rendererNode = rendererNodes[index]
      const nodePath = `${parentPath}[${index}]`
      if (canonicalNode.id !== rendererNode.id) {
        layerTreeMismatch(
          `${nodePath} identifies "${canonicalNode.id}" but the renderer identifies "${rendererNode.id}".`,
        )
      }
      if (canonicalNode.kind !== rendererNode.kind) {
        layerTreeMismatch(
          `layer "${canonicalNode.id}" is a ${canonicalNode.kind} in the canonical tree but a ${rendererNode.kind} in the renderer.`,
        )
      }

      if (canonicalNode.kind === 'group') {
        if (rendererNode.kind !== 'group') return
        visit(
          canonicalNode.children,
          rendererNode.children,
          `${nodePath}.children`,
        )
        return
      }
      if (rendererNode.kind !== 'layer') return

      if (
        compareCanonicalSettings &&
        canonicalNode.layerType !== rendererNode.layerType
      ) {
        layerTreeMismatch(
          `layer "${canonicalNode.id}" has type "${canonicalNode.layerType}" in the canonical tree but "${rendererNode.layerType}" in the renderer.`,
        )
      }

      const canonicalFrameId = canonicalNode.clip?.frameLayerId
      const rendererFrameId = rendererNode.clip?.frameLayerId
      if (canonicalFrameId !== rendererFrameId) {
        layerTreeMismatch(
          `layer "${canonicalNode.id}" references clip frame "${canonicalFrameId ?? 'none'}" but the renderer references "${rendererFrameId ?? 'none'}".`,
        )
      }
      if (
        compareCanonicalSettings &&
        !clipSettingsMatch(canonicalNode.clip, rendererNode.clip)
      ) {
        layerTreeMismatch(
          `layer "${canonicalNode.id}" has different clipping settings in the canonical tree and renderer.`,
        )
      }
      if (!masksReferenceSamePayload(canonicalNode.mask, rendererNode.mask)) {
        layerTreeMismatch(
          `layer "${canonicalNode.id}" has different mask data in the canonical tree and renderer.`,
        )
      }
      if (
        compareCanonicalSettings &&
        !maskSettingsMatch(canonicalNode.mask, rendererNode.mask)
      ) {
        layerTreeMismatch(
          `layer "${canonicalNode.id}" has different mask settings in the canonical tree and renderer.`,
        )
      }
    })
  }

  visit(canonicalTree, rendererTree, 'root')
}

export const assertLayerTreeMatchesRenderer = (
  canonicalTree: ProjectLayerTree,
  rendererTree: ProjectLayerTree,
): void =>
  assertLayerTreeMatchesRendererInternal(canonicalTree, rendererTree, true)

const applyCanonicalNodeMetadata = (
  fabricCanvas: JsonObject,
  canonicalTree: ProjectLayerTree,
): JsonObject => {
  const canonicalById = new Map(
    flattenLayerTree(canonicalTree).map(({ node }) => [node.id, node]),
  )

  const visitRendererObject = (value: unknown): unknown => {
    if (!isRecord(value)) return value
    const renderer = { ...value }
    const node = safeId(renderer.editorId)
      ? canonicalById.get(renderer.editorId)
      : undefined
    if (node) {
      renderer.editorName = node.name
      renderer.visible = node.visible
      renderer.editorLocked = node.locked
      renderer.opacity = node.opacity
    }
    if (node?.kind === 'group' && Array.isArray(renderer.objects)) {
      renderer.objects = renderer.objects.map(visitRendererObject)
    }
    if (node?.kind === 'layer') {
      renderer.editorLayerType = node.layerType
    }
    if (
      node?.kind === 'layer' &&
      node.clip &&
      renderer.editorClipFrameId === node.clip.frameLayerId &&
      isRecord(renderer.clipPath)
    ) {
      renderer.editorClipFrameId = node.clip.frameLayerId
      renderer.editorClipSettings = {
        fit: node.clip.fit,
        position: { ...node.clip.position },
        scale: node.clip.scale,
        rotation: node.clip.rotation,
      }
      renderer.clipPath = visitRendererObject(renderer.clipPath)
    } else if (node?.kind === 'layer') {
      delete renderer.editorClipSettings
    }
    if (node?.kind === 'layer' && node.mask) {
      renderer.editorLayerMask = { ...node.mask.payload }
      renderer.editorLayerMaskEnabled = node.mask.enabled
      renderer.editorLayerMaskSettings = {
        inverted: node.mask.inverted,
        opacity: node.mask.opacity,
        offsetX: node.mask.offsetX,
        offsetY: node.mask.offsetY,
      }
    } else if (node?.kind === 'layer') {
      delete renderer.editorLayerMaskSettings
    }
    return renderer
  }

  return Array.isArray(fabricCanvas.objects)
    ? {
        ...fabricCanvas,
        objects: fabricCanvas.objects.map(visitRendererObject) as JsonObject[],
      }
    : fabricCanvas
}

/**
 * Validates an explicit schema-v4 tree against Fabric and returns renderer JSON
 * with canonical layer metadata embedded. Consumers that restore only the
 * Fabric snapshot therefore still receive the canonical layer state.
 */
export const reconcileLayerTreeWithRenderer = (
  fabricCanvas: JsonObject,
  layerTree: unknown,
): { fabricCanvas: JsonObject; layerTree: ProjectLayerTree } => {
  const canonicalTree = validateProjectLayerTree(layerTree)
  const renderer = deriveLayerTreeFromRenderer(fabricCanvas)
  assertLayerTreeMatchesRendererInternal(
    canonicalTree,
    renderer.layerTree,
    false,
  )
  const reconciledFabricCanvas = applyCanonicalNodeMetadata(
    renderer.fabricCanvas,
    canonicalTree,
  )
  const roundTripped = deriveLayerTreeFromRenderer(reconciledFabricCanvas)
  assertLayerTreeMatchesRenderer(canonicalTree, roundTripped.layerTree)
  return {
    fabricCanvas: roundTripped.fabricCanvas,
    layerTree: canonicalTree,
  }
}
