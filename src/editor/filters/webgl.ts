import { validateFilterOperation } from './registry'
import type { FilterOperation, PixelBuffer, RgbColor } from './types'

const GPU_FILTER_IDS = new Set([
  'levels',
  'white-balance',
  'vignette',
  'gradient-map',
  'duotone',
  'curves',
  'halftone',
  'glitch',
  'sepia',
  'invert',
])

const vertexSource = `
  attribute vec2 aPosition;
  varying vec2 vTextureCoordinate;

  void main() {
    vTextureCoordinate = (aPosition + 1.0) * 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const numberSource = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new TypeError('WebGL filter constants must be finite.')
  }
  const source = Number(value.toFixed(9)).toString()
  return source.includes('.') ? source : `${source}.0`
}

const colorSource = ({ r, g, b }: RgbColor): string =>
  `vec3(${numberSource(r / 255)}, ${numberSource(g / 255)}, ${numberSource(
    b / 255,
  )})`

const hash32 = (seed: number, value: number): number => {
  let hash = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d) >>> 0
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}

const randomUnit = (seed: number, value: number): number =>
  hash32(seed, value) / 0xffffffff

interface LookupTextureData {
  width: number
  height: number
  data: Uint8ClampedArray
}

const curvesLookupTexture = (
  operation: Extract<FilterOperation, { id: 'curves' }>,
): LookupTextureData => {
  const data = new Uint8ClampedArray(256 * 4)
  const { master, red, green, blue } = operation.params
  for (let input = 0; input < 256; input += 1) {
    const offset = input * 4
    data[offset] = master[red[input]]
    data[offset + 1] = master[green[input]]
    data[offset + 2] = master[blue[input]]
    data[offset + 3] = 255
  }
  return { width: 256, height: 1, data }
}

const glitchLookupTexture = (
  operation: Extract<FilterOperation, { id: 'glitch' }>,
  height: number,
): LookupTextureData => {
  const data = new Uint8ClampedArray(height * 4)
  const { amount, offset: maximumOffset, seed } = operation.params
  for (let y = 0; y < height; y += 1) {
    const active = randomUnit(seed, y * 2) < amount
    const direction = randomUnit(seed, y * 2 + 1) < 0.5 ? -1 : 1
    const rowShift = active
      ? Math.round(randomUnit(seed ^ 0xa5a5a5a5, y) * maximumOffset * direction)
      : 0
    // offset is validated to 0...256, so the signed shift fits losslessly in
    // two unsigned bytes after adding 256.
    const encoded = rowShift + 256
    const dataOffset = y * 4
    data[dataOffset] = Math.floor(encoded / 256)
    data[dataOffset + 1] = encoded % 256
    data[dataOffset + 3] = 255
  }
  return { width: 1, height, data }
}

const lookupTextureForOperation = (
  operation: FilterOperation,
  height: number,
): LookupTextureData | null => {
  switch (operation.id) {
    case 'curves':
      return curvesLookupTexture(operation)
    case 'glitch':
      return glitchLookupTexture(operation, height)
    default:
      return null
  }
}

const gradientBody = (
  stops: readonly { offset: number; color: RgbColor }[],
): string => {
  const branches = stops.slice(1).map((stop, index) => {
    const previous = stops[index]
    const range = stop.offset - previous.offset
    return `
      ${index === 0 ? 'if' : 'else if'} (luminance <= ${numberSource(
        stop.offset,
      )}) {
        mapped = mix(
          ${colorSource(previous.color)},
          ${colorSource(stop.color)},
          clamp((luminance - ${numberSource(previous.offset)}) / ${numberSource(
            range,
          )}, 0.0, 1.0)
        );
      }
    `
  })
  return `
    float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 mapped = ${colorSource(stops.at(-1)!.color)};
    ${branches.join('\n')}
    result = mapped;
  `
}

const operationBody = (
  operation: FilterOperation,
  width: number,
  height: number,
): string => {
  switch (operation.id) {
    case 'levels': {
      const parameters = operation.params
      return `
        vec3 normalized = clamp(
          (source.rgb * 255.0 - ${numberSource(parameters.inputBlack)}) /
            ${numberSource(parameters.inputWhite - parameters.inputBlack)},
          0.0,
          1.0
        );
        result =
          (${numberSource(parameters.outputBlack)} +
            pow(normalized, vec3(${numberSource(1 / parameters.gamma)})) *
              ${numberSource(
                parameters.outputWhite - parameters.outputBlack,
              )}) /
          255.0;
      `
    }
    case 'curves':
      return `
        float redCoordinate =
          (floor(source.r * 255.0 + 0.5) + 0.5) / 256.0;
        float greenCoordinate =
          (floor(source.g * 255.0 + 0.5) + 0.5) / 256.0;
        float blueCoordinate =
          (floor(source.b * 255.0 + 0.5) + 0.5) / 256.0;
        result = vec3(
          texture2D(uLookup, vec2(redCoordinate, 0.5)).r,
          texture2D(uLookup, vec2(greenCoordinate, 0.5)).g,
          texture2D(uLookup, vec2(blueCoordinate, 0.5)).b
        );
      `
    case 'white-balance': {
      const temperature = operation.params.temperature * 48
      const tint = operation.params.tint * 36
      return `
        result = clamp(
          source.rgb +
            vec3(
              ${numberSource((temperature - tint * 0.25) / 255)},
              ${numberSource(tint / 255)},
              ${numberSource((-temperature - tint * 0.25) / 255)}
            ),
          0.0,
          1.0
        );
      `
    }
    case 'vignette': {
      const parameters = operation.params
      const centerX = (width - 1) / 2
      const centerY = (height - 1) / 2
      return `
        vec2 pixel = vec2(
          vTextureCoordinate.x * ${numberSource(Math.max(0, width - 1))},
          vTextureCoordinate.y * ${numberSource(Math.max(0, height - 1))}
        );
        vec2 normalized = vec2(
          (pixel.x - ${numberSource(centerX)}) /
            ${numberSource(Math.max(1, centerX))},
          (pixel.y - ${numberSource(centerY)}) /
            ${numberSource(Math.max(1, centerY))}
        );
        float distanceFromCenter = length(normalized) / 1.41421356237;
        float strength = smoothstep(
          ${numberSource(parameters.midpoint)},
          ${numberSource(
            Math.min(1, parameters.midpoint + parameters.softness),
          )},
          distanceFromCenter
        ) * ${numberSource(parameters.amount)};
        result = mix(
          source.rgb,
          ${colorSource(parameters.color)},
          strength
        );
      `
    }
    case 'gradient-map':
      return gradientBody(operation.params.stops)
    case 'duotone':
      return gradientBody([
        { offset: 0, color: operation.params.shadows },
        { offset: 1, color: operation.params.highlights },
      ])
    case 'halftone': {
      const parameters = operation.params
      const radians = (parameters.angle * Math.PI) / 180
      const cosine = Math.cos(radians)
      const sine = Math.sin(radians)
      const centerX = (width - 1) / 2
      const centerY = (height - 1) / 2
      return `
        vec2 dimensions = vec2(
          ${numberSource(width)},
          ${numberSource(height)}
        );
        vec2 pixel = floor(vTextureCoordinate * dimensions);
        vec2 relative = pixel - vec2(
          ${numberSource(centerX)},
          ${numberSource(centerY)}
        );
        vec2 rotated = vec2(
          relative.x * ${numberSource(cosine)} +
            relative.y * ${numberSource(sine)},
          -relative.x * ${numberSource(sine)} +
            relative.y * ${numberSource(cosine)}
        );
        vec2 cell = floor(rotated / ${numberSource(parameters.size)}) *
          ${numberSource(parameters.size)} +
          vec2(${numberSource(parameters.size / 2)});
        vec2 samplePixel = clamp(
          floor(
            vec2(
              cell.x * ${numberSource(cosine)} -
                cell.y * ${numberSource(sine)} + ${numberSource(centerX)},
              cell.x * ${numberSource(sine)} +
                cell.y * ${numberSource(cosine)} + ${numberSource(centerY)}
            ) + 0.5
          ),
          vec2(0.0),
          dimensions - 1.0
        );
        vec3 cellColor = texture2D(
          uTexture,
          (samplePixel + 0.5) / dimensions
        ).rgb;
        float darkness = 1.0 - dot(
          cellColor,
          vec3(0.2126, 0.7152, 0.0722)
        );
        float radius = sqrt(darkness) *
          ${numberSource(parameters.size)} * 0.52;
        float cellDistance = length(rotated - cell);
        result = cellDistance <= radius
          ? ${colorSource(parameters.foreground)}
          : ${colorSource(parameters.background)};
      `
    }
    case 'glitch': {
      const parameters = operation.params
      const colorSplit = Math.round(parameters.offset * parameters.amount * 0.5)
      return `
        vec2 dimensions = vec2(
          ${numberSource(width)},
          ${numberSource(height)}
        );
        vec2 pixel = floor(vTextureCoordinate * dimensions);
        vec4 rowData = texture2D(
          uLookup,
          vec2(0.5, (pixel.y + 0.5) / dimensions.y)
        );
        float rowShift =
          floor(rowData.r * 255.0 + 0.5) * 256.0 +
          floor(rowData.g * 255.0 + 0.5) -
          256.0;
        float colorSplit = ${numberSource(colorSplit)};
        float redX = mod(
          mod(pixel.x + rowShift + colorSplit, dimensions.x) + dimensions.x,
          dimensions.x
        );
        float greenX = mod(
          mod(pixel.x + rowShift, dimensions.x) + dimensions.x,
          dimensions.x
        );
        float blueX = mod(
          mod(pixel.x + rowShift - colorSplit, dimensions.x) + dimensions.x,
          dimensions.x
        );
        float sourceY = (pixel.y + 0.5) / dimensions.y;
        float darken = mod(pixel.y, 2.0) >= 1.0
          ? ${numberSource(1 - parameters.scanlines * 0.55)}
          : 1.0;
        result = vec3(
          texture2D(
            uTexture,
            vec2((redX + 0.5) / dimensions.x, sourceY)
          ).r,
          texture2D(
            uTexture,
            vec2((greenX + 0.5) / dimensions.x, sourceY)
          ).g,
          texture2D(
            uTexture,
            vec2((blueX + 0.5) / dimensions.x, sourceY)
          ).b
        ) * darken;
      `
    }
    case 'sepia':
      return `
        vec3 sepia = vec3(
          dot(source.rgb, vec3(0.393, 0.769, 0.189)),
          dot(source.rgb, vec3(0.349, 0.686, 0.168)),
          dot(source.rgb, vec3(0.272, 0.534, 0.131))
        );
        result = mix(source.rgb, sepia, ${numberSource(
          operation.params.amount,
        )});
      `
    case 'invert':
      return `
        result = mix(source.rgb, vec3(1.0) - source.rgb, ${numberSource(
          operation.params.amount,
        )});
      `
    default:
      throw new TypeError(`Filter "${operation.id}" has no WebGL shader.`)
  }
}

const fragmentSource = (
  operation: FilterOperation,
  width: number,
  height: number,
): string => `
  precision highp float;
  uniform sampler2D uTexture;
  uniform sampler2D uLookup;
  varying vec2 vTextureCoordinate;

  void main() {
    vec4 source = texture2D(uTexture, vTextureCoordinate);
    vec3 result = source.rgb;
    ${operationBody(operation, width, height)}
    gl_FragColor = vec4(clamp(result, 0.0, 1.0), source.a);
  }
