import type { ChartModel, ChartSeries } from './model'

export interface ChartPoint {
  x: number
  y: number
}

interface ChartVectorBase {
  id: string
  role: 'background' | 'grid' | 'axis' | 'data' | 'label' | 'title' | 'legend'
}

export interface ChartVectorRect extends ChartVectorBase {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
  fill: string
  stroke?: string
}

export interface ChartVectorLine extends ChartVectorBase {
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: string
  strokeWidth: number
}

export interface ChartVectorPolyline extends ChartVectorBase {
  type: 'polyline'
  points: ChartPoint[]
  stroke: string
  strokeWidth: number
  fill: 'none'
}

export interface ChartVectorPath extends ChartVectorBase {
  type: 'path'
  d: string
  fill: string
  stroke?: string
}

export interface ChartVectorCircle extends ChartVectorBase {
  type: 'circle'
  cx: number
  cy: number
  radius: number
  fill: string
}

export interface ChartVectorText extends ChartVectorBase {
  type: 'text'
  x: number
  y: number
  text: string
  fill: string
  fontSize: number
  align: 'left' | 'center' | 'right'
}

export type ChartVectorPrimitive =
  | ChartVectorRect
  | ChartVectorLine
  | ChartVectorPolyline
  | ChartVectorPath
  | ChartVectorCircle
  | ChartVectorText

export interface ChartPlotArea {
  x: number
  y: number
  width: number
  height: number
}

export interface ChartVectorScene {
  width: number
  height: number
  plotArea: ChartPlotArea
  domain: { minimum: number; maximum: number } | null
  primitives: ChartVectorPrimitive[]
}

export interface ChartLayoutOptions {
  width: number
  height: number
  /** Series/slice palette, typically supplied by the active brand palette. */
  palette?: readonly string[]
}

