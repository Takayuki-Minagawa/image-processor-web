import { describe, expect, it } from 'vitest'
import type { ResolvedAutomationCommand } from '../automation/commands'
import {
  type DecodedPipelineImage,
  type ImagePipelineRuntime,
  type PipelineCanvas,
  type PipelineDrawingContext,
  calculateFitRectangle,
  filterToCanvasExpression,
  processImageBuffer,
} from './imagePipeline'

interface DrawingLog {
  operation: string
  values: unknown[]
}

class FakeContext implements PipelineDrawingContext {
  filter = 'none'
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000'
  font = '10px sans-serif'
  globalAlpha = 1
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  readonly logs: DrawingLog[]

  constructor(logs: DrawingLog[]) {
    this.logs = logs
  }

  clearRect(...values: number[]): void {
    this.logs.push({ operation: 'clearRect', values })
  }

  drawImage(source: unknown, ...values: number[]): void {
    this.logs.push({
      operation: 'drawImage',
      values: [source, ...values, this.filter],
    })
  }

  fillRect(...values: number[]): void {
    this.logs.push({
      operation: 'fillRect',
      values: [...values, this.fillStyle],
    })
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.logs.push({
      operation: 'fillText',
      values: [text, x, y, maxWidth, this.globalAlpha, this.font],
    })
  }

  measureText(text: string): { width: number } {
    return { width: text.length * 8 }
  }

  restore(): void {
    this.logs.push({ operation: 'restore', values: [] })
  }

  save(): void {
    this.logs.push({ operation: 'save', values: [] })
  }
}

class FakeRuntime implements ImagePipelineRuntime {
  readonly logs: DrawingLog[] = []
  closed = false
  encodedDimensions: [number, number] | undefined
  encodedType = 'image/png'
  decodedWidth = 100
  decodedHeight = 50
  decodeCalls = 0

  async decode(): Promise<DecodedPipelineImage> {
    this.decodeCalls += 1
    return {
      source: { kind: 'bitmap' },
      width: this.decodedWidth,
      height: this.decodedHeight,
      close: () => {
        this.closed = true
      },
    }
  }

  createCanvas(width: number, height: number): PipelineCanvas {
    const drawable = { kind: 'canvas', width, height }
    const context = new FakeContext(this.logs)
    return { width, height, drawable, getContext: () => context }
  }

  async encode(
    canvas: PipelineCanvas,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
  ): Promise<Blob> {
    this.encodedDimensions = [canvas.width, canvas.height]
    return new Blob([new Uint8Array([1, 2, 3])], {
      type: this.encodedType || mimeType,
    })
  }
}

