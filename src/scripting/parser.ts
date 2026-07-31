import {
  createDefaultFilterOperation,
  isFilterId,
  validateFilterOperation,
} from '../editor/filters/registry'
import type { FilterOperation } from '../editor/filters/types'
import type {
  AddTextScriptOptions,
  ApplyFilterScriptCommand,
  CurrentLayerReference,
  EditorScriptCommand,
  EditorScriptLimits,
  EditorScriptProgram,
} from './types'

export type EditorScriptErrorCode =
  | 'source-limit'
  | 'syntax'
  | 'forbidden-global'
  | 'unsupported-command'
  | 'invalid-argument'
  | 'command-limit'
  | 'nesting-limit'

export class EditorScriptError extends Error {
  readonly code: EditorScriptErrorCode
  readonly offset: number

  constructor(code: EditorScriptErrorCode, message: string, offset: number) {
    super(`${message} (at ${offset})`)
    this.name = 'EditorScriptError'
    this.code = code
    this.offset = offset
  }
}

type TokenType = 'identifier' | 'number' | 'string' | 'punctuation' | 'eof'

interface Token {
  type: TokenType
  value: string
  offset: number
}

type ScriptLiteral =
  | string
  | number
  | boolean
  | null
  | ScriptLiteral[]
  | { [key: string]: ScriptLiteral }
  | CurrentLayerReference

export const MAX_EDITOR_SCRIPT_SOURCE_LENGTH = 64 * 1024

const DEFAULT_LIMITS: Required<EditorScriptLimits> = {
  maximumSourceLength: MAX_EDITOR_SCRIPT_SOURCE_LENGTH,
  maximumCommands: 1_000,
  maximumNesting: 16,
  maximumCollectionEntries: 256,
  maximumStringLength: 4_096,
}

const FORBIDDEN_IDENTIFIERS = new Set([
  'fetch',
  'document',
  'window',
  'globalThis',
  'self',
  'parent',
  'top',
  'frames',
  'navigator',
  'location',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'importScripts',
  'eval',
  'Function',
  'constructor',
  '__proto__',
  'prototype',
])

const UNSAFE_KEYS = new Set(['constructor', '__proto__', 'prototype'])

const isIdentifierStart = (character: string): boolean =>
  /[A-Za-z_$]/.test(character)

const isIdentifierPart = (character: string): boolean =>
  /[A-Za-z0-9_$]/.test(character)

class Lexer {
  readonly #source: string
  readonly #limits: Required<EditorScriptLimits>
  #offset = 0

  constructor(source: string, limits: Required<EditorScriptLimits>) {
    this.#source = source
    this.#limits = limits
  }

