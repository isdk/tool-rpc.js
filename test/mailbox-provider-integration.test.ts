// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { nanoid } from '@isdk/hash'
import { Capability, Mailbox, MemoryProvider } from '@mboxlabs/mailbox'
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

  /**
   * 直接实现 `IMailboxProvider` 的第三方 provider：**订阅必须返回 Promise**。
   *
   * 这个 provider 的「已生效」= 目录轮询已挂上（`setInterval` 在返回前就 armed），
   * 所以 `await subscribe()` 返回后投递就能开始。基类的 await 窗口约定在这里不适用
   * （没有异步 handle），但「不 await 等于未订阅」同样成立。
   */
  async subscribe(address: URL, onReceive: (message: MailMessage) => void | Promise<void>): Promise<Subscription> {
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

  /**
   * 这个双件的「认得」= 目录曾被动过，或现在正有人在轮询它。
   *
   * `exists` 在契约里是「有过消息 / 订阅 / 活动记录」，所以订阅也算：只报目录不报订阅，
   * 「订了但还没人来」就会被误报成「没这个地址」。问不到的时候不报 `online` + 0：
   * 诊断页分不出「地址写错了」与「信箱空着」（内核 issue#4）。
   */
  async status(address: URL): Promise<MailboxStatus> {
    const dir = this.getAddressDir(address)
    const dirExists = existsSync(dir)
    const subscribed = this.subscriptions.has(this.getTopicKey(address))
    const unreadCount = dirExists ? readdirSync(dir).filter(f => f.endsWith('.json')).length : 0

    if (!dirExists && !subscribed) {
      return { state: 'unknown', exists: false, unreadCount, message: `No letter or subscription is known for '${this.getTopicKey(address)}'.` }
    }
    return { state: 'online', exists: true, unreadCount }
  }
}

// ── Helpers ──
let testSeq = 0
function uniqueAddr(base: string): string {
  testSeq++
  return `${base}-${testSeq}-${Date.now()}`
}

/**
 * 一个会答「离线」的 `MemoryProvider`，只为测存活态而存在。
 *
 * 为什么测试得自己造一个：`mem:` 是进程内总线，**没有 offline / online 这回事**——它永远连得上。
 * `MemoryProvider#_status()` 里的 `online` 说的是「这条地址我有活动记录」，不是「broker 可达」。
 * 所以想测「provider 说离线，运维看到什么」，只能扩展它：存活态是 provider 的判定，内核只转述。
 */
class MemoryProviderWithLiveness extends MemoryProvider {
  /** 模拟 broker 的可达性；`online` 之外的一档让 provider 连「认不认得这条地址」都答不上。 */
  liveness: 'online' | 'offline' | 'degraded' = 'online'

  protected override async _status(address: URL): Promise<MailboxStatus> {
    const base = await super._status(address)
    if (this.liveness === 'online') return base
    // `exists` 不给：问不到不等于不存在。给了 false 就是替 broker 编一份它没说过的答复。
    const { exists: _notAnswered, ...rest } = base
    return { ...rest, state: this.liveness, message: 'broker unreachable' }
  }
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