const pngHeader = (width = 100, height = 50): ArrayBuffer => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set(new TextEncoder().encode('IHDR'), 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

const request = (commands: ResolvedAutomationCommand[]) => ({
  input: pngHeader(),
  inputMimeType: 'image/png' as const,
  commands,
  output: { mimeType: 'image/png' as const },
})

describe('image command pipeline', () => {
  it('calculates contain, cover, and stretch rectangles without distortion', () => {
    expect(calculateFitRectangle(100, 50, 50, 50, 'contain')).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 100,
      sourceHeight: 50,
      destinationX: 0,
      destinationY: 12.5,
      destinationWidth: 50,
      destinationHeight: 25,
    })
    expect(calculateFitRectangle(100, 50, 50, 50, 'cover')).toEqual({
      sourceX: 25,
      sourceY: 0,
      sourceWidth: 50,
      sourceHeight: 50,
      destinationX: 0,
      destinationY: 0,
      destinationWidth: 50,
      destinationHeight: 50,
    })
    expect(calculateFitRectangle(100, 50, 20, 30, 'stretch')).toMatchObject({
      sourceWidth: 100,
      destinationWidth: 20,
      destinationHeight: 30,
    })
  })

  it('maps bounded filter values to Canvas2D expressions', () => {
    expect(
      filterToCanvasExpression({
        type: 'applyFilter',
        filter: 'brightness',
        value: 0.25,
      }),
    ).toBe('brightness(125%)')
    expect(
      filterToCanvasExpression({
        type: 'applyFilter',
        filter: 'blur',
        value: 0.5,
      }),
    ).toBe('blur(10.00px)')
    expect(
      filterToCanvasExpression({
        type: 'applyFilter',
        filter: 'grayscale',
        value: false,
      }),
    ).toBeNull()
  })

  it('decodes, applies ordered resize/filter/watermark commands, encodes, and releases the bitmap', async () => {
    const runtime = new FakeRuntime()
    const progress: string[] = []
    const result = await processImageBuffer(
      request([
        {
          type: 'resizeImage',
          width: 50,
          height: 50,
          fit: 'contain',
          background: '#000000',
        },
        {
          type: 'applyFilter',
          filter: 'contrast',
          value: 0.2,
          target: { kind: 'document' },
        },
        {
          type: 'addWatermark',
          text: '©',
          position: 'bottomRight',
          opacity: 0.5,
          fontSize: 10,
        },
      ]),
      {
        runtime,
        onProgress: ({ phase, progress: value }) =>
          progress.push(`${phase}:${value}`),
      },
    )

    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 50,
      height: 50,
    })
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]))
    expect(runtime.encodedDimensions).toEqual([50, 50])
    expect(runtime.closed).toBe(true)
    expect(runtime.logs.some(({ operation }) => operation === 'fillText')).toBe(
      true,
    )
    expect(
      runtime.logs.some(
        ({ operation, values }) =>
          operation === 'drawImage' && values.includes('contrast(120%)'),
      ),
    ).toBe(true)
    expect(progress.at(-1)).toBe('encode:1')
  })

  it('rejects editor-only commands before decoding', async () => {
    const runtime = new FakeRuntime()
    await expect(
      processImageBuffer(request([{ type: 'addText', text: 'Editable' }]), {
        runtime,
      }),
    ).rejects.toThrow(/cannot be replayed/)
    expect(runtime.decodeCalls).toBe(0)

    await expect(
      processImageBuffer(
        request([
          {
            type: 'runScript',
            source: 'editor.resize(10, 10);',
          },
        ]),
        { runtime },
      ),
    ).rejects.toThrow(/cannot be replayed/)
    expect(runtime.decodeCalls).toBe(0)
  })

  it('cancels after decode, closes the bitmap, and does not encode', async () => {
    const runtime = new FakeRuntime()
    let checks = 0
    await expect(
      processImageBuffer(request([]), {
        runtime,
        isCancelled: () => {
          checks += 1
          return checks >= 2
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(runtime.closed).toBe(true)
    expect(runtime.encodedDimensions).toBeUndefined()
  })

  it('rejects browsers that silently encode a different format', async () => {
    const runtime = new FakeRuntime()
    runtime.encodedType = 'image/jpeg'
    await expect(processImageBuffer(request([]), { runtime })).rejects.toThrow(
      /instead of image\/png/,
    )
    expect(runtime.closed).toBe(true)
  })

  it('rejects invalid or oversized headers before decode and decoded dimension mismatches after decode', async () => {
    const invalidRuntime = new FakeRuntime()
    await expect(
      processImageBuffer(
        {
          ...request([]),
          input: new Uint8Array([1, 2, 3]).buffer,
        },
        { runtime: invalidRuntime },
      ),
    ).rejects.toThrow(/header/)
    expect(invalidRuntime.decodeCalls).toBe(0)

    const oversizedRuntime = new FakeRuntime()
    await expect(
      processImageBuffer(
        {
          ...request([]),
          input: pngHeader(9_000, 10),
        },
        { runtime: oversizedRuntime },
      ),
    ).rejects.toThrow(/dimensions exceed/)
    expect(oversizedRuntime.decodeCalls).toBe(0)

    const mismatchRuntime = new FakeRuntime()
    mismatchRuntime.decodedWidth = 99
    await expect(
      processImageBuffer(request([]), { runtime: mismatchRuntime }),
    ).rejects.toThrow(/do not match/)
    expect(mismatchRuntime.closed).toBe(true)
  })
})