  next(): Token {
    this.#skipWhitespaceAndComments()
    const offset = this.#offset
    if (offset >= this.#source.length) {
      return { type: 'eof', value: '', offset }
    }

    const character = this.#source[offset]
    if (isIdentifierStart(character)) {
      this.#offset += 1
      while (
        this.#offset < this.#source.length &&
        isIdentifierPart(this.#source[this.#offset])
      ) {
        this.#offset += 1
      }
      return {
        type: 'identifier',
        value: this.#source.slice(offset, this.#offset),
        offset,
      }
    }

    const numberMatch = this.#source
      .slice(offset)
      .match(/^(?:(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)/)
    if (numberMatch) {
      this.#offset += numberMatch[0].length
      return { type: 'number', value: numberMatch[0], offset }
    }

    if (character === '"' || character === "'") {
      return this.#readString(character, offset)
    }

    if (this.#source.startsWith('=>', offset)) {
      this.#offset += 2
      return { type: 'punctuation', value: '=>', offset }
    }
    if ('.(),;:{}[]-'.includes(character)) {
      this.#offset += 1
      return { type: 'punctuation', value: character, offset }
    }

    throw new EditorScriptError(
      'syntax',
      `Unsupported token "${character}"`,
      offset,
    )
  }

  #readString(quote: string, start: number): Token {
    this.#offset += 1
    let result = ''
    while (this.#offset < this.#source.length) {
      const character = this.#source[this.#offset]
      this.#offset += 1
      if (character === quote) {
        if (result.length > this.#limits.maximumStringLength) {
          throw new EditorScriptError(
            'source-limit',
            `String literals may contain at most ${this.#limits.maximumStringLength} characters`,
            start,
          )
        }
        return { type: 'string', value: result, offset: start }
      }
      if (character !== '\\') {
        result += character
        continue
      }
      if (this.#offset >= this.#source.length) break
      const escape = this.#source[this.#offset]
      this.#offset += 1
      const simpleEscapes: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        '\\': '\\',
        '"': '"',
        "'": "'",
      }
      if (escape in simpleEscapes) {
        result += simpleEscapes[escape]
      } else if (escape === 'u') {
        const hex = this.#source.slice(this.#offset, this.#offset + 4)
        if (!/^[a-f0-9]{4}$/i.test(hex)) {
          throw new EditorScriptError(
            'syntax',
            'Invalid Unicode escape',
            this.#offset - 2,
          )
        }
        result += String.fromCharCode(Number.parseInt(hex, 16))
        this.#offset += 4
      } else {
        throw new EditorScriptError(
          'syntax',
          `Unsupported string escape "\\${escape}"`,
          this.#offset - 2,
        )
      }
    }
    throw new EditorScriptError('syntax', 'Unterminated string literal', start)
  }

  #skipWhitespaceAndComments(): void {
    while (this.#offset < this.#source.length) {
      if (/\s/.test(this.#source[this.#offset])) {
        this.#offset += 1
        continue
      }
      if (this.#source.startsWith('//', this.#offset)) {
        const newline = this.#source.indexOf('\n', this.#offset + 2)
        this.#offset = newline === -1 ? this.#source.length : newline + 1
        continue
      }
      if (this.#source.startsWith('/*', this.#offset)) {
        const end = this.#source.indexOf('*/', this.#offset + 2)
        if (end === -1) {
          throw new EditorScriptError(
            'syntax',
            'Unterminated block comment',
            this.#offset,
          )
        }
        this.#offset = end + 2
        continue
      }
      return
    }
  }
}

const isPlainObject = (
  value: ScriptLiteral | undefined,
): value is { [key: string]: ScriptLiteral } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !('kind' in value)

const isCurrentLayerReference = (
  value: ScriptLiteral,
): value is CurrentLayerReference =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  'kind' in value &&
  value.kind === 'current-layer' &&
  value.property !== undefined &&
  (value.property === 'id' || value.property === 'name') &&
  typeof value.binding === 'string'

class Parser {
  readonly #lexer: Lexer
  readonly #limits: Required<EditorScriptLimits>
  #current: Token
  #commandCount = 0

  constructor(source: string, limits: Required<EditorScriptLimits>) {
    this.#lexer = new Lexer(source, limits)
    this.#limits = limits
    this.#current = this.#lexer.next()
  }

  parse(): EditorScriptProgram {
    const commands: EditorScriptCommand[] = []
    while (this.#current.type !== 'eof') {
      commands.push(this.#parseEditorStatement(undefined, 0))
    }
    return { schemaVersion: 1, commands }
  }

  #parseEditorStatement(
    binding: string | undefined,
    nesting: number,
  ): EditorScriptCommand {
    if (nesting > this.#limits.maximumNesting) {
      throw new EditorScriptError(
        'nesting-limit',
        `Scripts may nest at most ${this.#limits.maximumNesting} levels`,
        this.#current.offset,
      )
    }
    const root = this.#expect('identifier')
    if (root.value !== 'editor') {
      this.#rejectIdentifier(root)
      throw new EditorScriptError(
        'syntax',
        'Only editor API calls are allowed',
        root.offset,
      )
    }
    this.#expectValue('.')
    const method = this.#expect('identifier')
    if (FORBIDDEN_IDENTIFIERS.has(method.value)) {
      throw new EditorScriptError(
        'forbidden-global',
        `Property "${method.value}" is forbidden`,
        method.offset,
      )
    }
    if (method.value === 'forEachLayer') {
      return this.#parseForEachLayer(binding, nesting, method.offset)
    }

    const arguments_ = this.#parseArguments(binding, nesting)
    this.#optional(';')
    let command: EditorScriptCommand
    switch (method.value) {
      case 'resize':
        if (binding) {
          throw new EditorScriptError(
            'unsupported-command',
            'editor.resize cannot run inside forEachLayer',
            method.offset,
          )
        }
        command = this.#createResize(arguments_, method.offset)
        break
      case 'applyFilter':
        command = this.#createApplyFilter(arguments_, binding, method.offset)
        break
      case 'addText':
        if (binding) {
          throw new EditorScriptError(
            'unsupported-command',
            'editor.addText cannot run inside forEachLayer',
            method.offset,
          )
        }
        command = this.#createAddText(arguments_, method.offset)
        break
      default:
        throw new EditorScriptError(
          'unsupported-command',
          `editor.${method.value} is not a supported command`,
          method.offset,
        )
    }
    this.#countCommand(method.offset)
    return command
  }

