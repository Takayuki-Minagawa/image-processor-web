import { describe, expect, it } from 'vitest'
import {
  createSavedEditorScript,
  serializeSavedEditorScript,
} from './savedScripts'
import {
  DEFAULT_SCRIPT_STORAGE_KEY,
  LocalScriptRepository,
  type ScriptStorage,
} from './scriptRepository'

class MemoryStorage implements ScriptStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const script = (id: string, updatedAt: string, width = 640) =>
  createSavedEditorScript({
    appVersion: '0.1.0',
    id,
    name: id,
    source: `editor.resize(${width}, 480);`,
    createdAt: updatedAt,
    updatedAt,
  })

describe('LocalScriptRepository', () => {
  it('saves, replaces, orders, loads, deletes, and clears named scripts', () => {
    const storage = new MemoryStorage()
    const repository = new LocalScriptRepository(storage)
    repository.save(script('older', '2026-07-30T00:00:00.000Z'))
    repository.save(script('newer', '2026-07-31T00:00:00.000Z'))
    repository.save(script('older', '2026-08-01T00:00:00.000Z', 800))

    expect(repository.list().map(({ script: item }) => item.id)).toEqual([
      'older',
      'newer',
    ])
    expect(repository.get('older')).toMatchObject({
      script: { name: 'older' },
      program: {
        commands: [{ type: 'resizeCanvas', width: 800, height: 480 }],
      },
    })
    expect(repository.remove('missing')).toBe(false)
    expect(repository.remove('newer')).toBe(true)
    expect(repository.get('newer')).toBeNull()
    repository.clear()
    expect(repository.list()).toEqual([])
    expect(storage.getItem(DEFAULT_SCRIPT_STORAGE_KEY)).toBeNull()
  })

  it('returns defensive entries instead of mutable repository state', () => {
    const repository = new LocalScriptRepository(new MemoryStorage())
    repository.save(script('safe', '2026-07-31T00:00:00.000Z'))
    const loaded = repository.get('safe')!

    loaded.script.name = 'tampered'
    const resize = loaded.program.commands[0]
    if (resize.type === 'resizeCanvas') {
      resize.width = 1
    }

    expect(repository.get('safe')).toMatchObject({
      script: { name: 'safe' },
      program: {
        commands: [{ type: 'resizeCanvas', width: 640, height: 480 }],
      },
    })
  })

  it('isolates malformed envelopes and unsafe source without losing valid entries', () => {
    const storage = new MemoryStorage()
    const safe = script('safe', '2026-07-31T00:00:00.000Z')
    storage.setItem(
      DEFAULT_SCRIPT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        scripts: [
          '{broken',
          JSON.stringify({
            ...safe,
            id: 'unsafe',
            source: 'document.body.textContent = "leak"',
          }),
          serializeSavedEditorScript(safe),
          serializeSavedEditorScript(safe),
          { unexpected: true },
        ],
      }),
    )

    const repository = new LocalScriptRepository(storage)
    expect(repository.list().map(({ script: item }) => item.id)).toEqual([
      'safe',
    ])
    expect(repository.isPersistent()).toBe(true)

    storage.setItem(DEFAULT_SCRIPT_STORAGE_KEY, '{broken-library')
    expect(new LocalScriptRepository(storage).list()).toEqual([])
  })

  it('degrades to a session mirror when storage access or writes are blocked', () => {
    const blockedRead: ScriptStorage = {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    const readFallback = new LocalScriptRepository(blockedRead)
    expect(readFallback.list()).toEqual([])
    expect(readFallback.isPersistent()).toBe(false)
    expect(readFallback.save(script('session', '2026-07-31')).persisted).toBe(
      false,
    )
    expect(readFallback.get('session')?.script.id).toBe('session')

    const quotaLimited: ScriptStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
      removeItem: () => undefined,
    }
    const writeFallback = new LocalScriptRepository(quotaLimited)
    expect(writeFallback.save(script('session', '2026-07-31')).persisted).toBe(
      false,
    )
    expect(writeFallback.get('session')?.script.id).toBe('session')
  })
})
