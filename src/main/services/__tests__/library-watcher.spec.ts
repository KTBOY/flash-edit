import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryWatcher } from '../library-watcher.service'

/** 留出防抖 + fs.watch 事件传播的时间余量（需远小于重挂周期，避免事件落进重挂空窗） */
const SETTLE_MS = 50
const CHECK_MS = 400

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 避开周期重挂的时间点，把动作安排在两个周期之间 */
const betweenChecks = (n: number): Promise<void> => sleep(n * CHECK_MS + SETTLE_MS * 3)

describe('LibraryWatcher', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lib-watch-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('目录内文件变化时触发回调，防抖窗口内多次变化只触发一次', async () => {
    const onChange = vi.fn()
    const watcher = new LibraryWatcher(onChange, SETTLE_MS, CHECK_MS)
    watcher.start(dir)
    try {
      writeFileSync(join(dir, 'a.swf'), 'a')
      writeFileSync(join(dir, 'b.swf'), 'b')
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 })
      // 防抖窗口早已结束，不应再有第二次回调
      await sleep(CHECK_MS)
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      watcher.stop()
    }
  })

  it('目录不存在时等目录出现：出现即通知，且后续文件变化仍可监听', async () => {
    const nested = join(dir, 'games')
    const onChange = vi.fn()
    const watcher = new LibraryWatcher(onChange, SETTLE_MS, CHECK_MS)
    watcher.start(nested)
    try {
      mkdirSync(nested)
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 })
      // 重挂生效后再写文件，确认监听已恢复
      await betweenChecks(1)
      writeFileSync(join(nested, 'a.swf'), 'a')
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2), { timeout: 3000 })
    } finally {
      watcher.stop()
    }
  })

  it('目录被外部删除后自检重挂，目录恢复后继续生效', async () => {
    const target = join(dir, 'games')
    mkdirSync(target)
    const onChange = vi.fn()
    const watcher = new LibraryWatcher(onChange, SETTLE_MS, CHECK_MS)
    watcher.start(target)
    try {
      rmSync(target, { recursive: true })
      mkdirSync(target)
      // 删除到重挂之间的窗口内变化可能被错过，重挂生效后再写一次
      await betweenChecks(1)
      writeFileSync(join(target, 'a.swf'), 'a')
      await vi.waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThan(0), {
        timeout: 5000
      })
    } finally {
      watcher.stop()
    }
  })

  it('目录被外部整体删除时触发回调（渲染层据此把记录标记为丢失）', async () => {
    const target = join(dir, 'games')
    mkdirSync(target)
    const onChange = vi.fn()
    const watcher = new LibraryWatcher(onChange, SETTLE_MS, CHECK_MS)
    watcher.start(target)
    try {
      await sleep(SETTLE_MS * 2)
      rmSync(target, { recursive: true })
      // 删除本身的事件可能随句柄失效而丢失，但自检兜底必须补上这一次通知
      await vi.waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThan(0), {
        timeout: 3000
      })
    } finally {
      watcher.stop()
    }
  })

  it('stop 后不再触发回调', async () => {
    const onChange = vi.fn()
    const watcher = new LibraryWatcher(onChange, SETTLE_MS, CHECK_MS)
    watcher.start(dir)
    watcher.stop()
    writeFileSync(join(dir, 'a.swf'), 'a')
    await sleep(CHECK_MS * 2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('start 切换目录后监听跟随新目录', async () => {
    const dirA = join(dir, 'a')
    const dirB = join(dir, 'b')
    mkdirSync(dirA)
    mkdirSync(dirB)
    const onChange = vi.fn()
    const watcher = new LibraryWatcher(onChange, SETTLE_MS, CHECK_MS)
    watcher.start(dirA)
    watcher.start(dirB)
    try {
      writeFileSync(join(dirA, 'a.swf'), 'a')
      writeFileSync(join(dirB, 'b.swf'), 'b')
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 })
      await sleep(CHECK_MS)
      // 只有新目录的变化生效
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      watcher.stop()
    }
  })
})
