// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { nanoid } from '@isdk/hash'
import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox'
import type {
  IMailboxProvider,
  MailMessage,
  AckableMailMessage,
  MailboxStatus,
  Subscription,
} from '@mboxlabs/mailbox'

// ── FileProvider: A simple file-based MailboxProvider ──
class FileProvider implements IMailboxProvider {
  readonly protocol = 'file'
  private baseDir: string
  private subscriptions = new Map<string, { address: URL; onReceive: (msg: MailMessage) => void | Promise<void>; interval: any }>()
  private addrSeq = new Map<string, number>()

  constructor(baseDir: string) {
    this.baseDir = baseDir
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true })
    }
  }

  async init(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true })
    }
  }

  async close(): Promise<void> {
    for (const [id, sub] of this.subscriptions) {
      clearInterval(sub.interval)
      this.subscriptions.delete(id)
    }
  }

  private getAddressDir(address: URL): string {
    // Normalize: protocol + hostname + path -> directory path
    const normalized = address.hostname + address.pathname.replace(/[\/:]/g, '_')
    return join(this.baseDir, normalized)
  }

  private nextSeq(address: URL): string {
    const key = this.getTopicKey(address)
    const seq = (this.addrSeq.get(key) || 0) + 1
    this.addrSeq.set(key, seq)
    return String(seq).padStart(10, '0')
  }

  async send(message: MailMessage): Promise<MailMessage> {
    const dir = this.getAddressDir(message.to)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    // Include a sequence number in the filename to preserve creation order on readdir
    const seq = this.nextSeq(message.to)
    const filePath = join(dir, `${seq}-${message.id}.json`)
    writeFileSync(filePath, JSON.stringify({ ...message, headers: { ...message.headers, 'mbx-sent-at': new Date().toISOString() } }), 'utf-8')

    // Note: Delivery to subscribers is handled by the subscribe polling loop,
    // NOT here. This avoids double-delivery (push via setTimeout + pull via poll).

    return message
  }

  private getTopicKey(address: URL): string {
    return `${address.protocol}//${address.hostname}${address.pathname}`
  }

  subscribe(address: URL, onReceive: (message: MailMessage) => void | Promise<void>): Subscription {
    const topic = this.getTopicKey(address)
    const id = nanoid()

    // Poll the directory for new files
    const interval = setInterval(() => {
      const dir = this.getAddressDir(address)
      if (!existsSync(dir)) return

      const files = readdirSync(dir).filter(f => f.endsWith('.json'))
      if (files.length === 0) return

      for (const file of files) {
        const filePath = join(dir, file)
        try {
          const content = readFileSync(filePath, 'utf-8')
          const message: MailMessage = JSON.parse(content)
          onReceive(message)
          // Remove file after processing (auto-ack for push mode)
          unlinkSync(filePath)
        } catch {
          // Skip files that can't be read (might be being written)
        }
      }
    }, 100) // Poll every 100ms

    this.subscriptions.set(topic, { address, onReceive, interval })

    return {
      id,
      address,
      status: 'active',
      unsubscribe: async () => {
        clearInterval(interval)
        this.subscriptions.delete(topic)
      },
    }
  }

  async fetch(address: URL, options: { manualAck: true }): Promise<AckableMailMessage | null>
  async fetch(address: URL, options?: { manualAck?: false }): Promise<MailMessage | null>
  async fetch(address: URL, options?: { manualAck?: boolean }): Promise<MailMessage | AckableMailMessage | null> {
    const dir = this.getAddressDir(address)
    if (!existsSync(dir)) return null

    const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    if (files.length === 0) return null

    const filePath = join(dir, files[0])
    let message: MailMessage
    try {
      const content = readFileSync(filePath, 'utf-8')
      message = JSON.parse(content)
    } catch {
      return null
    }

    if (options?.manualAck) {
      // In manual mode, don't delete the file — return ackable wrapper
      const ackable: AckableMailMessage = {
        ...message,
        ack: async () => {
          if (existsSync(filePath)) unlinkSync(filePath)
        },
        nack: async (requeue = false) => {
          // For simplicity, just delete on nack (no requeue in this basic implementation)
          if (existsSync(filePath)) unlinkSync(filePath)
        },
      }
      return ackable
    }

    // Auto-ack: delete the file and return message
    unlinkSync(filePath)
    return message
  }

  generateId(): string {
    return nanoid()
  }

  async status(address: URL): Promise<MailboxStatus> {
    const dir = this.getAddressDir(address)
    const unreadCount = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).length : 0
    return {
      state: 'online',
      unreadCount,
    }
  }
}

