import { describe, expect, it } from 'vitest'
import { selectMediaRecorderMimeType } from './mediaRecorder'

describe('MediaRecorder video target selection', () => {
  it('prefers MP4 and then WebM containers', () => {
    expect(
      selectMediaRecorderMimeType((type) => type.startsWith('video/mp4')),
    ).toMatch(/^video\/mp4/u)
    expect(selectMediaRecorderMimeType((type) => type.includes('vp8'))).toBe(
      'video/webm;codecs=vp8',
    )
  })

  it('returns null when the browser has no matching muxer', () => {
    expect(selectMediaRecorderMimeType(() => false)).toBeNull()
  })
})
