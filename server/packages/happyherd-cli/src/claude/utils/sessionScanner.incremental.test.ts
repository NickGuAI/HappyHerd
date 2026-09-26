import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RawJSONLines } from '../types'
import { getProjectPath } from './path'

const io = vi.hoisted(() => ({ reads: [] as Array<{ position: number; length: number }>, readFiles: 0 }))

// Record every transcript read the scanner makes; the files themselves are real.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      io.readFiles += 1
      return actual.readFile(...args)
    }),
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      const read = handle.read.bind(handle) as (...readArgs: unknown[]) => Promise<unknown>
      ;(handle as any).read = (buffer: Buffer, offset: number, length: number, position: number) => {
        io.reads.push({ position, length })
        return read(buffer, offset, length, position)
      }
      return handle
    }),
  }
})

import { createSessionScanner } from './sessionScanner'

const SESSION_ID = '93a9705e-bc6a-406d-8dce-8acc014dedbd'
const [USER_LINE, ASSISTANT_LINE] = readFileSync(join(__dirname, '__fixtures__', '0-say-lol-session.jsonl'), 'utf-8')
  .split('\n')
  .filter((line) => line.trim())

function userLine(uuid: string, text: string): string {
  return JSON.stringify({ ...JSON.parse(USER_LINE), uuid, message: { role: 'user', content: text } })
}

// Run one periodic pass (the 3 s interval) and let its real file I/O finish.
async function tick() {
  await vi.advanceTimersByTimeAsync(3000)
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('sessionScanner incremental reads', () => {
  let testDir: string
  let projectDir: string
  let transcript: string
  let messages: RawJSONLines[]
  let scanner: Awaited<ReturnType<typeof createSessionScanner>> | null

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    testDir = join(tmpdir(), `scanner-incremental-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(testDir, { recursive: true })
    projectDir = getProjectPath(testDir)
    await mkdir(projectDir, { recursive: true })
    transcript = join(projectDir, `${SESSION_ID}.jsonl`)
    await writeFile(transcript, `${USER_LINE}\n${ASSISTANT_LINE}\n`)
    messages = []
    scanner = await createSessionScanner({
      sessionId: SESSION_ID,
      workingDirectory: testDir,
      onMessage: (message) => messages.push(message),
    })
    io.reads.length = 0
    io.readFiles = 0
  })

  afterEach(async () => {
    await scanner?.cleanup()
    scanner = null
    vi.useRealTimers()
    for (const dir of [testDir, projectDir]) {
      if (existsSync(dir)) await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not read an unchanged transcript again', async () => {
    await tick()
    await tick()
    await tick()

    expect(io.reads).toEqual([])
    expect(io.readFiles).toBe(0)
    expect(messages).toEqual([])
  })

  it('reads only the bytes appended since the last pass', async () => {
    const before = (await stat(transcript)).size
    const line = `${userLine('11111111-1111-4111-8111-111111111111', 'next prompt')}\n`
    await appendFile(transcript, line)
    await tick()

    expect(io.reads).toEqual([{ position: before, length: Buffer.byteLength(line) }])
    expect(messages).toHaveLength(1)
    expect(messages[0].type === 'user' && messages[0].message.content).toBe('next prompt')
  })

  it('waits for a partially written line before emitting it', async () => {
    const line = userLine('22222222-2222-4222-8222-222222222222', 'split prompt')
    const half = Math.floor(line.length / 2)
    await appendFile(transcript, line.slice(0, half))
    await tick()
    expect(messages).toEqual([])

    await appendFile(transcript, `${line.slice(half)}\n`)
    await tick()
    await tick()
    expect(messages).toHaveLength(1)
    expect(messages[0].type === 'user' && messages[0].message.content).toBe('split prompt')
  })

  it('rereads a replaced transcript without duplicating entries', async () => {
    const replacement = `${transcript}.tmp`
    await writeFile(replacement, `${USER_LINE}\n${ASSISTANT_LINE}\n${userLine('33333333-3333-4333-8333-333333333333', 'after replace')}\n`)
    await rename(replacement, transcript)
    await tick()

    expect(messages).toHaveLength(1)
    expect(messages[0].type === 'user' && messages[0].message.content).toBe('after replace')
  })

  it('rereads a truncated transcript from the start without duplicating entries', async () => {
    await writeFile(transcript, `${USER_LINE}\n`)
    await tick()
    expect(messages).toEqual([])

    await appendFile(transcript, `${userLine('44444444-4444-4444-8444-444444444444', 'after truncate')}\n`)
    await tick()
    expect(messages).toHaveLength(1)
    expect(messages[0].type === 'user' && messages[0].message.content).toBe('after truncate')
  })
})
