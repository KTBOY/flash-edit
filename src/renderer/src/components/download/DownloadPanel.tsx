import { useState } from 'react'
import { App as AntdApp, Button, Checkbox, Empty, Input, Progress, Typography } from 'antd'
import {
  DeleteOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined
} from '@ant-design/icons'
import type { OldswfDownloadTask } from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { useAppServices } from '@renderer/services/app-services'
import { useDownloadStore } from '@renderer/store/useDownloadStore'
import HudCard from '@renderer/components/common/HudCard'

const INPUT_RE = /^\d+$|^https?:\/\/oldswf\.(com|top)\/game\/\d+/

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024).toFixed(2)} GB`
}

function percentOf(task: OldswfDownloadTask): number {
  if (task.status === 'succeeded') return 100
  if (task.totalBytes <= 0) return 0
  return Math.min(99, Math.round((task.receivedBytes / task.totalBytes) * 100))
}

/** 任务副行文案：状态 + 阶段 + 字节进度 */
function describe(task: OldswfDownloadTask): string {
  const { status, phase } = strings.download
  if (task.status === 'queued') return status.queued
  if (task.status === 'succeeded') {
    return `${task.result?.name ?? ''} · ${formatBytes(task.result?.sizeBytes ?? task.totalBytes)}`
  }
  if (task.status === 'failed') return `${status.failed}：${task.error ?? ''}`
  if (task.status === 'canceled') return status.canceled
  const detail =
    task.totalBytes > 0
      ? `${formatBytes(task.receivedBytes)} / ${formatBytes(task.totalBytes)} · ${task.chunkCount} ${strings.download.chunks}`
      : `${formatBytes(task.receivedBytes)} / ${strings.download.totalUnknown}`
  return `${status.running} · ${phase[task.phase ?? 'starting']} · ${detail}`
}

/**
 * 网络下载面板（侧边栏 Tab）。
 * 任务列表由主进程事件驱动，本地只缓存快照：可同时排队多个下载，
 * 慢任务不阻塞其他任务，支持中途取消与失败重试。
 */
export default function DownloadPanel() {
  const { message } = AntdApp.useApp()
  const { launcher } = useAppServices()
  const tasks = useDownloadStore((s) => s.tasks)
  const selected = useDownloadStore((s) => s.selected)
  const submit = useDownloadStore((s) => s.submit)
  const cancel = useDownloadStore((s) => s.cancel)
  const retry = useDownloadStore((s) => s.retry)
  const toggleSelected = useDownloadStore((s) => s.toggleSelected)
  const setSelected = useDownloadStore((s) => s.setSelected)
  const removeSelected = useDownloadStore((s) => s.removeSelected)
  const [input, setInput] = useState('')

  const add = async (): Promise<void> => {
    const value = input.trim()
    if (!value) return
    if (!INPUT_RE.test(value)) {
      message.warning(strings.download.invalid)
      return
    }
    try {
      await submit(value)
      setInput('')
      message.success(strings.download.added)
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const allIds = tasks.map((task) => task.gameId)
  const allSelected = allIds.length > 0 && selected.length === allIds.length

  const remove = async (): Promise<void> => {
    try {
      await removeSelected()
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <HudCard zh={strings.download.tab} en={strings.latin.tabDownload}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 10px' }}>
        {strings.download.hint}
      </Typography.Paragraph>

      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          placeholder={strings.download.inputPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={() => void add()}
        />
        <Button type="primary" onClick={() => void add()}>
          {strings.download.add}
        </Button>
      </div>

      {tasks.length > 0 && (
        <div className="dl-toolbar">
          <Checkbox
            checked={allSelected}
            indeterminate={selected.length > 0 && !allSelected}
            onChange={(e) => setSelected(e.target.checked ? allIds : [])}
          >
            <span style={{ fontSize: 12 }}>{strings.download.selectAll}</span>
          </Checkbox>
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            disabled={selected.length === 0}
            onClick={() => void remove()}
          >
            {strings.download.deleteSelected}
            {selected.length > 0 ? ` (${selected.length})` : ''}
          </Button>
        </div>
      )}

      {tasks.length === 0 ? (
        <Empty description={strings.download.empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="dl-list">
          {tasks.map((task) => {
            const active = task.status === 'queued' || task.status === 'running'
            const result = task.result
            return (
              <div className={`dl-task ${task.status}`} key={task.gameId}>
                <div className="dl-top">
                  <Checkbox
                    checked={selected.includes(task.gameId)}
                    onChange={() => toggleSelected(task.gameId)}
                  />
                  <Typography.Text className="dl-name" ellipsis={{ tooltip: task.input }}>
                    {task.result?.name ?? `#${task.gameId}`}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {strings.download.status[task.status]}
                  </Typography.Text>
                </div>
                <Progress
                  percent={percentOf(task)}
                  size="small"
                  showInfo={false}
                  status={task.status === 'failed' ? 'exception' : active ? 'active' : 'normal'}
                />
                <Typography.Text className="dl-desc" type="secondary" ellipsis>
                  {describe(task)}
                </Typography.Text>
                <div className="dl-actions">
                  {active && (
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<StopOutlined />}
                      onClick={() => void cancel(task.gameId)}
                    >
                      {strings.download.cancel}
                    </Button>
                  )}
                  {(task.status === 'failed' || task.status === 'canceled') && (
                    <Button
                      size="small"
                      type="text"
                      icon={<ReloadOutlined />}
                      onClick={() => void retry(task.gameId)}
                    >
                      {strings.download.retry}
                    </Button>
                  )}
                  {task.status === 'succeeded' && result && (
                    <>
                      <Button
                        size="small"
                        type="text"
                        icon={<PlayCircleOutlined />}
                        onClick={() => void launcher.loadDownloadedFile(result)}
                      >
                        {strings.download.open}
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        icon={<FolderOpenOutlined />}
                        onClick={() => getApi().showFileInFolder(result.path)}
                      >
                        {strings.download.reveal}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </HudCard>
  )
}
