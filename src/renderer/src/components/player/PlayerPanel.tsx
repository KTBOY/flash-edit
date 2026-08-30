import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, Button, Space, Tooltip } from 'antd'
import {
  CameraOutlined,
  FullscreenOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  SoundFilled,
  PlayCircleOutlined
} from '@ant-design/icons'
import { strings } from '@renderer/locales/zh'
import { useGameStore } from '@renderer/store/useGameStore'
import { useAppServices } from '@renderer/services/app-services'
import HudSlider from '@renderer/components/common/HudSlider'

/** 空状态引导：菱形标记 + 中英双语标题 */
function EmptyDropzone({ onPick }: { onPick: () => void }) {
  return (
    <div className="dropzone">
      <span className="diamond" />
      <div className="zh">{strings.player.dropTitle}</div>
      <div className="en">{strings.latin.dropToLoad}</div>
      <Button type="primary" onClick={onPick}>
        {strings.header.openSwf}
      </Button>
    </div>
  )
}

/** 播放器区域：四角角标容器 + 工具条 + 拖拽支持 */
export default function PlayerPanel() {
  const { controller, launcher } = useAppServices()
  const { message } = AntdApp.useApp()
  const game = useGameStore((s) => s.game)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    controller.setEvents({
      onPlayingChange: setPlaying,
      onFailed: (msg) => message.error(`游戏加载失败：${msg}`)
    })
    return () => controller.setEvents({})
  }, [controller, message])

  // 容器挂载后绑定（游戏加载中容器保持不变，无需重复绑定）
  useEffect(() => {
    const el = containerRef.current
    if (el) controller.attach(el)
    return () => controller.detach()
  }, [controller])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => setDragOver(false), [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void launcher.loadDroppedFile(file)
    },
    [launcher]
  )

  const takeScreenshot = () => {
    const dataUrl = controller.screenshot()
    if (!dataUrl) {
      message.warning(strings.player.screenshotFailed)
      return
    }
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `flash-trainer-${Date.now()}.png`
    link.click()
    message.success(strings.player.screenshotDone)
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div
        className="player-host hud-card"
        ref={containerRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {!game && <EmptyDropzone onPick={() => void launcher.loadPickedFile()} />}
        {dragOver && <div className="drop-overlay">{strings.player.dropActive}</div>}
      </div>

      {game && (
        <div className="player-tools hud-card" style={{ padding: '6px 10px' }}>
          <Space size={12} wrap style={{ justifyContent: 'center' }}>
            <Button
              size="small"
              type="primary"
              icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => controller.togglePlay()}
            >
              {playing ? strings.player.pause : strings.player.play}
            </Button>
            <Tooltip title={strings.player.restart}>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void controller.reload()} />
            </Tooltip>
            <Space size={6}>
              <SoundFilled style={{ color: 'var(--gold-dim)', fontSize: 12 }} />
              <HudSlider
                width={110}
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(v) => {
                  setVolume(v)
                  controller.setVolume(v)
                }}
              />
            </Space>
            <Tooltip title={strings.player.fullscreen}>
              <Button size="small" icon={<FullscreenOutlined />} onClick={() => controller.requestFullscreen()} />
            </Tooltip>
            <Tooltip title={strings.player.screenshot}>
              <Button size="small" icon={<CameraOutlined />} onClick={takeScreenshot} />
            </Tooltip>
          </Space>
        </div>
      )}
    </div>
  )
}