  #parseForEachLayer(
    outerBinding: string | undefined,
    nesting: number,
    offset: number,
  ): EditorScriptCommand {
    if (outerBinding) {
      throw new EditorScriptError(
        'unsupported-command',
        'Nested forEachLayer calls are not supported',
        offset,
      )
    }
    this.#expectValue('(')
    const binding = this.#expect('identifier')
    if (
      binding.value === 'editor' ||
      FORBIDDEN_IDENTIFIERS.has(binding.value)
    ) {
      throw new EditorScriptError(
        'forbidden-global',
        `Callback binding "${binding.value}" is forbidden`,
        binding.offset,
      )
    }
    this.#expectValue('=>')
    this.#expectValue('{')
    const commands: EditorScriptCommand[] = []
    while (!this.#matches('}')) {
      if (this.#current.type === 'eof') {
        throw new EditorScriptError(
          'syntax',
          'Unterminated forEachLayer block',
          offset,
        )
      }
      commands.push(this.#parseEditorStatement(binding.value, nesting + 1))
    }
    this.#expectValue('}')
    this.#expectValue(')')
    this.#optional(';')
    if (commands.length === 0) {
      throw new EditorScriptError(
        'invalid-argument',
        'forEachLayer callback cannot be empty',
        offset,
      )
    }
    this.#countCommand(offset)
    return {
      type: 'forEachLayer',
      binding: binding.value,
      commands,
    }
  }

  #parseArguments(
    binding: string | undefined,
    nesting: number,
  ): ScriptLiteral[] {
    this.#expectValue('(')
    const arguments_: ScriptLiteral[] = []
    if (!this.#matches(')')) {
      while (true) {
        arguments_.push(this.#parseValue(binding, nesting + 1))
        if (!this.#optional(',')) break
        if (arguments_.length >= this.#limits.maximumCollectionEntries) {
          throw new EditorScriptError(
            'source-limit',
            `Calls may contain at most ${this.#limits.maximumCollectionEntries} arguments`,
            this.#current.offset,
          )
        }
      }
    }
    this.#expectValue(')')
    return arguments_
  }

  #parseValue(binding: string | undefined, nesting: number): ScriptLiteral {
    if (nesting > this.#limits.maximumNesting) {
      throw new EditorScriptError(
        'nesting-limit',
        `Values may nest at most ${this.#limits.maximumNesting} levels`,
        this.#current.offset,
      )
    }
    if (this.#optional('-')) {
      const number = this.#expect('number')
      return -Number(number.value)
    }
    if (this.#current.type === 'number') {
      return Number(this.#advance().value)
    }
    if (this.#current.type === 'string') {
      return this.#advance().value
    }
    if (this.#current.type === 'identifier') {
      const identifier = this.#advance()
      if (identifier.value === 'true') return true
      if (identifier.value === 'false') return false
      if (identifier.value === 'null') return null
      if (binding && identifier.value === binding) {
        this.#expectValue('.')
        const property = this.#expect('identifier')
        if (property.value !== 'id' && property.value !== 'name') {
          throw new EditorScriptError(
            'forbidden-global',
            'Layer callbacks expose only id and name',
            property.offset,
          )
        }
        return {
          kind: 'current-layer',
          binding,
          property: property.value,
        }
      }
      this.#rejectIdentifier(identifier)
      throw new EditorScriptError(
        'syntax',
        `Identifier "${identifier.value}" is not a literal`,
        identifier.offset,
      )
    }
    if (this.#optional('[')) {
      const values: ScriptLiteral[] = []
      if (!this.#matches(']')) {
        while (true) {
          values.push(this.#parseValue(binding, nesting + 1))
          if (values.length > this.#limits.maximumCollectionEntries) {
            throw new EditorScriptError(
              'source-limit',
              `Arrays may contain at most ${this.#limits.maximumCollectionEntries} entries`,
              this.#current.offset,
            )
          }
          if (!this.#optional(',')) break
        }
      }
      this.#expectValue(']')
      return values
    }
    if (this.#optional('{')) {
      const object: { [key: string]: ScriptLiteral } = Object.create(null)
      let entries = 0
      if (!this.#matches('}')) {
        while (true) {
          const current = this.#current as Token
          const key =
            current.type === 'identifier' || current.type === 'string'
              ? this.#advance()
              : this.#expect('identifier')
          if (UNSAFE_KEYS.has(key.value)) {
            throw new EditorScriptError(
              'forbidden-global',
              `Object key "${key.value}" is forbidden`,
              key.offset,
            )
          }
          this.#expectValue(':')
          object[key.value] = this.#parseValue(binding, nesting + 1)
          entries += 1
          if (entries > this.#limits.maximumCollectionEntries) {
            throw new EditorScriptError(
              'source-limit',
              `Objects may contain at most ${this.#limits.maximumCollectionEntries} entries`,
              key.offset,
            )
          }
          if (!this.#optional(',')) break
        }
      }
      this.#expectValue('}')
      return object
    }
    throw new EditorScriptError(
      'syntax',
      'Expected a capability-free literal',
      this.#current.offset,
    )
  }

  #createResize(
    arguments_: ScriptLiteral[],
    offset: number,
  ): EditorScriptCommand {
    if (
      arguments_.length !== 2 ||
      !Number.isSafeInteger(arguments_[0]) ||
      !Number.isSafeInteger(arguments_[1])
    ) {
      throw new EditorScriptError(
        'invalid-argument',
        'editor.resize requires integer width and height',
        offset,
      )
    }
    const width = arguments_[0] as number
    const height = arguments_[1] as number
    if (
      width <= 0 ||
      height <= 0 ||
      width > 8_192 ||
      height > 8_192 ||
      width * height > 64 * 1024 * 1024
    ) {
      throw new EditorScriptError(
        'invalid-argument',
        'editor.resize exceeds the 8,192 px / 64 MP limit',
        offset,
      )
    }
    return { type: 'resizeCanvas', width, height }
  }

  #createApplyFilter(
    arguments_: ScriptLiteral[],
    binding: string | undefined,
    offset: number,
  ): ApplyFilterScriptCommand {
    if (
      arguments_.length < 1 ||
      arguments_.length > 3 ||
      typeof arguments_[0] !== 'string' ||
      !isFilterId(arguments_[0])
    ) {
      throw new EditorScriptError(
        'invalid-argument',
        'editor.applyFilter requires a registered filter name',
        offset,
      )
    }
    const defaults = createDefaultFilterOperation(arguments_[0])
    const overrides = arguments_[1]
    if (overrides !== undefined && !isPlainObject(overrides)) {
      throw new EditorScriptError(
        'invalid-argument',
        'Filter parameters must be an object literal',
        offset,
      )
    }
    let operation: FilterOperation
    try {
      operation = validateFilterOperation({
        id: arguments_[0],
        params: {
          ...defaults.params,
          ...(overrides ?? {}),
        },
      })
    } catch (error) {
      throw new EditorScriptError(
        'invalid-argument',
        error instanceof Error ? error.message : 'Invalid filter parameters',
        offset,
      )
    }

    let targetLayer: ApplyFilterScriptCommand['targetLayer']
    const suppliedTarget = arguments_[2]
    if (suppliedTarget !== undefined) {
      if (
        typeof suppliedTarget === 'string' &&
        suppliedTarget.length > 0 &&
        suppliedTarget.length <= 100
      ) {
        targetLayer = suppliedTarget
      } else if (
        isCurrentLayerReference(suppliedTarget) &&
        suppliedTarget.property === 'id'
      ) {
        targetLayer = suppliedTarget
      } else {
        throw new EditorScriptError(
          'invalid-argument',
          'Filter target must be a layer id or the current layer.id',
          offset,
        )
      }
    } else if (binding) {
      targetLayer = {
        kind: 'current-layer',
        binding,
        property: 'id',
      }
    }

    return {
      type: 'applyFilter',
      operation,
      ...(targetLayer === undefined ? {} : { targetLayer }),
    }
  }

  #createAddText(
    arguments_: ScriptLiteral[],
    offset: number,
  ): EditorScriptCommand {
    if (
      arguments_.length < 1 ||
      arguments_.length > 2 ||
      typeof arguments_[0] !== 'string'
    ) {
      throw new EditorScriptError(
        'invalid-argument',
        'editor.addText requires text and an optional options object',
        offset,
      )
    }
    const text = arguments_[0]
    if (text.length === 0 || text.length > this.#limits.maximumStringLength) {
      throw new EditorScriptError(
        'invalid-argument',
        'Text must be non-empty and within the string limit',
        offset,
      )
    }
    const candidate = arguments_[1]
    if (candidate !== undefined && !isPlainObject(candidate)) {
      throw new EditorScriptError(
        'invalid-argument',
        'Text options must be an object literal',
        offset,
      )
    }
    const record = candidate ?? {}
    const allowed = new Set([
      'left',
      'top',
      'fill',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'name',
    ])
    const unsupported = Object.keys(record).find((key) => !allowed.has(key))
    if (unsupported) {
      throw new EditorScriptError(
        'invalid-argument',
        `Unsupported text option "${unsupported}"`,
        offset,
      )
    }

    const options: AddTextScriptOptions = {}
    const coordinate = (key: 'left' | 'top'): void => {
      const value = record[key]
      if (value === undefined) return
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < -8_192 ||
        value > 8_192
      ) {
        throw new EditorScriptError(
          'invalid-argument',
          `${key} must be a finite document coordinate`,
          offset,
        )
      }
      options[key] = value
    }
    coordinate('left')
    coordinate('top')

    const stringOption = (
      key: 'fill' | 'fontFamily' | 'name',
      maximum: number,
    ): void => {
      const value = record[key]
      if (value === undefined) return
      if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximum
      ) {
        throw new EditorScriptError(
          'invalid-argument',
          `${key} must be a bounded non-empty string`,
          offset,
        )
      }
      options[key] = value
    }
    stringOption('fill', 100)
    stringOption('fontFamily', 200)
    stringOption('name', 200)

    if (record.fontSize !== undefined) {
      if (
        typeof record.fontSize !== 'number' ||
        !Number.isFinite(record.fontSize) ||
        record.fontSize < 1 ||
        record.fontSize > 1_024
      ) {
        throw new EditorScriptError(
          'invalid-argument',
          'fontSize must be from 1 to 1024',
          offset,
        )
      }
      options.fontSize = record.fontSize
    }
    if (record.fontWeight !== undefined) {
      if (
        (typeof record.fontWeight !== 'string' &&
          typeof record.fontWeight !== 'number') ||
        (typeof record.fontWeight === 'number' &&
          !Number.isFinite(record.fontWeight))
      ) {
        throw new EditorScriptError(
          'invalid-argument',
          'fontWeight must be a string or finite number',
          offset,
        )
      }
      options.fontWeight = record.fontWeight
    }

    return { type: 'addText', text, options }
  }

