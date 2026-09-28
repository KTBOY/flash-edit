import { create } from 'zustand'
import type { OldswfDownloadTask } from '@shared/types'
import { getApi } from '@renderer/services/ipc.service'
import { useGameStore } from './useGameStore'

/**
 * 网络下载任务列表。
 *
 * 主进程是任务状态唯一事实来源：这里只缓存推送过来的快照，
 * attach() 幂等地订阅事件并做一次全量同步，因此面板切走再回来进度也不会丢。
 * 任务成功时主进程已写好文件并登记游戏库，这里只负责刷新游戏库列表。
 * 删除任务只从列表移除记录，不动游戏库与磁盘文件。
 */

interface DownloadStore {
  /** 按创建时间倒序 */
  tasks: OldswfDownloadTask[]
  /** 勾选中的游戏 ID */
  selected: string[]
  attached: boolean
  attach(): void
  /** 提交下载；输入非法或重复排队时抛出主进程的说明文字 */
  submit(input: string): Promise<void>
  cancel(gameId: string): Promise<void>
  retry(gameId: string): Promise<void>
  toggleSelected(gameId: string): void
  setSelected(ids: string[]): void
  /** 移除选中的任务记录；进行中的会先被取消 */
  removeSelected(): Promise<void>
}

function sortByCreated(tasks: OldswfDownloadTask[]): OldswfDownloadTask[] {
  return [...tasks].sort((a, b) => b.createdAt - a.createdAt)
}

export const useDownloadStore = create<DownloadStore>((set, get) => {
  const applyTask = (task: OldswfDownloadTask): void => {
    const tasks = get().tasks
    const index = tasks.findIndex((item) => item.gameId === task.gameId)
    const previous = index >= 0 ? tasks[index] : undefined
    const next =
      index >= 0
        ? tasks.map((item, i) => (i === index ? task : item))
        : sortByCreated([...tasks, task])
    set({ tasks: next })
    // 首次进入成功态：主进程已登记游戏库，这里刷新列表即可
    if (task.status === 'succeeded' && previous?.status !== 'succeeded') {
      void useGameStore.getState().refreshRecent()
    }
  }

  const sync = async (): Promise<void> => {
    try {
      const tasks = sortByCreated(await getApi().listOldswfDownloads())
      const ids = new Set(tasks.map((task) => task.gameId))
      set({ tasks, selected: get().selected.filter((id) => ids.has(id)) })
    } catch {
      // IPC 未就绪时保持空列表，事件到达后自然补齐
    }
  }

  return {
    tasks: [],
    selected: [],
    attached: false,

    attach: () => {
      if (get().attached) return
      set({ attached: true })
      getApi().onOldswfDownloadTask(applyTask)
      void sync()
    },

    submit: async (input: string) => {
      applyTask(await getApi().startOldswfDownload(input))
    },

    cancel: async (gameId: string) => {
      await getApi().cancelOldswfDownload(gameId)
    },

    retry: async (gameId: string) => {
      const task = get().tasks.find((item) => item.gameId === gameId)
      if (!task) return
      applyTask(await getApi().startOldswfDownload(task.input))
    },

    toggleSelected: (gameId: string) => {
      const selected = get().selected
      set({
        selected: selected.includes(gameId)
          ? selected.filter((id) => id !== gameId)
          : [...selected, gameId]
      })
    },

    setSelected: (ids: string[]) => set({ selected: ids }),

    removeSelected: async () => {
      const ids = get().selected
      if (ids.length === 0) return
      await getApi().removeOldswfDownloads(ids)
      const removed = new Set(ids)
      set({
        tasks: get().tasks.filter((task) => !removed.has(task.gameId)),
        selected: []
      })
    }
  }
})
