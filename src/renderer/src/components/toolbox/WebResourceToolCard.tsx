import { useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Image as AntdImage,
  Input,
  Progress,
  Select,
  Space,
  Tag,
  Typography
} from 'antd'
import {
  CloudDownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  PictureOutlined,
  PlaySquareOutlined,
  StopOutlined
} from '@ant-design/icons'
import type {
  WebResourceDownloadProgress,
  WebResourceInfo,
  WebResourceParseResult,
  WebResourceSiteId
} from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'

/**
 * 工具箱 · 网页资源下载卡片。
 * 解析在主进程完成，这里只负责展示与操作：站点下拉 + 地址输入 → 资源列表
 * （缩略图 / 类型 / 文件名）→ 单个另存或批量下载到选定目录；
 * 进度由主进程事件推送，url 作本地状态键。
 */

const SITE_OPTIONS: { value: WebResourceSiteId; label: string }[] = [
  { value: 'auto', label: strings.toolbox.webResourceSiteAuto },
  { value: 'gameshare', label: strings.toolbox.webResourceSiteGameshare },
  { value: 'generic', label: strings.toolbox.webResourceSiteGeneric }
]

const KIND_LABEL = {
  image: strings.toolbox.webResourceTagImage,
  video: strings.toolbox.webResourceTagVideo,
  embed: strings.toolbox.webResourceTagEmbed,
  file: strings.toolbox.webResourceTagFile
} as const

const KIND_COLOR = { image: 'gold', video: 'blue', embed: 'purple', file: 'default' } as const

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 单个资源的下载条目（进度事件与本地发起共用 url 作键；savePath 来自完成结果） */
type DownloadEntry = WebResourceDownloadProgress & { savePath?: string }

function ResourceThumb({ resource }: { resource: WebResourceInfo }) {
  if (resource.kind === 'image' || (resource.kind === 'video' && resource.coverUrl)) {
    return (
      <AntdImage
        src={resource.kind === 'image' ? resource.url : resource.coverUrl}
        referrerPolicy="no-referrer"
        width={56}
        height={42}
        style={{ objectFit: 'cover', borderRadius: 2, flexShrink: 0 }}
      />
    )
  }
  const Icon = resource.kind === 'embed' ? PlaySquareOutlined : resource.kind === 'video' ? PictureOutlined : FileOutlined
  return (
    <div
      style={{
        width: 56,
        height: 42,
        borderRadius: 2,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,255,255,0.06)'
      }}
    >
      <Icon style={{ color: 'var(--gold-dim)', fontSize: 18 }} />
    </div>
  )
}