// ── Helpers ──
let testSeq = 0
function uniqueAddr(base: string): string {
  testSeq++
  return `${base}-${testSeq}-${Date.now()}`
}

// ── Tests ──

describe('Mailbox Provider Integration (Memory + File)', () => {
  let mailbox: Mailbox
  let fileProvider: FileProvider
  let tmpDir: string

  // Each describe section gets its own addresses to prevent cross-contamination
  let memAddr1: string
  let memAddr2: string
  let fileAddr1: string
  let fileAddr2: string

  beforeAll(async () => {
    // Create unique temp dir for this test run
    tmpDir = join(tmpdir(), `mailbox-file-provider-test-${Date.now()}`)
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await Promise.all(mailboxes.map(m => m.stop()))
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  })

  // Track all mailboxes for proper cleanup in afterAll
  const mailboxes: Mailbox[] = []

  function createFreshMailbox() {
    const mbox = new Mailbox()
    mbox.registerProvider(new MemoryProvider())
    fileProvider = new FileProvider(tmpDir)
    mbox.registerProvider(fileProvider)
    mailboxes.push(mbox)
    return mbox
  }

  describe('Provider Registration and Routing', () => {
    beforeAll(() => {
      mailbox = createFreshMailbox()
      memAddr1 = uniqueAddr('mem://user@memory/app')
      memAddr2 = uniqueAddr('mem://other@memory/app')
      fileAddr1 = uniqueAddr('file:///tmp/mailbox/app')
      fileAddr2 = uniqueAddr('file:///tmp/mailbox/app')
    })

    it('should route mem:// messages to MemoryProvider', async () => {
      const received: MailMessage[] = []

      const sub = mailbox!.subscribe(memAddr1, (msg) => {
        received.push(msg)
      })

      await mailbox!.post({
        from: memAddr2,
        to: memAddr1,
        body: { text: 'hello from memory' },
      })

      await new Promise(resolve => setTimeout(resolve, 50))
      expect(received).toHaveLength(1)
      expect(received[0].body).toEqual({ text: 'hello from memory' })

      await sub.unsubscribe()
    })

    it('should route file:// messages to FileProvider', async () => {
      await mailbox!.post({
        from: 'file:///tmp/sender',
        to: fileAddr1,
        body: { data: 'stored on disk' },
      })

      await new Promise(resolve => setTimeout(resolve, 150))
      const result = await fileProvider.fetch(new URL(fileAddr1))
      expect(result).not.toBeNull()
      expect(result!.body).toEqual({ data: 'stored on disk' })

      const empty = await fileProvider.fetch(new URL(fileAddr1))
      expect(empty).toBeNull()
    })

    it('should isolate messages between different providers', async () => {
      const memReceived: MailMessage[] = []
      const fileReceived: MailMessage[] = []

      const memSub = mailbox!.subscribe(memAddr1, (msg) => { memReceived.push(msg) })
      // Subscribe to fileAddr2 (different from route test's fileAddr1) for isolation
      const fileSub = mailbox!.subscribe(fileAddr2, (msg) => { fileReceived.push(msg) })

      await mailbox!.post({ from: memAddr2, to: memAddr1, body: { msg: 'mem-only' } })
      await mailbox!.post({ from: 'file:///tmp/s', to: fileAddr2, body: { msg: 'file-only' } })

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(memReceived).toHaveLength(1)
      expect(memReceived[0].body).toEqual({ msg: 'mem-only' })
      expect(fileReceived).toHaveLength(1)
      expect(fileReceived[0].body).toEqual({ msg: 'file-only' })

      await memSub.unsubscribe()
      await fileSub.unsubscribe()
    })
  })

  describe('Provider-Specific Behaviors', () => {
    beforeAll(() => {
      mailbox = createFreshMailbox()
      memAddr1 = uniqueAddr('mem://user@memory/multi')
      memAddr2 = uniqueAddr('mem://other@memory/multi')
      fileAddr1 = uniqueAddr('file:///tmp/mailbox/multi')
      fileAddr2 = uniqueAddr('file:///tmp/mailbox/multi2')
    })

    it('should support multiple mem:// addresses with MemoryProvider', async () => {
      const inbox1: MailMessage[] = []
      const inbox2: MailMessage[] = []

      const sub1 = mailbox!.subscribe(memAddr1, (msg) => { inbox1.push(msg) })
      const sub2 = mailbox!.subscribe(memAddr2, (msg) => { inbox2.push(msg) })

      await mailbox!.post({ from: memAddr1, to: memAddr2, body: { to: '2' } })
      await mailbox!.post({ from: memAddr2, to: memAddr1, body: { to: '1' } })

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(inbox1).toHaveLength(1)
      expect(inbox1[0].body).toEqual({ to: '1' })
      expect(inbox2).toHaveLength(1)
      expect(inbox2[0].body).toEqual({ to: '2' })

      await sub1.unsubscribe()
      await sub2.unsubscribe()
    })

    it('should support multiple file:// addresses with FileProvider', async () => {
      await mailbox!.post({ from: 'file:///tmp/a', to: fileAddr1, body: { idx: 1 } })
      await mailbox!.post({ from: 'file:///tmp/b', to: fileAddr2, body: { idx: 2 } })

      await new Promise(resolve => setTimeout(resolve, 150))

      const r1 = await fileProvider.fetch(new URL(fileAddr1))
      expect(r1).not.toBeNull()
      expect(r1!.body).toEqual({ idx: 1 })

      const r2 = await fileProvider.fetch(new URL(fileAddr2))
      expect(r2).not.toBeNull()
      expect(r2!.body).toEqual({ idx: 2 })
    })

    it('should preserve message ordering per file:// address', async () => {
      for (let i = 1; i <= 3; i++) {
        await mailbox!.post({ from: 'file:///tmp/s', to: fileAddr1, body: { seq: i } })
      }

      await new Promise(resolve => setTimeout(resolve, 150))

      const r1 = await fileProvider.fetch(new URL(fileAddr1))
      expect(r1!.body).toEqual({ seq: 1 })

      const r2 = await fileProvider.fetch(new URL(fileAddr1))
      expect(r2!.body).toEqual({ seq: 2 })

      const r3 = await fileProvider.fetch(new URL(fileAddr1))
      expect(r3!.body).toEqual({ seq: 3 })

      const empty = await fileProvider.fetch(new URL(fileAddr1))
      expect(empty).toBeNull()
    })
  })

  describe('FileProvider Persistence', () => {
    beforeAll(() => {
      mailbox = createFreshMailbox()
      fileAddr1 = uniqueAddr('file:///tmp/mailbox/persist')
    })

    it('should persist messages to disk and survive provider re-creation', async () => {
      await mailbox!.post({ from: 'file:///tmp/s', to: fileAddr1, body: { persistent: true, value: 42 } })
      await new Promise(resolve => setTimeout(resolve, 150))

      const freshProvider = new FileProvider(tmpDir)
      const result = await freshProvider.fetch(new URL(fileAddr1))
      expect(result).not.toBeNull()
      expect(result!.body).toEqual({ persistent: true, value: 42 })
    })
  })

  describe('FileProvider Manual Ack', () => {
    beforeAll(() => {
      mailbox = createFreshMailbox()
      fileAddr1 = uniqueAddr('file:///tmp/mailbox/manual-ack')
    })

    it('should support manual ack for file:// messages', async () => {
      await mailbox!.post({ from: 'file:///tmp/s', to: fileAddr1, body: { manual: true } })
      await new Promise(resolve => setTimeout(resolve, 150))

      const ackMsg = await fileProvider.fetch(new URL(fileAddr1), { manualAck: true })
      expect(ackMsg).not.toBeNull()
      expect(ackMsg!.body).toEqual({ manual: true })
      expect(typeof (ackMsg as any).ack).toBe('function')

      // File should still exist (not acked yet)
      const stillThere = await fileProvider.fetch(new URL(fileAddr1))
      expect(stillThere).not.toBeNull()

      // Now ack — file should be deleted
      await (ackMsg as AckableMailMessage).ack()
      await new Promise(resolve => setTimeout(resolve, 50))

      const gone = await fileProvider.fetch(new URL(fileAddr1))
      expect(gone).toBeNull()
    })
  })

  describe('Concurrent Provider Usage', () => {
    beforeAll(() => {
      mailbox = createFreshMailbox()
      memAddr1 = uniqueAddr('mem://user@memory/conc')
      memAddr2 = uniqueAddr('mem://other@memory/conc')
      fileAddr1 = uniqueAddr('file:///tmp/mailbox/conc')
    })

    it('should handle concurrent messages across both providers', async () => {
      const memReceived: MailMessage[] = []
      const fileReceived: MailMessage[] = []

      const memSub = mailbox!.subscribe(memAddr1, (msg) => { memReceived.push(msg) })
      const fileSub = fileProvider.subscribe(new URL(fileAddr1), (msg) => { fileReceived.push(msg) })

      const memPosts = [1, 2, 3].map(i => mailbox!.post({ from: memAddr2, to: memAddr1, body: { src: 'mem', i } }))
      const filePosts = [1, 2, 3].map(i => mailbox!.post({ from: 'file:///tmp/s', to: fileAddr1, body: { src: 'file', i } }))

      await Promise.all([...memPosts, ...filePosts])
      await new Promise(resolve => setTimeout(resolve, 500))

      expect(memReceived).toHaveLength(3)
      memReceived.forEach((msg, idx) => {
        expect(msg.body).toEqual({ src: 'mem', i: idx + 1 })
      })

      expect(fileReceived).toHaveLength(3)
      // Concurrent writes may be read in any order; sort by content to verify completeness
      const sortedByI = [...fileReceived].sort((a, b) => a.body.i - b.body.i)
      sortedByI.forEach((msg, idx) => {
        expect(msg.body).toEqual({ src: 'file', i: idx + 1 })
      })

      await memSub.unsubscribe()
      await fileSub.unsubscribe()
    })
  })

  describe('Provider Status', () => {
    beforeAll(() => {
      mailbox = createFreshMailbox()
      fileAddr1 = uniqueAddr('file:///tmp/mailbox/status')
      memAddr1 = uniqueAddr('mem://user@memory/status')
    })

    it('should return online status for both providers', async () => {
      const memStatus = await mailbox!.status(memAddr1)
      expect(memStatus.state).toBe('online')
      expect(memStatus.unreadCount).toBeTypeOf('number')

      const fileStatus = await mailbox!.status(fileAddr1)
      expect(fileStatus.state).toBe('online')
      expect(fileStatus.unreadCount).toBeTypeOf('number')
    })

    it('should return correct unread count for FileProvider', async () => {
      await mailbox!.post({ from: 'file:///tmp/s', to: fileAddr1, body: { n: 1 } })
      await mailbox!.post({ from: 'file:///tmp/s', to: fileAddr1, body: { n: 2 } })

      await new Promise(resolve => setTimeout(resolve, 150))

      const status = await fileProvider.status(new URL(fileAddr1))
      expect(status.unreadCount).toBe(2)

      await fileProvider.fetch(new URL(fileAddr1))

      const afterOne = await fileProvider.status(new URL(fileAddr1))
      expect(afterOne.unreadCount).toBe(1)

      await fileProvider.fetch(new URL(fileAddr1))
      const afterAll = await fileProvider.status(new URL(fileAddr1))
      expect(afterAll.unreadCount).toBe(0)
    })
  })
})