  #rejectIdentifier(token: Token): void {
    if (FORBIDDEN_IDENTIFIERS.has(token.value)) {
      throw new EditorScriptError(
        'forbidden-global',
        `Global capability "${token.value}" is forbidden`,
        token.offset,
      )
    }
  }

  #countCommand(offset: number): void {
    this.#commandCount += 1
    if (this.#commandCount > this.#limits.maximumCommands) {
      throw new EditorScriptError(
        'command-limit',
        `Scripts may emit at most ${this.#limits.maximumCommands} commands`,
        offset,
      )
    }
  }

  #matches(value: string): boolean {
    return this.#current.value === value
  }

  #optional(value: string): boolean {
    if (!this.#matches(value)) return false
    this.#advance()
    return true
  }

  #expectValue(value: string): Token {
    if (!this.#matches(value)) {
      throw new EditorScriptError(
        'syntax',
        `Expected "${value}" but found "${this.#current.value || 'end of script'}"`,
        this.#current.offset,
      )
    }
    return this.#advance()
  }

  #expect(type: TokenType): Token {
    if (this.#current.type !== type) {
      throw new EditorScriptError(
        'syntax',
        `Expected ${type} but found "${this.#current.value || 'end of script'}"`,
        this.#current.offset,
      )
    }
    return this.#advance()
  }

  #advance(): Token {
    const token = this.#current
    this.#current = this.#lexer.next()
    return token
  }
}

const resolveLimits = (
  options: EditorScriptLimits = {},
): Required<EditorScriptLimits> => {
  const limits = { ...DEFAULT_LIMITS, ...options }
  Object.entries(limits).forEach(([name, value]) => {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer.`)
    }
  })
  return limits
}

/**
 * Parses a deliberately small JavaScript-like editor DSL.
 *
 * No source is evaluated. The result is plain validated command data, and the
 * grammar has no variable lookup, property traversal, imports, loops, or
 * access to browser capabilities.
 */
export const parseEditorScript = (
  source: string,
  options: EditorScriptLimits = {},
): EditorScriptProgram => {
  if (typeof source !== 'string') {
    throw new TypeError('Editor script source must be a string.')
  }
  const limits = resolveLimits(options)
  if (source.length > limits.maximumSourceLength) {
    throw new EditorScriptError(
      'source-limit',
      `Scripts may contain at most ${limits.maximumSourceLength} characters`,
      limits.maximumSourceLength,
    )
  }
  return new Parser(source, limits).parse()
}