const DEFAULT_PALETTE = [
  '#6757e8',
  '#0ea5e9',
  '#14b8a6',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/iu
const rounded = (value: number): number => Number(value.toFixed(4))
const coordinate = (value: number): string => rounded(value).toString()
const formatValue = (value: number): string =>
  Math.abs(value) >= 1_000_000
    ? `${rounded(value / 1_000_000)}M`
    : Math.abs(value) >= 1_000
      ? `${rounded(value / 1_000)}K`
      : rounded(value).toString()

const collectValues = (chart: ChartModel): number[] =>
  chart.data.series.flatMap(({ values }) =>
    values.filter((value): value is number => value !== null),
  )

const numericDomain = (
  chart: ChartModel,
): { minimum: number; maximum: number } => {
  const values = collectValues(chart)
  let minimum = Math.min(0, ...values)
  let maximum = Math.max(0, ...values)
  if (minimum === maximum) {
    const padding = Math.max(1, Math.abs(minimum) * 0.1)
    minimum -= padding
    maximum += padding
  }
  return { minimum, maximum }
}

const paletteFor = (options: ChartLayoutOptions): readonly string[] => {
  const palette = options.palette?.length ? options.palette : DEFAULT_PALETTE
  if (palette.some((entry) => !HEX_COLOR.test(entry))) {
    throw new TypeError('Chart palette entries must be six-digit hex colors.')
  }
  return palette.map((entry) => entry.toLowerCase())
}

const seriesColor = (
  series: ChartSeries,
  index: number,
  palette: readonly string[],
): string => series.color ?? palette[index % palette.length]

const addTitle = (
  chart: ChartModel,
  options: ChartLayoutOptions,
  primitives: ChartVectorPrimitive[],
): void => {
  if (!chart.title) return
  primitives.push({
    id: 'title',
    role: 'title',
    type: 'text',
    x: options.width / 2,
    y: 28,
    text: chart.title,
    fill: chart.style.foreground,
    fontSize: 18,
    align: 'center',
  })
}

const addLegend = (
  chart: ChartModel,
  plot: ChartPlotArea,
  palette: readonly string[],
  primitives: ChartVectorPrimitive[],
): void => {
  if (!chart.style.showLegend) return
  const itemWidth = Math.min(150, plot.width / chart.data.series.length)
  const startX =
    plot.x + (plot.width - itemWidth * chart.data.series.length) / 2
  chart.data.series.forEach((series, index) => {
    const x = startX + index * itemWidth
    const y = plot.y + plot.height + 50
    primitives.push({
      id: `legend-swatch-${series.id}`,
      role: 'legend',
      type: 'rect',
      x,
      y: y - 10,
      width: 12,
      height: 12,
      fill: seriesColor(series, index, palette),
    })
    primitives.push({
      id: `legend-label-${series.id}`,
      role: 'legend',
      type: 'text',
      x: x + 18,
      y,
      text: series.name,
      fill: chart.style.foreground,
      fontSize: 12,
      align: 'left',
    })
  })
}

const cartesianPlotArea = (
  chart: ChartModel,
  options: ChartLayoutOptions,
): ChartPlotArea => ({
  x: chart.type === 'horizontal-bar' ? 96 : 64,
  y: chart.title ? 52 : 24,
  width: options.width - (chart.type === 'horizontal-bar' ? 120 : 88),
  height:
    options.height -
    (chart.title ? 52 : 24) -
    52 -
    (chart.style.showLegend ? 34 : 0),
})

const addVerticalGrid = (
  chart: ChartModel,
  plot: ChartPlotArea,
  domain: { minimum: number; maximum: number },
  primitives: ChartVectorPrimitive[],
): ((value: number) => number) => {
  const mapY = (value: number): number =>
    plot.y +
    ((domain.maximum - value) / (domain.maximum - domain.minimum)) * plot.height
  const ticks = 5
  for (let index = 0; index <= ticks; index += 1) {
    const value =
      domain.minimum + ((domain.maximum - domain.minimum) * index) / ticks
    const y = mapY(value)
    if (chart.style.showGrid) {
      primitives.push({
        id: `grid-y-${index}`,
        role: 'grid',
        type: 'line',
        x1: plot.x,
        y1: y,
        x2: plot.x + plot.width,
        y2: y,
        stroke: chart.style.gridColor,
        strokeWidth: 1,
      })
    }
    primitives.push({
      id: `tick-y-${index}`,
      role: 'label',
      type: 'text',
      x: plot.x - 8,
      y: y + 4,
      text: formatValue(value),
      fill: chart.style.foreground,
      fontSize: 11,
      align: 'right',
    })
  }
  return mapY
}

const addHorizontalGrid = (
  chart: ChartModel,
  plot: ChartPlotArea,
  domain: { minimum: number; maximum: number },
  primitives: ChartVectorPrimitive[],
): ((value: number) => number) => {
  const mapX = (value: number): number =>
    plot.x +
    ((value - domain.minimum) / (domain.maximum - domain.minimum)) * plot.width
  const ticks = 5
  for (let index = 0; index <= ticks; index += 1) {
    const value =
      domain.minimum + ((domain.maximum - domain.minimum) * index) / ticks
    const x = mapX(value)
    if (chart.style.showGrid) {
      primitives.push({
        id: `grid-x-${index}`,
        role: 'grid',
        type: 'line',
        x1: x,
        y1: plot.y,
        x2: x,
        y2: plot.y + plot.height,
        stroke: chart.style.gridColor,
        strokeWidth: 1,
      })
    }
    primitives.push({
      id: `tick-x-${index}`,
      role: 'label',
      type: 'text',
      x,
      y: plot.y + plot.height + 20,
      text: formatValue(value),
      fill: chart.style.foreground,
      fontSize: 11,
      align: 'center',
    })
  }
  return mapX
}

const buildVerticalChart = (
  chart: ChartModel,
  plot: ChartPlotArea,
  palette: readonly string[],
  primitives: ChartVectorPrimitive[],
): { minimum: number; maximum: number } => {
  const domain = numericDomain(chart)
  const mapY = addVerticalGrid(chart, plot, domain, primitives)
  const zeroY = mapY(0)
  const categoryWidth = plot.width / chart.data.labels.length
  chart.data.labels.forEach((label, labelIndex) => {
    primitives.push({
      id: `category-${labelIndex}`,
      role: 'label',
      type: 'text',
      x: plot.x + categoryWidth * (labelIndex + 0.5),
      y: plot.y + plot.height + 20,
      text: label,
      fill: chart.style.foreground,
      fontSize: 11,
      align: 'center',
    })
  })

  if (chart.type === 'bar') {
    const groupWidth = categoryWidth * 0.8
    const barWidth = groupWidth / chart.data.series.length
    chart.data.series.forEach((series, seriesIndex) => {
      series.values.forEach((value, labelIndex) => {
        if (value === null) return
        const valueY = mapY(value)
        const x =
          plot.x +
          labelIndex * categoryWidth +
          categoryWidth * 0.1 +
          seriesIndex * barWidth
        primitives.push({
          id: `bar-${series.id}-${labelIndex}`,
          role: 'data',
          type: 'rect',
          x: rounded(x),
          y: rounded(Math.min(valueY, zeroY)),
          width: rounded(Math.max(1, barWidth * 0.88)),
          height: rounded(Math.abs(zeroY - valueY)),
          fill: seriesColor(series, seriesIndex, palette),
        })
        if (chart.style.showValues) {
          primitives.push({
            id: `bar-value-${series.id}-${labelIndex}`,
            role: 'label',
            type: 'text',
            x: x + barWidth * 0.44,
            y: value >= 0 ? valueY - 6 : valueY + 14,
            text: formatValue(value),
            fill: chart.style.foreground,
            fontSize: 10,
            align: 'center',
          })
        }
      })
    })
  } else {
    chart.data.series.forEach((series, seriesIndex) => {
      const color = seriesColor(series, seriesIndex, palette)
      let segment: ChartPoint[] = []
      const flush = (): void => {
        if (segment.length >= 2) {
          primitives.push({
            id: `line-${series.id}-${primitives.length}`,
            role: 'data',
            type: 'polyline',
            points: segment,
            stroke: color,
            strokeWidth: 3,
            fill: 'none',
          })
        }
        segment = []
      }
      series.values.forEach((value, labelIndex) => {
        if (value === null) {
          flush()
          return
        }
        const point = {
          x: rounded(plot.x + categoryWidth * (labelIndex + 0.5)),
          y: rounded(mapY(value)),
        }
        segment.push(point)
        primitives.push({
          id: `point-${series.id}-${labelIndex}`,
          role: 'data',
          type: 'circle',
          cx: point.x,
          cy: point.y,
          radius: 4,
          fill: color,
        })
      })
      flush()
    })
  }
  return domain
}

const buildHorizontalBars = (
  chart: ChartModel,
  plot: ChartPlotArea,
  palette: readonly string[],
  primitives: ChartVectorPrimitive[],
): { minimum: number; maximum: number } => {
  const domain = numericDomain(chart)
  const mapX = addHorizontalGrid(chart, plot, domain, primitives)
  const zeroX = mapX(0)
  const categoryHeight = plot.height / chart.data.labels.length
  const groupHeight = categoryHeight * 0.8
  const barHeight = groupHeight / chart.data.series.length
  chart.data.labels.forEach((label, labelIndex) => {
    primitives.push({
      id: `category-${labelIndex}`,
      role: 'label',
      type: 'text',
      x: plot.x - 8,
      y: plot.y + categoryHeight * (labelIndex + 0.5) + 4,
      text: label,
      fill: chart.style.foreground,
      fontSize: 11,
      align: 'right',
    })
  })
  chart.data.series.forEach((series, seriesIndex) => {
    series.values.forEach((value, labelIndex) => {
      if (value === null) return
      const valueX = mapX(value)
      primitives.push({
        id: `bar-${series.id}-${labelIndex}`,
        role: 'data',
        type: 'rect',
        x: rounded(Math.min(valueX, zeroX)),
        y: rounded(
          plot.y +
            labelIndex * categoryHeight +
            categoryHeight * 0.1 +
            seriesIndex * barHeight,
        ),
        width: rounded(Math.abs(valueX - zeroX)),
        height: rounded(Math.max(1, barHeight * 0.88)),
        fill: seriesColor(series, seriesIndex, palette),
      })
    })
  })
  return domain
}

const polarPoint = (
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
): ChartPoint => ({
  x: centerX + Math.cos(angle) * radius,
  y: centerY + Math.sin(angle) * radius,
})

const arcPath = (
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string => {
  const fullCircle = endAngle - startAngle >= Math.PI * 2 - 1e-8
  const startOuter = polarPoint(centerX, centerY, outerRadius, startAngle)
  const endOuter = polarPoint(centerX, centerY, outerRadius, endAngle)
  if (fullCircle) {
    const oppositeOuter = polarPoint(
      centerX,
      centerY,
      outerRadius,
      startAngle + Math.PI,
    )
    const outer = `M ${coordinate(startOuter.x)} ${coordinate(startOuter.y)} A ${coordinate(outerRadius)} ${coordinate(outerRadius)} 0 1 1 ${coordinate(oppositeOuter.x)} ${coordinate(oppositeOuter.y)} A ${coordinate(outerRadius)} ${coordinate(outerRadius)} 0 1 1 ${coordinate(startOuter.x)} ${coordinate(startOuter.y)}`
    if (innerRadius === 0)
      return `${outer} L ${coordinate(centerX)} ${coordinate(centerY)} Z`
    const startInner = polarPoint(centerX, centerY, innerRadius, startAngle)
    const oppositeInner = polarPoint(
      centerX,
      centerY,
      innerRadius,
      startAngle + Math.PI,
    )
    return `${outer} L ${coordinate(startInner.x)} ${coordinate(startInner.y)} A ${coordinate(innerRadius)} ${coordinate(innerRadius)} 0 1 0 ${coordinate(oppositeInner.x)} ${coordinate(oppositeInner.y)} A ${coordinate(innerRadius)} ${coordinate(innerRadius)} 0 1 0 ${coordinate(startInner.x)} ${coordinate(startInner.y)} Z`
  }
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  if (innerRadius === 0) {
    return `M ${coordinate(centerX)} ${coordinate(centerY)} L ${coordinate(startOuter.x)} ${coordinate(startOuter.y)} A ${coordinate(outerRadius)} ${coordinate(outerRadius)} 0 ${largeArc} 1 ${coordinate(endOuter.x)} ${coordinate(endOuter.y)} Z`
  }
  const startInner = polarPoint(centerX, centerY, innerRadius, startAngle)
  const endInner = polarPoint(centerX, centerY, innerRadius, endAngle)
  return `M ${coordinate(startOuter.x)} ${coordinate(startOuter.y)} A ${coordinate(outerRadius)} ${coordinate(outerRadius)} 0 ${largeArc} 1 ${coordinate(endOuter.x)} ${coordinate(endOuter.y)} L ${coordinate(endInner.x)} ${coordinate(endInner.y)} A ${coordinate(innerRadius)} ${coordinate(innerRadius)} 0 ${largeArc} 0 ${coordinate(startInner.x)} ${coordinate(startInner.y)} Z`
}

const buildPie = (
  chart: ChartModel,
  plot: ChartPlotArea,
  palette: readonly string[],
  primitives: ChartVectorPrimitive[],
): void => {
  const series = chart.data.series[0]
  const values = series.values.map((value) => Math.max(0, value ?? 0))
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return
  const centerX = plot.x + plot.width / 2
  const centerY = plot.y + plot.height / 2
  const outerRadius = Math.max(1, Math.min(plot.width, plot.height) / 2)
  const innerRadius =
    chart.type === 'doughnut' ? outerRadius * chart.style.doughnutRatio : 0
  let angle = -Math.PI / 2
  values.forEach((value, index) => {
    if (value <= 0) return
    const end = angle + (value / total) * Math.PI * 2
    primitives.push({
      id: `slice-${index}`,
      role: 'data',
      type: 'path',
      d: arcPath(centerX, centerY, outerRadius, innerRadius, angle, end),
      fill: palette[index % palette.length],
      stroke: chart.style.background,
    })
    if (chart.style.showValues) {
      const labelPoint = polarPoint(
        centerX,
        centerY,
        innerRadius + (outerRadius - innerRadius) * 0.58,
        (angle + end) / 2,
      )
      primitives.push({
        id: `slice-value-${index}`,
        role: 'label',
        type: 'text',
        x: labelPoint.x,
        y: labelPoint.y + 4,
        text: formatValue(value),
        fill: chart.style.foreground,
        fontSize: 11,
        align: 'center',
      })
    }
    angle = end
  })
}

/** Turns validated chart data into renderer-neutral vector primitives. */
export function buildChartVectorScene(
  chart: ChartModel,
  options: ChartLayoutOptions,
): ChartVectorScene {
  if (
    !Number.isFinite(options.width) ||
    !Number.isFinite(options.height) ||
    options.width < 240 ||
    options.height < 180 ||
    options.width > 16_384 ||
    options.height > 16_384
  ) {
    throw new RangeError('Chart dimensions are outside the supported range.')
  }
  const palette = paletteFor(options)
  const primitives: ChartVectorPrimitive[] = [
    {
      id: 'background',
      role: 'background',
      type: 'rect',
      x: 0,
      y: 0,
      width: options.width,
      height: options.height,
      fill: chart.style.background,
    },
  ]
  addTitle(chart, options, primitives)
  const plot = cartesianPlotArea(chart, options)
  let domain: ChartVectorScene['domain'] = null
  if (chart.type === 'horizontal-bar') {
    domain = buildHorizontalBars(chart, plot, palette, primitives)
  } else if (chart.type === 'bar' || chart.type === 'line') {
    domain = buildVerticalChart(chart, plot, palette, primitives)
  } else {
    buildPie(chart, plot, palette, primitives)
  }
  addLegend(chart, plot, palette, primitives)
  return {
    width: options.width,
    height: options.height,
    plotArea: plot,
    domain,
    primitives,
  }
}
