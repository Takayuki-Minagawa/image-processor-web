import {
  BUILTIN_DESIGN_TEMPLATE_CATALOG,
  BUILTIN_DESIGN_TEMPLATE_PACK_MANIFESTS,
} from './builtinCatalog'
import { DesignTemplateRegistry } from './registry'

export * from './builtinCatalog'
export * from './registry'
export * from './schema'
export * from './userTemplateFile'

export const createBuiltinDesignTemplateRegistry = (): DesignTemplateRegistry =>
  new DesignTemplateRegistry(
    BUILTIN_DESIGN_TEMPLATE_CATALOG,
    BUILTIN_DESIGN_TEMPLATE_PACK_MANIFESTS,
  )

/** Concise compatibility name used by editor integration points. */
export const createBuiltinTemplateRegistry = createBuiltinDesignTemplateRegistry
