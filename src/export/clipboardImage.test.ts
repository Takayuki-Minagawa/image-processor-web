import { afterEach, describe, expect, it, vi } from 'vitest'
import { canCopyPngToClipboard, copyPngToClipboard } from './clipboardImage'

afterEach(() => vi.unstubAllGlobals())

function clipboard(write = vi.fn(async () => undefined)) {
  const items: Record<string, Promise<Blob>>[] = []
  class Item {
    constructor(data: Record<string, Promise<Blob>>) {
      items.push(data)
    }
    static supports = vi.fn(() => true)
  }
  vi.stubGlobal('ClipboardItem', Item)
  vi.stubGlobal('navigator', { clipboard: { write } })
  return { items, write, Item }
}

describe('PNG clipboard export', () => {
  it('calls write during the click task, before rendering resolves', async () => {
    const { items, write } = clipboard()
    const png = new Blob(['png'], { type: 'image/png' })
    const render = vi.fn(async () => png)
    const result = copyPngToClipboard(render)
    expect(write).toHaveBeenCalledOnce()
    expect(render).not.toHaveBeenCalled()
    await expect(items[0]['image/png']).resolves.toBe(png)
    await result
  })

  it('does not render if the browser cannot write PNG', async () => {
    const { Item, write } = clipboard()
    Item.supports.mockReturnValue(false)
    const render = vi.fn()
    expect(canCopyPngToClipboard()).toBe(false)
    await expect(copyPngToClipboard(render)).rejects.toThrow('unavailable')
    expect(render).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('supports browsers without ClipboardItem.supports', () => {
    const { Item } = clipboard()
    Reflect.deleteProperty(Item, 'supports')
    expect(canCopyPngToClipboard()).toBe(true)
  })

  it('reports permission denial without leaving a rejected render unhandled', async () => {
    const denied = new DOMException('Denied', 'NotAllowedError')
    clipboard(
      vi.fn(async () => {
        throw denied
      }),
    )
    await expect(
      copyPngToClipboard(async () => {
        throw new Error('render failed')
      }),
    ).rejects.toBe(denied)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it.each([
    new Blob([], { type: 'image/png' }),
    new Blob(['jpeg'], { type: 'image/jpeg' }),
  ])('rejects empty or incorrectly encoded output', async (blob) => {
    const { items } = clipboard()
    await expect(copyPngToClipboard(async () => blob)).rejects.toThrow(
      'nonempty PNG',
    )
    await expect(items[0]['image/png']).rejects.toThrow('nonempty PNG')
  })
})
