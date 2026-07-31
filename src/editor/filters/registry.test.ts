import { describe, expect, it } from 'vitest'
import {
  FilterValidationError,
  createDefaultFilterOperation,
  listFilterDefinitions,
  validateFilterOperation,
} from './registry'
import { createIdentityCurve } from './types'

describe('filter registry', () => {
  it('contains every planned built-in and custom filter exactly once', () => {
    const definitions = listFilterDefinitions()
    const ids = definitions.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'sharpen',
      'emboss',
      'noise',
      'pixelate',
      'sepia',
      'invert',
      'levels',
      'curves',
      'white-balance',
      'vignette',
      'gradient-map',
      'duotone',
      'halftone',
      'glitch',
    ])
    definitions.forEach(({ id }) => {
      expect(() =>
        validateFilterOperation(createDefaultFilterOperation(id)),
      ).not.toThrow()
    })
  })

  it('deep-clones default arrays and colors', () => {
    const first = createDefaultFilterOperation('curves')
    const second = createDefaultFilterOperation('curves')
    first.params.master[0] = 255

    expect(second.params.master[0]).toBe(0)
  })

  it('validates cross-field levels constraints and exact parameter keys', () => {
    expect(() =>
      validateFilterOperation({
        id: 'levels',
        params: {
          inputBlack: 200,
          inputWhite: 100,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        },
      }),
    ).toThrow(
      expect.objectContaining<Partial<FilterValidationError>>({
        code: 'invalid-parameter',
        path: 'filter.params.inputWhite',
      }),
    )

    expect(() =>
      validateFilterOperation({
        id: 'invert',
        params: { amount: 1, constructor: 'unsafe' },
      }),
    ).toThrow('not a supported parameter')
  })

  it('requires complete bounded curve LUTs and ordered gradient stops', () => {
    expect(() =>
      validateFilterOperation({
        id: 'curves',
        params: {
          master: createIdentityCurve().slice(1),
          red: createIdentityCurve(),
          green: createIdentityCurve(),
          blue: createIdentityCurve(),
        },
      }),
    ).toThrow('exactly 256')

    expect(() =>
      validateFilterOperation({
        id: 'gradient-map',
        params: {
          stops: [
            { offset: 0, color: { r: 0, g: 0, b: 0 } },
            { offset: 0.5, color: { r: 1, g: 2, b: 3 } },
            { offset: 0.5, color: { r: 4, g: 5, b: 6 } },
            { offset: 1, color: { r: 255, g: 255, b: 255 } },
          ],
        },
      }),
    ).toThrow('strictly increasing')
  })

  it('reports unknown filter identifiers without accepting their payload', () => {
    expect(() =>
      validateFilterOperation({
        id: 'remote-code',
        params: {},
      }),
    ).toThrow(
      expect.objectContaining<Partial<FilterValidationError>>({
        code: 'unknown-filter',
        path: 'filter.id',
      }),
    )
  })
})
