import { useEffect, useRef, useState } from 'react'
import { App as AntdApp, Button, Input, Modal, Progress, Space, Typography } from 'antd'
import type { OldswfDownloadProgress } from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { useAppServices } from '@renderer/services/app-services'

type ModalPhase = 'input' | 'busy' | 'failed'

const INPUT_RE = /^\d+$|^https?:\/\/oldswf\.(com|top)\/game\/\d+/

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 「下载游戏」弹窗：输入 oldswf 游戏页地址 / 数字 ID，
 * 主进程驱动真实浏览器完成下载（TLS 指纹反爬必须真实浏览器），
 * 成功后自动载入游戏并计入游戏库。
 */
export default function DownloadGameModal({
  open,
  onClose,
  initialInput
}: {
  open: boolean
  onClose: () => void
  initialInput?: string
}) {
  const { message } = AntdApp.useApp()
  const { launcher } = useAppServices()
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<ModalPhase>('input')
  const [progress, setProgress] = useState<OldswfDownloadProgress | null>(null)
  const [errorText, setErrorText] = useState('')
  const cancelRequestedRef = useRef(false)

  // 打开时重置会话，并应用预填输入（来自「网络加载」入口的引导分流）
  useEffect(() => {
    if (!open) return
    setPhase('input')
    setProgress(null)
    setErrorText('')
    cancelRequestedRef.current = false
    if (initialInput) setInput(initialInput)
  }, [open, initialInput])

  // 下载期间订阅主进程进度事件
  useEffect(() => {
    if (!open || phase !== 'busy') return
    return getApi().onOldswfDownloadProgress(setProgress)
  }, [open, phase])

  const start = async () => {
    const value = input.trim()
    if (!INPUT_RE.test(value)) {
      message.warning(strings.download.invalid)
      return
    }
    setPhase('busy')
    setProgress(null)
    setErrorText('')
    cancelRequestedRef.current = false
    try {
      const downloaded = await getApi().downloadOldswfGame(value)
      message.success(strings.download.done)
      onClose()
      void launcher.loadDownloadedFile(downloaded)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setErrorText(detail)
      setPhase('failed')
      if (cancelRequestedRef.current) message.info(strings.download.canceled)
      else message.error(`${strings.download.failedTitle}：${detail}`)
    }
  }

  const cancel = async () => {
    cancelRequestedRef.current = true
    await getApi().cancelOldswfDownload()
  }

  const busy = phase === 'busy'
  const percent =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
      : null

  const progressText = (): string => {
    if (!progress) return strings.download.starting
    switch (progress.phase) {
      case 'starting':
        return strings.download.starting
      case 'extracting':
        return strings.download.extracting
      case 'saving':
        return strings.download.saving
      default: {
        const total =
          progress.totalBytes > 0 ? formatBytes(progress.totalBytes) : strings.download.totalUnknown
        return `${strings.download.downloading} · ${formatBytes(progress.receivedBytes)} / ${total} · ${progress.chunkCount} ${strings.download.chunks}`
      }
    }
  }

  return (
    <Modal
      title={strings.download.title}
      open={open}
      width={520}
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      maskClosable={false}
      keyboard={!busy}
      footer={
        <Space>
          {busy ? (
            <Button danger onClick={() => void cancel()}>
              {strings.download.cancel}
            </Button>
          ) : (
            <>
              <Button onClick={onClose}>{strings.download.close}</Button>
              <Button type="primary" onClick={() => void start()}>
                {strings.download.start}
              </Button>
            </>
          )}
        </Space>
      }
    >
      <Space direction="vertical" size={14} style={{ width: '100%', marginTop: 8 }}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {strings.download.hint}
        </Typography.Paragraph>

        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {strings.download.inputLabel}
          </Typography.Text>
          <Input
            style={{ marginTop: 8 }}
            placeholder={strings.download.inputPlaceholder}
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={() => {
              if (!busy) void start()
            }}
          />
        </div>

        {busy && (
          <div>
            <Progress percent={percent ?? 100} status="active" showInfo={percent !== null} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {progressText()}
            </Typography.Text>
          </div>
        )}

        {phase === 'failed' && (
          <Typography.Paragraph type="danger" style={{ fontSize: 12, marginBottom: 0 }}>
            {strings.download.failedTitle}：{errorText}
          </Typography.Paragraph>
        )}
      </Space>
    </Modal>
  )
}