`

const compileShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL shader allocation failed.')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown compile error'
    gl.deleteShader(shader)
    throw new Error(`WebGL filter shader failed: ${message}`)
  }
  return shader
}

const createProgram = (
  gl: WebGLRenderingContext,
  fragment: string,
): WebGLProgram => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const pixel = compileShader(gl, gl.FRAGMENT_SHADER, fragment)
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL program allocation failed.')
  gl.attachShader(program, vertex)
  gl.attachShader(program, pixel)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(pixel)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown link error'
    gl.deleteProgram(program)
    throw new Error(`WebGL filter program failed: ${message}`)
  }
  return program
}

const createTexture = (
  gl: WebGLRenderingContext,
  width: number,
  height: number,
  data: Uint8ClampedArray | null,
): WebGLTexture => {
  const texture = gl.createTexture()
  if (!texture) throw new Error('WebGL texture allocation failed.')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  )
  return texture
}

/**
 * Uses a compact shader pipeline for point/spatial filters that map cleanly to
 * WebGL 1. Returning null is an expected capability fallback, not an error.
 */
export const tryApplyFilterChainWebGl = (
  image: PixelBuffer,
  candidates: readonly FilterOperation[],
): PixelBuffer | null => {
  if (
    typeof OffscreenCanvas === 'undefined' ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.data.length !== image.width * image.height * 4
  ) {
    return null
  }
  const operations = candidates.map((operation, index) =>
    validateFilterOperation(operation, `filters[${index}]`),
  )
  if (
    operations.length === 0 ||
    operations.some(({ id }) => !GPU_FILTER_IDS.has(id))
  ) {
    return null
  }

  const canvas = new OffscreenCanvas(image.width, image.height)
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    stencil: false,
  }) as WebGLRenderingContext | null
  if (
    !gl ||
    image.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
    image.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)
  ) {
    return null
  }

  const vertices = gl.createBuffer()
  const framebuffer = gl.createFramebuffer()
  if (!vertices || !framebuffer) {
    return null
  }

  let sourceTexture: WebGLTexture | undefined
  let targetTexture: WebGLTexture | undefined
  const lookupTextures: WebGLTexture[] = []
  const programs: WebGLProgram[] = []
  try {
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    sourceTexture = createTexture(gl, image.width, image.height, image.data)
    targetTexture = createTexture(gl, image.width, image.height, null)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.viewport(0, 0, image.width, image.height)
    gl.disable(gl.BLEND)

    for (const operation of operations) {
      const program = createProgram(
        gl,
        fragmentSource(operation, image.width, image.height),
      )
      programs.push(program)
      gl.useProgram(program)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        targetTexture,
        0,
      )
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        return null
      }
      const position = gl.getAttribLocation(program, 'aPosition')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0)
      const lookup = lookupTextureForOperation(operation, image.height)
      if (lookup) {
        gl.activeTexture(gl.TEXTURE1)
        const lookupTexture = createTexture(
          gl,
          lookup.width,
          lookup.height,
          lookup.data,
        )
        lookupTextures.push(lookupTexture)
        gl.uniform1i(gl.getUniformLocation(program, 'uLookup'), 1)
        gl.activeTexture(gl.TEXTURE0)
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      ;[sourceTexture, targetTexture] = [targetTexture, sourceTexture]
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      sourceTexture,
      0,
    )
    const data = new Uint8ClampedArray(image.data.length)
    gl.readPixels(
      0,
      0,
      image.width,
      image.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    )
    if (gl.getError() !== gl.NO_ERROR) {
      return null
    }
    return { width: image.width, height: image.height, data }
  } catch {
    return null
  } finally {
    programs.forEach((program) => gl.deleteProgram(program))
    lookupTextures.forEach((texture) => gl.deleteTexture(texture))
    if (sourceTexture) gl.deleteTexture(sourceTexture)
    if (targetTexture) gl.deleteTexture(targetTexture)
    gl.deleteFramebuffer(framebuffer)
    gl.deleteBuffer(vertices)
  }
}

export const __webGlFilterTesting = {
  curvesLookupTexture,
  fragmentSource,
  glitchLookupTexture,
}
