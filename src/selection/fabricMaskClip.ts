import { FabricImage } from 'fabric'
import { SelectionMask, type SelectionMaskBounds } from './mask'

/**
 * Creates a native, serializable Fabric clip while allocating only the mask
 * region that intersects the edit. Fabric persists the alpha canvas as a PNG,
 * so normal clone/snapshot/restore paths need no special project loader.
 */
export const createSelectionMaskClip = (
  mask: SelectionMask,
  bounds: SelectionMaskBounds,
): FabricImage => {
  const cropped = mask.crop(bounds)
  const canvas = document.createElement('canvas')
  canvas.width = cropped.width
  canvas.height = cropped.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('選択範囲クリップ用Canvasを作成できませんでした。')
  }

  const alpha = cropped.toBytes()
  const pixels = context.createImageData(canvas.width, canvas.height)
  for (let index = 0; index < alpha.length; index += 1) {
    pixels.data[index * 4 + 3] = alpha[index]
  }
  context.putImageData(pixels, 0, 0)

  return new FabricImage(canvas, {
    left: bounds.left,
    top: bounds.top,
    originX: 'left',
    originY: 'top',
    absolutePositioned: true,
    selectable: false,
    evented: false,
  })
}
