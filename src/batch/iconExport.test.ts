import { afterEach, describe, expect, it } from 'vitest'
import { FabricEditorEngine } from '../editor/fabricEngine'
import { parseImageDimensions } from '../lib/imageMetadata'
import { DEFAULT_ICON_PRESETS } from './iconPresets'

const engines = new Set<FabricEditorEngine>()

const createEngine = (): FabricEditorEngine => {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const engine = new FabricEditorEngine(canvas, {
    width: 320,
    height: 180,
  })
  engine.addRect({
    left: 20,
    top: 20,
    width: 100,
    height: 80,
    fill: '#7c3aed',
    strokeWidth: 0,
  })
  engines.add(engine)
  return engine
}

const decodeDataUrl = (dataUrl: string): Uint8Array => {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/iu.exec(dataUrl)
  if (!match) {
    throw new TypeError('Expected a base64-encoded PNG data URL.')
  }
  const binary = atob(match[1])
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
})

describe('built-in icon PNG export acceptance', () => {
  it.each(DEFAULT_ICON_PRESETS)(
    'encodes $id with an IHDR size of $width × $height',
    async (preset) => {
      const engine = createEngine()
      const png = decodeDataUrl(
        await engine.exportSizedPng(
          preset.width,
          preset.height,
          preset.fit,
          preset.background,
        ),
      )

      expect(parseImageDimensions(png, 'image/png')).toEqual({
        width: preset.width,
        height: preset.height,
      })
    },
  )
})
