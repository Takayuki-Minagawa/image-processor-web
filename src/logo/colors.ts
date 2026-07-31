export type HexColor = `#${string}`

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface HslColor {
  h: number
  s: number
  l: number
}

export type ColorHarmonyRule =
  'complementary' | 'analogous' | 'triadic' | 'monochromatic'

const HEX_COLOR = /^#?([a-f\d]{3}|[a-f\d]{6})$/i

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const wrapHue = (hue: number): number => ((hue % 360) + 360) % 360

const assertFiniteColor = (color: RgbColor): void => {
  if (
    !Number.isFinite(color.r) ||
    !Number.isFinite(color.g) ||
    !Number.isFinite(color.b)
  ) {
    throw new TypeError('RGB channels must be finite numbers.')
  }
}

export function parseHexColor(value: string): RgbColor {
  const match = HEX_COLOR.exec(value.trim())
  if (!match) {
    throw new TypeError(`Invalid hexadecimal color: ${value}`)
  }
  const digits =
    match[1].length === 3
      ? [...match[1]].map((digit) => `${digit}${digit}`).join('')
      : match[1]
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  }
}

export function rgbToHex(color: RgbColor): HexColor {
  assertFiniteColor(color)
  const channel = (value: number): string =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}` as HexColor
}

export function rgbToHsl(color: RgbColor): HslColor {
  assertFiniteColor(color)
  const red = clamp(color.r, 0, 255) / 255
  const green = clamp(color.g, 0, 255) / 255
  const blue = clamp(color.b, 0, 255) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum
  const lightness = (maximum + minimum) / 2

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness * 100 }
  }

  let hue: number
  if (maximum === red) {
    hue = 60 * (((green - blue) / delta) % 6)
  } else if (maximum === green) {
    hue = 60 * ((blue - red) / delta + 2)
  } else {
    hue = 60 * ((red - green) / delta + 4)
  }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  return {
    h: wrapHue(hue),
    s: saturation * 100,
    l: lightness * 100,
  }
}

export function hslToRgb(color: HslColor): RgbColor {
  if (
    !Number.isFinite(color.h) ||
    !Number.isFinite(color.s) ||
    !Number.isFinite(color.l)
  ) {
    throw new TypeError('HSL channels must be finite numbers.')
  }
  const hue = wrapHue(color.h)
  const saturation = clamp(color.s, 0, 100) / 100
  const lightness = clamp(color.l, 0, 100) / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const segment = hue / 60
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1))
  let red = 0
  let green = 0
  let blue = 0

  if (segment < 1) {
    red = chroma
    green = secondary
  } else if (segment < 2) {
    red = secondary
    green = chroma
  } else if (segment < 3) {
    green = chroma
    blue = secondary
  } else if (segment < 4) {
    green = secondary
    blue = chroma
  } else if (segment < 5) {
    red = secondary
    blue = chroma
  } else {
    red = chroma
    blue = secondary
  }

  const match = lightness - chroma / 2
  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  }
}

export const hslToHex = (color: HslColor): HexColor => rgbToHex(hslToRgb(color))

const withHue = (base: HslColor, hue: number, lightness = base.l): HexColor =>
  hslToHex({
    h: wrapHue(hue),
    s: clamp(base.s, 0, 100),
    l: clamp(lightness, 5, 95),
  })

/**
 * Produces a five-swatch palette with the base color first.
 */
export function generateColorHarmony(
  baseColor: string,
  rule: ColorHarmonyRule,
): HexColor[] {
  const baseHex = rgbToHex(parseHexColor(baseColor))
  const base = rgbToHsl(parseHexColor(baseHex))

  switch (rule) {
    case 'complementary':
      return [
        baseHex,
        withHue(base, base.h + 180),
        withHue(base, base.h, base.l + 22),
        withHue(base, base.h + 180, base.l + 22),
        withHue(base, base.h, base.l - 22),
      ]
    case 'analogous':
      return [0, -30, 30, -60, 60].map((offset) =>
        offset === 0 ? baseHex : withHue(base, base.h + offset),
      )
    case 'triadic':
      return [
        baseHex,
        withHue(base, base.h + 120),
        withHue(base, base.h + 240),
        withHue(base, base.h + 120, base.l + 20),
        withHue(base, base.h + 240, base.l - 18),
      ]
    case 'monochromatic':
      return [0, -17, 17, -34, 34].map((offset) =>
        offset === 0 ? baseHex : withHue(base, base.h, base.l + offset),
      )
    default: {
      const exhaustive: never = rule
      throw new TypeError(`Unknown harmony rule: ${String(exhaustive)}`)
    }
  }
}

export const relativeLuminance = (color: RgbColor): number => {
  assertFiniteColor(color)
  const linear = (channel: number): number => {
    const normalized = clamp(channel, 0, 255) / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * linear(color.r) +
    0.7152 * linear(color.g) +
    0.0722 * linear(color.b)
  )
}

export const readableTextColor = (background: string): '#000000' | '#ffffff' =>
  relativeLuminance(parseHexColor(background)) > 0.42 ? '#000000' : '#ffffff'

/** WCAG 2.1 contrast ratio, from 1 (identical) to 21 (black on white). */
export const contrastRatio = (left: string, right: string): number => {
  const leftLuminance = relativeLuminance(parseHexColor(left))
  const rightLuminance = relativeLuminance(parseHexColor(right))
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA for normal-size body text. */
export const MINIMUM_TEXT_CONTRAST = 4.5

/**
 * Picks the first candidate that is legible on `surface`, preferring the
 * earlier (more on-brand) entries and falling back to plain black or white
 * when no candidate clears the threshold.
 */
export const readableOnSurface = <T extends string>(
  candidates: readonly T[],
  surface: string,
): T | '#000000' | '#ffffff' => {
  let best: { color: T; ratio: number } | null = null
  for (const color of candidates) {
    const ratio = contrastRatio(color, surface)
    if (ratio >= MINIMUM_TEXT_CONTRAST) {
      return color
    }
    if (!best || ratio > best.ratio) {
      best = { color, ratio }
    }
  }
  return readableTextColor(surface)
}
