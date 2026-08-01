import type { ShapeDefinition } from './types'

const format = (value: number): string => Number(value.toFixed(4)).toString()

const point = (x: number, y: number): string => `${format(x)} ${format(y)}`

const closedPolygonPath = (points: readonly [number, number][]): string =>
  points.length === 0
    ? ''
    : `M ${point(points[0][0], points[0][1])} ${points
        .slice(1)
        .map(([x, y]) => `L ${point(x, y)}`)
        .join(' ')} Z`

const radialPoints = (
  count: number,
  width: number,
  height: number,
  rotationDegrees: number,
  radiusAt: (index: number) => number,
): [number, number][] => {
  const centerX = width / 2
  const centerY = height / 2
  const radiusX = width / 2
  const radiusY = height / 2
  const start = ((rotationDegrees - 90) * Math.PI) / 180
  return Array.from({ length: count }, (_, index) => {
    const angle = start + (index * Math.PI * 2) / count
    const radius = radiusAt(index)
    return [
      centerX + Math.cos(angle) * radiusX * radius,
      centerY + Math.sin(angle) * radiusY * radius,
    ]
  })
}

const rotatedArrowPoints = (
  width: number,
  height: number,
  definition: Extract<ShapeDefinition, { type: 'arrow' }>,
): [number, number][] => {
  const shaftHalfHeight = (definition.shaftRatio * height) / 2
  const headStart = width * (1 - definition.headLengthRatio)
  const base: [number, number][] = [
    [0, height / 2 - shaftHalfHeight],
    [headStart, height / 2 - shaftHalfHeight],
    [headStart, 0],
    [width, height / 2],
    [headStart, height],
    [headStart, height / 2 + shaftHalfHeight],
    [0, height / 2 + shaftHalfHeight],
  ]
  if (definition.direction === 'right') return base

  const normalized = base.map(([x, y]) => [x / width, y / height] as const)
  return normalized.map(([x, y]) => {
    if (definition.direction === 'left') {
      return [(1 - x) * width, y * height]
    }
    if (definition.direction === 'down') {
      return [y * width, x * height]
    }
    return [(1 - y) * width, (1 - x) * height]
  })
}

const assertShapeDefinition = (definition: ShapeDefinition): void => {
  if (
    definition.type === 'rounded-rectangle' &&
    (definition.cornerRadiusRatio < 0 || definition.cornerRadiusRatio > 0.5)
  ) {
    throw new RangeError('cornerRadiusRatio must be between 0 and 0.5.')
  }
  if (
    definition.type === 'polygon' &&
    (!Number.isInteger(definition.sides) ||
      definition.sides < 3 ||
      definition.sides > 64)
  ) {
    throw new RangeError('A polygon must have 3 to 64 sides.')
  }
  if (
    definition.type === 'star' &&
    (!Number.isInteger(definition.points) ||
      definition.points < 3 ||
      definition.points > 64 ||
      definition.innerRadiusRatio <= 0 ||
      definition.innerRadiusRatio >= 1)
  ) {
    throw new RangeError(
      'A star must have 3 to 64 points and an inner radius between 0 and 1.',
    )
  }
  if (
    definition.type === 'arrow' &&
    (definition.shaftRatio <= 0 ||
      definition.shaftRatio > 1 ||
      definition.headLengthRatio <= 0 ||
      definition.headLengthRatio >= 1)
  ) {
    throw new RangeError('Arrow ratios must be in their valid 0..1 ranges.')
  }
  if (
    definition.type === 'speech-bubble' &&
    (definition.cornerRadiusRatio < 0 ||
      definition.cornerRadiusRatio > 0.5 ||
      definition.tailPositionRatio < 0 ||
      definition.tailPositionRatio > 1 ||
      definition.tailWidthRatio <= 0 ||
      definition.tailWidthRatio > 1 ||
      definition.tailHeightRatio <= 0 ||
      definition.tailHeightRatio >= 1)
  ) {
    throw new RangeError('Speech bubble ratios are outside their valid range.')
  }
}

/**
 * Converts a procedural shape into a portable SVG-compatible path string.
 * The result has no Fabric.js dependency and can be consumed by any renderer.
 */
export function shapeDefinitionToPath(
  definition: ShapeDefinition,
  width: number,
  height: number,
): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError('Shape dimensions must be positive finite numbers.')
  }
  assertShapeDefinition(definition)

  if (definition.type === 'rounded-rectangle') {
    const radius =
      Math.min(width, height) * Math.min(0.5, definition.cornerRadiusRatio)
    return [
      `M ${point(radius, 0)}`,
      `L ${point(width - radius, 0)}`,
      `Q ${point(width, 0)} ${point(width, radius)}`,
      `L ${point(width, height - radius)}`,
      `Q ${point(width, height)} ${point(width - radius, height)}`,
      `L ${point(radius, height)}`,
      `Q ${point(0, height)} ${point(0, height - radius)}`,
      `L ${point(0, radius)}`,
      `Q ${point(0, 0)} ${point(radius, 0)} Z`,
    ].join(' ')
  }

  if (definition.type === 'polygon') {
    return closedPolygonPath(
      radialPoints(
        definition.sides,
        width,
        height,
        definition.rotationDegrees ?? 0,
        () => 1,
      ),
    )
  }

  if (definition.type === 'star') {
    return closedPolygonPath(
      radialPoints(
        definition.points * 2,
        width,
        height,
        definition.rotationDegrees ?? 0,
        (index) => (index % 2 === 0 ? 1 : definition.innerRadiusRatio),
      ),
    )
  }

  if (definition.type === 'arrow') {
    return closedPolygonPath(rotatedArrowPoints(width, height, definition))
  }

  if (definition.type === 'speech-bubble') {
    const bodyHeight = height * (1 - definition.tailHeightRatio)
    const radius = Math.min(width, bodyHeight) * definition.cornerRadiusRatio
    const tailCenter = width * definition.tailPositionRatio
    const tailHalfWidth = (width * definition.tailWidthRatio) / 2
    const tailLeft = Math.max(radius, tailCenter - tailHalfWidth)
    const tailRight = Math.min(width - radius, tailCenter + tailHalfWidth)
    return [
      `M ${point(radius, 0)}`,
      `L ${point(width - radius, 0)}`,
      `Q ${point(width, 0)} ${point(width, radius)}`,
      `L ${point(width, bodyHeight - radius)}`,
      `Q ${point(width, bodyHeight)} ${point(width - radius, bodyHeight)}`,
      `L ${point(tailRight, bodyHeight)}`,
      `L ${point(tailCenter, height)}`,
      `L ${point(tailLeft, bodyHeight)}`,
      `L ${point(radius, bodyHeight)}`,
      `Q ${point(0, bodyHeight)} ${point(0, bodyHeight - radius)}`,
      `L ${point(0, radius)}`,
      `Q ${point(0, 0)} ${point(radius, 0)} Z`,
    ].join(' ')
  }

  return definition.routing === 'straight'
    ? `M 0 ${format(height / 2)} L ${format(width)} ${format(height / 2)}`
    : `M 0 ${format(height)} L ${format(width / 2)} ${format(height)} L ${format(width / 2)} 0 L ${format(width)} 0`
}