function ResourceItem({
  resource,
  entry,
  pageUrl,
  onDownload,
  onCancel
}: {
  resource: WebResourceInfo
  entry: DownloadEntry | undefined
  /** 所属页面地址：HLS 播放列表（.m3u8）没有可播的直链，打开按钮转跳原页面 */
  pageUrl: string
  onDownload: (resource: WebResourceInfo) => void
  onCancel: (entry: DownloadEntry) => void
}) {
  const status = entry?.status
  const downloading = status === 'downloading'
  const succeeded = status === 'succeeded'
  const percent = succeeded
    ? 100
    : entry && entry.totalBytes > 0
      ? Math.min(99, Math.round((entry.receivedBytes / entry.totalBytes) * 100))
      : 0
  const sizeText = !entry
    ? ''
    : succeeded
      ? formatBytes(entry.totalBytes || entry.receivedBytes)
      : downloading
        ? `${formatBytes(entry.receivedBytes)} / ${
            entry.totalBytes > 0
              ? formatBytes(entry.totalBytes)
              : strings.toolbox.webResourceSizeUnknown
          }`
        : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ResourceThumb resource={resource} />
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Space size={6}>
            <Tag color={KIND_COLOR[resource.kind]} style={{ margin: 0 }}>
              {KIND_LABEL[resource.kind]}
            </Tag>
            <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: resource.url }}>
              {resource.fileName}
            </Typography.Text>
          </Space>
          <Space size={8} style={{ justifyContent: 'space-between', width: '100%' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {sizeText}
            </Typography.Text>
            <Space size={0}>
              {resource.kind === 'embed' && (
                <Button
                  size="small"
                  type="text"
                  icon={<GlobalOutlined />}
                  onClick={() =>
                    getApi().openExternal(/\.m3u8([?#]|$)/i.test(resource.url) ? pageUrl : resource.url)
                  }
                >
                  {strings.toolbox.webResourceOpen}
                </Button>
              )}
              {downloading && (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<StopOutlined />}
                  disabled={!entry?.downloadId}
                  onClick={() => entry && onCancel(entry)}
                >
                  {strings.toolbox.webResourceCancel}
                </Button>
              )}
              {succeeded && entry?.savePath && (
                <Button
                  size="small"
                  type="text"
                  icon={<FolderOpenOutlined />}
                  onClick={() => getApi().showFileInFolder(entry.savePath!)}
                >
                  {strings.toolbox.webResourceReveal}
                </Button>
              )}
              {!downloading && resource.kind !== 'embed' && (
                <Button
                  size="small"
                  type="text"
                  icon={<CloudDownloadOutlined />}
                  onClick={() => onDownload(resource)}
                >
                  {strings.toolbox.webResourceDownload}
                </Button>
              )}
            </Space>
          </Space>
        </div>
      </div>
      {downloading && <Progress percent={percent} size="small" showInfo={false} status="active" />}
      {status === 'failed' && (
        <Typography.Text type="danger" style={{ fontSize: 11 }} ellipsis>
          {entry?.error}
        </Typography.Text>
      )}
    </div>
  )
}

export default function WebResourceToolCard() {
  const { message } = AntdApp.useApp()
  const [siteId, setSiteId] = useState<WebResourceSiteId>('auto')
  const [url, setUrl] = useState('')
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<WebResourceParseResult | null>(null)
  const [entries, setEntries] = useState<Record<string, DownloadEntry>>({})
  const [batchBusy, setBatchBusy] = useState(false)

  // 订阅主进程进度推送；面板切走后订阅仍在（Tabs 不卸载已挂载的面板）
  useEffect(
    () =>
      getApi().onWebResourceProgress((progress) => {
        setEntries((prev) => ({
          ...prev,
          [progress.url]: { ...(prev[progress.url] ?? {}), ...progress }
        }))
      }),
    []
  )

  const parse = async (): Promise<void> => {
    const raw = url.trim()
    if (!raw) return
    setParsing(true)
    try {
      const parsed = await getApi().parseWebResource(siteId, raw)
      if (parsed.resources.length === 0) {
        setResult(null)
        message.warning(strings.toolbox.webResourceParseEmpty)
        return
      }
      setResult(parsed)
      setEntries({})
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setParsing(false)
    }
  }

  /** 下载单个资源：outputDir 缺省时主进程弹另存为；notify 控制结束 toast（批量时关闭） */
  const downloadOne = async (
    resource: WebResourceInfo,
    outputDir?: string,
    notify = true
  ): Promise<void> => {
    if (!result) return
    setEntries((prev) => ({
      ...prev,
      [resource.url]: {
        url: resource.url,
        downloadId: prev[resource.url]?.downloadId ?? '',
        receivedBytes: 0,
        totalBytes: 0,
        status: 'downloading'
      }
    }))
    try {
      const saved = await getApi().downloadWebResource({
        url: resource.url,
        referer: result.pageUrl,
        defaultName: resource.fileName,
        ...(outputDir ? { outputDir } : {})
      })
      if (!saved) {
        // 用户在另存为对话框取消：还原为未下载状态
        setEntries((prev) => {
          const next = { ...prev }
          delete next[resource.url]
          return next
        })
        return
      }
      setEntries((prev) => ({
        ...prev,
        [resource.url]: {
          ...(prev[resource.url] ?? { url: resource.url, downloadId: saved.downloadId }),
          url: resource.url,
          downloadId: prev[resource.url]?.downloadId || saved.downloadId,
          receivedBytes: saved.sizeBytes,
          totalBytes: saved.sizeBytes,
          status: saved.canceled ? 'canceled' : 'succeeded',
          savePath: saved.savePath
        }
      }))
      if (notify) {
        message[saved.canceled ? 'info' : 'success'](
          saved.canceled ? strings.toolbox.webResourceCanceled : strings.toolbox.webResourceSaved
        )
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  /** 全部下载：选一个目录，2 路并发逐个落盘（嵌入类资源跳过） */
  const downloadAll = async (): Promise<void> => {
    if (!result || batchBusy) return
    const targets = result.resources.filter((r) => r.kind !== 'embed')
    if (targets.length === 0) return
    let dir: string | null
    try {
      dir = await getApi().pickDirectory(strings.toolbox.webResourcePickBatchDir)
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
      return
    }
    if (!dir) return
    const targetDir = dir
    setBatchBusy(true)
    try {
      const queue = [...targets]
      const worker = async (): Promise<void> => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await downloadOne(next, targetDir, false)
        }
      }
      await Promise.all([worker(), worker()])
      message.success(strings.toolbox.webResourceBatchDone)
    } finally {
      setBatchBusy(false)
    }
  }

  const cancelOne = (entry: DownloadEntry): void => {
    if (entry.downloadId) void getApi().cancelWebResourceDownload(entry.downloadId)
  }

  const downloadableCount = result?.resources.filter((r) => r.kind !== 'embed').length ?? 0

  return (
    <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Space size={8}>
        <CloudDownloadOutlined style={{ color: 'var(--gold-dim)' }} />
        <Typography.Text strong style={{ fontSize: 13 }}>
          {strings.toolbox.webResourceTitle}
        </Typography.Text>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        {strings.toolbox.webResourceHint}
      </Typography.Paragraph>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={siteId}
            onChange={(next) => setSiteId(next)}
            options={SITE_OPTIONS}
            style={{ width: 108, flexShrink: 0 }}
          />
          <Input
            placeholder={strings.toolbox.webResourceUrlPlaceholder}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPressEnter={() => void parse()}
            allowClear
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <Button
            type="primary"
            loading={parsing}
            disabled={!url.trim()}
            onClick={() => void parse()}
          >
            {strings.toolbox.webResourceParse}
          </Button>
          {result && (
            <Button
              loading={batchBusy}
              disabled={downloadableCount === 0}
              onClick={() => void downloadAll()}
            >
              {strings.toolbox.webResourceBatch}
            </Button>
          )}
        </div>
      </Space>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis>
            {strings.toolbox.webResourcePageTitle}：{result.pageTitle || result.pageUrl} ·{' '}
            {strings.toolbox.webResourceCount} {result.resources.length}{' '}
            {strings.toolbox.webResourceUnit}
          </Typography.Text>
          {result.resources.map((resource) => (
            <ResourceItem
              key={resource.url}
              resource={resource}
              entry={entries[resource.url]}
              pageUrl={result.pageUrl}
              onDownload={(r) => void downloadOne(r)}
              onCancel={cancelOne}
            />
          ))}
        </div>
      )}
    </div>
  )
}
