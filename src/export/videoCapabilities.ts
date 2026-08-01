export type VideoExportFormat = 'mp4' | 'webm' | 'gif'

export interface VideoEncoderProbeConfig {
  codec: string
  width: number
  height: number
  framerate: number
  bitrate: number
  avc?: { format: 'avc' }
}

export interface VideoEncoderSupportProbe {
  isConfigSupported(
    config: VideoEncoderProbeConfig,
  ): Promise<{ supported?: boolean }>
}

export interface VideoCapabilityRuntime {
  videoEncoder?: VideoEncoderSupportProbe
  hasVideoFrame: boolean
  muxers?: Partial<Record<'mp4' | 'webm', boolean>>
}

export interface VideoProbeSettings {
  width?: number
  height?: number
  framerate?: number
  bitrate?: number
}

export type VideoCapabilityReason =
  | 'supported'
  | 'webcodecs-unavailable'
  | 'codec-unsupported'
  | 'muxer-unavailable'
  | 'gif-fallback'

export interface VideoFormatCapability {
  supported: boolean
  reason: VideoCapabilityReason
  codec?: string
}

export interface VideoExportCapabilities {
  webCodecsAvailable: boolean
  formats: Record<VideoExportFormat, VideoFormatCapability>
}

export interface SelectedVideoExportTarget {
  format: VideoExportFormat
  capability: VideoFormatCapability
  fallbackFrom?: Exclude<VideoExportFormat, 'gif'>
}

const safeProbe = async (
  probe: VideoEncoderSupportProbe,
  config: VideoEncoderProbeConfig,
): Promise<boolean> => {
  try {
    return (await probe.isConfigSupported(config)).supported === true
  } catch {
    return false
  }
}

const unsupportedCapability = (
  reason: Exclude<VideoCapabilityReason, 'supported' | 'gif-fallback'>,
): VideoFormatCapability => ({ supported: false, reason })

/**
 * WebCodecs only produces encoded chunks, so codec support and a container
 * muxer are deliberately checked separately.
 */
export const detectVideoExportCapabilities = async (
  runtime: VideoCapabilityRuntime,
  settings: VideoProbeSettings = {},
): Promise<VideoExportCapabilities> => {
  const width = settings.width ?? 1_920
  const height = settings.height ?? 1_080
  const framerate = settings.framerate ?? 30
  const bitrate = settings.bitrate ?? 8_000_000
  for (const [label, value] of Object.entries({
    width,
    height,
    framerate,
    bitrate,
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label} must be a positive finite number.`)
    }
  }

  const webCodecsAvailable =
    runtime.videoEncoder !== undefined && runtime.hasVideoFrame
  const gif: VideoFormatCapability = {
    supported: true,
    reason: 'gif-fallback',
  }
  if (!webCodecsAvailable || !runtime.videoEncoder) {
    return {
      webCodecsAvailable: false,
      formats: {
        mp4: unsupportedCapability('webcodecs-unavailable'),
        webm: unsupportedCapability('webcodecs-unavailable'),
        gif,
      },
    }
  }

  const baseConfig = { width, height, framerate, bitrate }
  const [h264Supported, vp9Supported, vp8Supported] = await Promise.all([
    safeProbe(runtime.videoEncoder, {
      ...baseConfig,
      codec: 'avc1.42001E',
      avc: { format: 'avc' },
    }),
    safeProbe(runtime.videoEncoder, {
      ...baseConfig,
      codec: 'vp09.00.10.08',
    }),
    safeProbe(runtime.videoEncoder, { ...baseConfig, codec: 'vp8' }),
  ])

  const mp4 = !h264Supported
    ? unsupportedCapability('codec-unsupported')
    : runtime.muxers?.mp4 !== true
      ? unsupportedCapability('muxer-unavailable')
      : ({
          supported: true,
          reason: 'supported',
          codec: 'avc1.42001E',
        } satisfies VideoFormatCapability)
  const webmCodec = vp9Supported ? 'vp09.00.10.08' : vp8Supported ? 'vp8' : null
  const webm = !webmCodec
    ? unsupportedCapability('codec-unsupported')
    : runtime.muxers?.webm !== true
      ? unsupportedCapability('muxer-unavailable')
      : ({
          supported: true,
          reason: 'supported',
          codec: webmCodec,
        } satisfies VideoFormatCapability)

  return {
    webCodecsAvailable: true,
    formats: { mp4, webm, gif },
  }
}

/** MP4 may fall back to WebM; every animated export can fall back to GIF. */
export const selectVideoExportTarget = (
  preferred: VideoExportFormat,
  capabilities: VideoExportCapabilities,
): SelectedVideoExportTarget => {
  const candidates: VideoExportFormat[] =
    preferred === 'mp4'
      ? ['mp4', 'webm', 'gif']
      : preferred === 'webm'
        ? ['webm', 'gif']
        : ['gif']
  const format =
    candidates.find((candidate) => capabilities.formats[candidate].supported) ??
    'gif'
  return {
    format,
    capability: capabilities.formats[format],
    ...(format === preferred || preferred === 'gif'
      ? {}
      : { fallbackFrom: preferred }),
  }
}

interface WebCodecsGlobal {
  VideoEncoder?: VideoEncoderSupportProbe
  VideoFrame?: unknown
}

/** Captures browser globals without making capability checks hard to test. */
export const browserVideoCapabilityRuntime = (
  muxers: VideoCapabilityRuntime['muxers'] = {},
): VideoCapabilityRuntime => {
  const webCodecs = globalThis as unknown as WebCodecsGlobal
  return {
    videoEncoder: webCodecs.VideoEncoder,
    hasVideoFrame: webCodecs.VideoFrame !== undefined,
    muxers,
  }
}
