import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'
import { DEFAULT_BACKGROUND_MODEL } from './defaultModel'

const contentSecurityPolicy = (): Map<string, string[]> => {
  const document = new DOMParser().parseFromString(indexHtml, 'text/html')
  const content = document
    .querySelector<HTMLMetaElement>(
      'meta[http-equiv="Content-Security-Policy"]',
    )
    ?.content.trim()
  if (!content) {
    throw new Error('index.html must declare a Content-Security-Policy.')
  }

  return new Map(
    content
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/u)
        return [name, sources]
      }),
  )
}

describe('background model Content Security Policy', () => {
  it('allows only the pinned model host while retaining Worker/WASM requirements', () => {
    const policy = contentSecurityPolicy()
    const modelDownloadUrl = DEFAULT_BACKGROUND_MODEL.downloadUrl
    if (!modelDownloadUrl) {
      throw new Error('The default background model must have a download URL.')
    }
    const modelUrl = new URL(modelDownloadUrl)

    expect(modelUrl.protocol).toBe('https:')
    expect(modelUrl.hostname).toBe('huggingface.co')
    expect(policy.get('default-src')).toEqual(["'self'"])
    expect(policy.get('connect-src')).toEqual([
      "'self'",
      'https://huggingface.co',
      'https://*.hf.co',
    ])
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(policy.get('script-src')).not.toContain("'unsafe-eval'")
    expect(policy.get('worker-src')).toEqual(["'self'", 'blob:'])
    expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'blob:'])
    expect(policy.get('object-src')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'self'"])
    expect(policy.get('form-action')).toEqual(["'self'"])
  })
})
