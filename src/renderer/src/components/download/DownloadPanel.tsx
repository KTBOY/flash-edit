import { useState } from 'react'
import { App as AntdApp, Button, Checkbox, Empty, Input, Progress, Segmented, Typography } from 'antd'
import {
  DeleteOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined
} from '@ant-design/icons'
import type { DownloadSource, DownloadTask } from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { useAppServices } from '@renderer/services/app-services'
import { useDownloadStore } from '@renderer/store/useDownloadStore'
import HudCard from '@renderer/components/common/HudCard'

const SOURCES = Object.keys(strings.download.sources) as DownloadSource[]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function percentOf(task: DownloadTask): number {
  if (task.status === 'succeeded') return 100
  if (task.totalBytes <= 0) return 0
  return Math.min(99, Math.round((task.receivedBytes / task.totalBytes) * 100))
}

/** 任务副行文案：状态 + 阶段 + 字节进度（分片数只在站点按分片下载时才有意义） */
function describe(task: DownloadTask): string {
  const { status, phase, chunks, totalUnknown } = strings.download
  if (task.status === 'queued') return status.queued
  if (task.status === 'succeeded') {
    return `${task.result?.name ?? ''} · ${formatBytes(task.result?.sizeBytes ?? task.totalBytes)}`
  }
  if (task.status === 'failed') return `${status.failed}：${task.error ?? ''}`
  if (task.status === 'canceled') return status.canceled
  const detail =
    task.totalBytes > 0
      ? `${formatBytes(task.receivedBytes)} / ${formatBytes(task.totalBytes)}${
          task.chunkCount > 0 ? ` · ${task.chunkCount} ${chunks}` : ''
        }`
      : `${formatBytes(task.receivedBytes)} / ${totalUnknown}`
  return `${status.running} · ${phase[task.phase ?? 'starting']} · ${detail}`
}

/**
 * 网络下载面板（侧边栏 Tab）。
 * 支持多个站点，每个站点是一套独立入口：切换站点后输入框、格式说明与任务列表都只作用于该站点，
 * 各站点的已填内容互不覆盖。
 * 任务列表由主进程事件驱动，本地只缓存快照：可同时排队多个下载（跨站点共用并发额度），
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
  const [source, setSource] = useState<DownloadSource>(SOURCES[0] ?? 'oldswf')
  // 每个站点各存一份输入内容，切站点不会丢掉已粘贴的链接
  const [inputs, setInputs] = useState<Record<DownloadSource, string>>({ oldswf: '', gamebox: '' })

  const site = strings.download.sources[source]
  const value = inputs[source]
  const visible = tasks.filter((task) => task.source === source)
  const allIds = visible.map((task) => task.id)
  const allSelected = allIds.length > 0 && selected.length === allIds.length

  // 勾选状态属于当前站点：切站点即清空，避免把上一个站点的勾选项带进「删除选中」
  const switchSource = (next: DownloadSource): void => {
    setSource(next)
    setSelected([])
  }

  const add = async (): Promise<void> => {
    const raw = value.trim()
    if (!raw) return
    try {
      await submit(source, raw)
      setInputs((prev) => ({ ...prev, [source]: '' }))
      message.success(strings.download.added)
    } catch (error) {
      // 输入格式、重复排队等判定都在主进程，这里直接回显它给出的原因
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

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

      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {strings.download.sourceTitle}
      </Typography.Text>
      <Segmented
        block
        value={source}
        options={SOURCES.map((key) => ({ value: key, label: strings.download.sources[key].label }))}
        onChange={(next) => switchSource(next as DownloadSource)}
        style={{ display: 'flex', margin: '6px 0 10px' }}
      />

      {/* 按站点 key 重挂，输入框与提示都属于当前站点 */}
      <div key={source}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '0 0 8px' }}>
          {site.note}
        </Typography.Paragraph>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder={site.placeholder}
            value={value}
            onChange={(e) => setInputs((prev) => ({ ...prev, [source]: e.target.value }))}
            onPressEnter={() => void add()}
          />
          <Button type="primary" onClick={() => void add()}>
            {strings.download.add}
          </Button>
        </div>
      </div>

      {visible.length > 0 && (
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

      {visible.length === 0 ? (
        <Empty description={strings.download.empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="dl-list">
          {visible.map((task) => {
            const active = task.status === 'queued' || task.status === 'running'
            const result = task.result
            return (
              <div className={`dl-task ${task.status}`} key={task.id}>
                <div className="dl-top">
                  <Checkbox
                    checked={selected.includes(task.id)}
                    onChange={() => toggleSelected(task.id)}
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
                      onClick={() => void cancel(task.id)}
                    >
                      {strings.download.cancel}
                    </Button>
                  )}
                  {(task.status === 'failed' || task.status === 'canceled') && (
                    <Button
                      size="small"
                      type="text"
                      icon={<ReloadOutlined />}
                      onClick={() => void retry(task.id)}
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
