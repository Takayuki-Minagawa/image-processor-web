import type { FilterOperation } from '../editor/filters/types'

export interface CurrentLayerReference {
  kind: 'current-layer'
  binding: string
  property: 'id' | 'name'
}

export type ScriptLayerTarget = string | CurrentLayerReference

export interface ResizeCanvasScriptCommand {
  type: 'resizeCanvas'
  width: number
  height: number
}

export interface ApplyFilterScriptCommand {
  type: 'applyFilter'
  operation: FilterOperation
  targetLayer?: ScriptLayerTarget
}

export interface AddTextScriptOptions {
  left?: number
  top?: number
  fill?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: string | number
  name?: string
}

export interface AddTextScriptCommand {
  type: 'addText'
  text: string
  options: AddTextScriptOptions
}

export interface ForEachLayerScriptCommand {
  type: 'forEachLayer'
  binding: string
  commands: EditorScriptCommand[]
}

export type EditorScriptCommand =
  | ResizeCanvasScriptCommand
  | ApplyFilterScriptCommand
  | AddTextScriptCommand
  | ForEachLayerScriptCommand

export interface EditorScriptProgram {
  schemaVersion: 1
  commands: EditorScriptCommand[]
}

export interface EditorScriptLimits {
  maximumSourceLength?: number
  maximumCommands?: number
  maximumNesting?: number
  maximumCollectionEntries?: number
  maximumStringLength?: number
}
