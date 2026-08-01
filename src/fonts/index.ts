import { BUILTIN_FONT_REGISTRATIONS } from './builtinCatalog'
import { FontRegistry } from './registry'

export * from './builtinCatalog'
export * from './registry'
export * from './types'
export * from './projectFonts'
export * from './userFontMetadata'
export * from './userFontRepository'

export const createBuiltinFontRegistry = (): FontRegistry =>
  new FontRegistry(BUILTIN_FONT_REGISTRATIONS)