      const sub = await mailbox!.subscribe(memAddr1, (msg) => {
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

      const memSub = await mailbox!.subscribe(memAddr1, (msg) => { memReceived.push(msg) })
      // Subscribe to fileAddr2 (different from route test's fileAddr1) for isolation
      const fileSub = await mailbox!.subscribe(fileAddr2, (msg) => { fileReceived.push(msg) })

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

      const sub1 = await mailbox!.subscribe(memAddr1, (msg) => { inbox1.push(msg) })
      const sub2 = await mailbox!.subscribe(memAddr2, (msg) => { inbox2.push(msg) })

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

      const memSub = await mailbox!.subscribe(memAddr1, (msg) => { memReceived.push(msg) })
      const fileSub = await fileProvider.subscribe(new URL(fileAddr1), (msg) => { fileReceived.push(msg) })

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

    // [语义] 一条地址的完整一生：没人碰过 = unknown + exists:false；一次 post 或一次订阅就把它
    // 叫醒 = online + exists:true。三段写在同一条用例里，是为了让「online 是谁让地址活起来的」
    // 与「unknown 不是失败」在同一个镜头里：把 unknown 写成 online，诊断页就只剩猜（内核 issue#4）。
    it('walks an address from unknown to online, and never pretends before that', async () => {
      const memBefore = await mailbox!.status(memAddr1)
      expect(memBefore.state).toBe('unknown')
      expect(memBefore.exists).toBe(false)
      expect(memBefore.unreadCount).toBe(0)

      const fileBefore = await mailbox!.status(fileAddr1)
      expect(fileBefore.state).toBe('unknown')
      expect(fileBefore.exists).toBe(false)
      expect(fileBefore.unreadCount).toBe(0)

      // 活起来可以是「有人投过」
      await mailbox!.post({ from: 'mem://sender@memory/status', to: memAddr1, body: { n: 1 } })
      await mailbox!.post({ from: 'file:///tmp/s', to: fileAddr1, body: { n: 1 } })

      const memAfter = await mailbox!.status(memAddr1)
      expect(memAfter.state).toBe('online')
      expect(memAfter.exists).toBe(true)
      expect(memAfter.unreadCount).toBe(1)

      const fileAfter = await mailbox!.status(fileAddr1)
      expect(fileAfter.state).toBe('online')
      expect(fileAfter.exists).toBe(true)
      expect(fileAfter.unreadCount).toBe(1)

      // 也可以是「有人在听」——一封都没投过也算活动记录
      const listenAddr = uniqueAddr('file:///tmp/mailbox/status-listening')
      expect((await mailbox!.status(listenAddr)).exists).toBe(false)
      const sub = await mailbox!.subscribe(listenAddr, () => {})
      try {
        const listening = await mailbox!.status(listenAddr)
        expect(listening.state).toBe('online')
        expect(listening.exists).toBe(true)
        expect(listening.unreadCount).toBe(0)
      } finally {
        await sub.unsubscribe()
      }
    })

    // [扩展面] 真正的「离线」是 provider 报上来的，内核既不推导也不改写。
    // `MemoryProvider` 自己永远答不出 offline（进程内没有可达性这回事），所以这里用的是
    // 测试里扩展出来的 provider——需要测的东西在谁手里，就扩展谁。
    it('relays whatever liveness the provider claims', async () => {
      const flaky = new MemoryProviderWithLiveness()
      const mbox = new Mailbox()
      mbox.registerProvider(flaky)
      mailboxes.push(mbox)
      const addr = uniqueAddr('mem://liveness@memory/status')

      // 继承来的部分照旧：谁都不认得的地址仍是 unknown
      expect((await mbox.status(addr)).state).toBe('unknown')

      await mbox.post({ from: 'mem://sender@memory/status', to: addr, body: { n: 1 } })
      flaky.liveness = 'offline'

      const offline = await mbox.status(addr)
      expect(offline.state).toBe('offline')
      expect(offline.message).toBe('broker unreachable')
      // 内核不许拿活动记录去推翻 provider 的存活答复（该 unknown 的地方不许替它改成 online），
      // 也不许把「问不到」补成 exists:false
      expect(offline.exists).toBeUndefined()
      expect(offline.unreadCount).toBe(1)
    })

    // [扩展面] 未声明 = 这个操作不存在（D6）：内核不探方法、不猜。撤掉声明后就算地址
    // 确实活着，答复也只有「这个 provider 不支持状态查询」——而且 `exists` 依旧不给。
    it('says "does not support status queries" when the status capability is withdrawn', async () => {
      const blind = new MemoryProvider()
      // 能力是运行期数据：改集合就是改声明，不需要一个新类
      blind.supports.delete(Capability.Status)
      const mbox = new Mailbox()
      mbox.registerProvider(blind)
      mailboxes.push(mbox)
      const addr = uniqueAddr('mem://blind@memory/status')

      // 先让地址真的活着：否则这条绿只是因为「反正也没记录」，测不到「声明压过实现」
      await mbox.post({ from: 'mem://sender@memory/status', to: addr, body: { n: 1 } })

      const status = await mbox.status(addr)
      expect(status.state).toBe('unknown')
      expect(status.exists).toBeUndefined()
      expect(status.message).toMatch(/does not support status queries/)
    })

    it('should return correct unread count for FileProvider', async () => {
      // 自己开一个地址：上一段已经往 fileAddr1 投过一封，共用地址就是让两条用例互相看账本
      const countedAddr = uniqueAddr('file:///tmp/mailbox/status-count')

      await mailbox!.post({ from: 'file:///tmp/s', to: countedAddr, body: { n: 1 } })
      await mailbox!.post({ from: 'file:///tmp/s', to: countedAddr, body: { n: 2 } })

      await new Promise(resolve => setTimeout(resolve, 150))

      const status = await fileProvider.status(new URL(countedAddr))
      expect(status.unreadCount).toBe(2)

      await fileProvider.fetch(new URL(countedAddr))

      const afterOne = await fileProvider.status(new URL(countedAddr))
      expect(afterOne.unreadCount).toBe(1)

      await fileProvider.fetch(new URL(countedAddr))
      const afterAll = await fileProvider.status(new URL(countedAddr))
      expect(afterAll.unreadCount).toBe(0)
      // 队列空了 ≠ 地址不存在：这一格正是 `unknown` 与 `online` 要分开的理由
      expect(afterAll.state).toBe('online')
      expect(afterAll.exists).toBe(true)
    })
  })
})
