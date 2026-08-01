import { describe, expect, it, vi } from 'vitest'
import {
  detectVideoExportCapabilities,
  selectVideoExportTarget,
  type VideoEncoderProbeConfig,
  type VideoEncoderSupportProbe,
} from './videoCapabilities'

const probeFrom = (
  supportedCodecs: readonly string[],
): VideoEncoderSupportProbe => ({
  isConfigSupported: vi.fn(async (config: VideoEncoderProbeConfig) => ({
    supported: supportedCodecs.includes(config.codec),
  })),
})

describe('video export capability detection', () => {
  it('selects GIF when WebCodecs is absent', async () => {
    const capabilities = await detectVideoExportCapabilities({
      hasVideoFrame: false,
    })

    expect(capabilities.webCodecsAvailable).toBe(false)
    expect(capabilities.formats.mp4.reason).toBe('webcodecs-unavailable')
    expect(selectVideoExportTarget('mp4', capabilities)).toMatchObject({
      format: 'gif',
      fallbackFrom: 'mp4',
      capability: { supported: true, reason: 'gif-fallback' },
    })
  })

  it('falls from unsupported H.264 to a supported WebM codec', async () => {
    const probe = probeFrom(['vp09.00.10.08'])
    const capabilities = await detectVideoExportCapabilities({
      videoEncoder: probe,
      hasVideoFrame: true,
      muxers: { mp4: true, webm: true },
    })

    expect(capabilities.formats.mp4).toEqual({
      supported: false,
      reason: 'codec-unsupported',
    })
    expect(capabilities.formats.webm).toEqual({
      supported: true,
      reason: 'supported',
      codec: 'vp09.00.10.08',
    })
    expect(selectVideoExportTarget('mp4', capabilities)).toMatchObject({
      format: 'webm',
      fallbackFrom: 'mp4',
    })
  })

  it('does not claim a format when the matching muxer is missing', async () => {
    const capabilities = await detectVideoExportCapabilities({
      videoEncoder: probeFrom(['avc1.42001E', 'vp8']),
      hasVideoFrame: true,
      muxers: { webm: true },
    })

    expect(capabilities.formats.mp4.reason).toBe('muxer-unavailable')
    expect(capabilities.formats.webm.codec).toBe('vp8')
    expect(selectVideoExportTarget('mp4', capabilities).format).toBe('webm')
  })

  it('treats probe rejection as unsupported instead of failing export setup', async () => {
    const capabilities = await detectVideoExportCapabilities({
      videoEncoder: {
        isConfigSupported: async () => {
          throw new DOMException('not allowed', 'NotSupportedError')
        },
      },
      hasVideoFrame: true,
      muxers: { mp4: true, webm: true },
    })

    expect(capabilities.formats.mp4.reason).toBe('codec-unsupported')
    expect(capabilities.formats.webm.reason).toBe('codec-unsupported')
    expect(selectVideoExportTarget('webm', capabilities).format).toBe('gif')
  })

  it('validates the frame settings before probing', async () => {
    await expect(
      detectVideoExportCapabilities(
        {
          videoEncoder: probeFrom([]),
          hasVideoFrame: true,
        },
        { framerate: 0 },
      ),
    ).rejects.toThrow('framerate')
  })
})
