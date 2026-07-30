import { describe, expect, it } from 'vitest'
import { AsyncOperationGate } from './asyncOperationGate'

describe('AsyncOperationGate', () => {
  it('waits for tracked editor work to settle', async () => {
    const gate = new AsyncOperationGate()
    let finish: ((value: string) => void) | undefined
    const operation = new Promise<string>((resolve) => {
      finish = resolve
    })

    const tracked = gate.track(operation)
    const idle = gate.waitForIdle()
    expect(gate.size).toBe(1)

    finish?.('done')
    await expect(tracked).resolves.toBe('done')
    await expect(idle).resolves.toBeUndefined()
    expect(gate.size).toBe(0)
  })

  it('drains work added while a prior operation is settling', async () => {
    const gate = new AsyncOperationGate()
    let finishFirst: (() => void) | undefined
    let finishSecond: (() => void) | undefined
    const first = gate.track(
      new Promise<void>((resolve) => {
        finishFirst = resolve
      }),
    )
    const idle = gate.waitForIdle()

    const second = gate.track(
      new Promise<void>((resolve) => {
        finishSecond = resolve
      }),
    )
    finishFirst?.()
    await first
    expect(gate.size).toBe(1)

    finishSecond?.()
    await second
    await idle
    expect(gate.size).toBe(0)
  })

  it('becomes idle after a rejected operation without hiding its error', async () => {
    const gate = new AsyncOperationGate()
    const error = new Error('clone failed')
    const tracked = gate.track(Promise.reject(error))
    const idle = gate.waitForIdle()

    await expect(tracked).rejects.toBe(error)
    await expect(idle).resolves.toBeUndefined()
    expect(gate.size).toBe(0)
  })
})
