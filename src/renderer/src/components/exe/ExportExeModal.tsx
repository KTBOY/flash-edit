import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Button, Input, Modal, Radio, Space, Typography } from 'antd'
import { AppstoreOutlined } from '@ant-design/icons'
import { strings } from '@renderer/locales/zh'
import { buildSwfFileUrl } from '@shared/protocol'
import { getApi } from '@renderer/services/ipc.service'
import { getLoadedSwfSource } from '@renderer/services/game-launcher'
import { useGameStore } from '@renderer/store/useGameStore'

type SwfSource =
  | { kind: 'current'; bytes: Uint8Array; name: string }
  | { kind: 'picked'; bytes: Uint8Array; name: string }
  | null

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 「打包 EXE」弹窗：把 SWF 附加到 Flash 独立播放器末尾，生成双击即玩的单文件 EXE。
 * 来源支持：当前加载的游戏 / 任意本地 SWF；播放器支持内置或自定义。
 */
export default function ExportExeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntdApp.useApp()
  const game = useGameStore((s) => s.game)
  const currentSource = useMemo(() => (open ? getLoadedSwfSource() : null), [open])

  const [useCurrent, setUseCurrent] = useState(true)
  const [picked, setPicked] = useState<SwfSource>(null)
  const [useCustomProjector, setUseCustomProjector] = useState(false)
  const [projectorBytes, setProjectorBytes] = useState<Uint8Array | null>(null)
  const [projectorName, setProjectorName] = useState('')
  const [outputName, setOutputName] = useState('')
  const [busy, setBusy] = useState(false)
  const projectorInputRef = useRef<HTMLInputElement | null>(null)

  // 打开时按当前游戏初始化
  useEffect(() => {
    if (!open) return
    setUseCurrent(currentSource !== null)
    setPicked(null)
    setUseCustomProjector(false)
    setProjectorBytes(null)
    setProjectorName('')
    setOutputName((game?.name ?? 'flash-game').replace(/\.swf$/i, ''))
  }, [open, currentSource, game])

  const activeSource: SwfSource | null =
    useCurrent && currentSource
      ? { kind: 'current', bytes: currentSource.bytes, name: currentSource.name }
      : picked

  const pickSwfFile = async () => {
    try {
      const pickedFile = await getApi().pickSwfFile()
      if (!pickedFile) return
      const response = await fetch(buildSwfFileUrl(pickedFile.path))
      if (!response.ok) throw new Error(`读取文件失败（HTTP ${response.status}）`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      setPicked({ kind: 'picked', bytes, name: pickedFile.name })
      setOutputName(pickedFile.name.replace(/\.swf$/i, ''))
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const pickProjector = async (file: File) => {
    setProjectorBytes(new Uint8Array(await file.arrayBuffer()))
    setProjectorName(file.name)
  }

  const pack = async () => {
    if (!activeSource) {
      message.warning(strings.exe.pickSwfFirst)
      return
    }
    const safeName = (outputName.trim() || 'flash-game').replace(/\.(exe|zip)$/i, '')
    setBusy(true)
    try {
      const result = await getApi().packSwfExe(
        activeSource.bytes,
        `${safeName}.exe`,
        useCustomProjector && projectorBytes ? projectorBytes : undefined
      )
      if (result.canceled) {
        message.info(strings.cheat.swfCanceled)
        return
      }
      message.success(
        `${strings.exe.packed}${result.path}（${formatBytes(result.exeSize)}）`
      )
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={strings.exe.title}
      open={open}
      onCancel={onClose}
      width={560}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={busy} disabled={!activeSource} onClick={() => void pack()}>
            {strings.exe.generate}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={14} style={{ width: '100%', marginTop: 8 }}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {strings.exe.hint}
        </Typography.Paragraph>

        {/* SWF 来源 */}
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {strings.exe.sourceTitle}
          </Typography.Text>
          <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
            <Radio.Group
              value={useCurrent ? 'current' : 'picked'}
              onChange={(e) => setUseCurrent(e.target.value === 'current')}
            >
              <Space direction="vertical" size={6}>
                <Radio value="current" disabled={!currentSource}>
                  {strings.exe.useCurrent}
                  {currentSource ? `（${currentSource.name}）` : strings.exe.useCurrentNone}
                </Radio>
                <Radio value="picked">{strings.exe.usePicked}</Radio>
              </Space>
            </Radio.Group>
            {!useCurrent && (
              <Space size={8}>
                <Button size="small" onClick={() => void pickSwfFile()}>
                  {strings.exe.chooseSwf}
                </Button>
                {picked && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {picked.name} · {formatBytes(picked.bytes.length)}
                  </Typography.Text>
                )}
              </Space>
            )}
          </Space>
        </div>

        {/* 输出名 */}
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {strings.exe.outputTitle}
          </Typography.Text>
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input
              value={outputName}
              placeholder="flash-game"
              onChange={(e) => setOutputName(e.target.value)}
            />
            <Input
              style={{ width: 70, pointerEvents: 'none' }}
              value=".exe"
              readOnly
              suffix={<AppstoreOutlined style={{ visibility: 'hidden' }} />}
            />
          </Space.Compact>
        </div>

        {/* 播放器选择 */}
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {strings.exe.projectorTitle}
          </Typography.Text>
          <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
            <Radio.Group
              value={useCustomProjector ? 'custom' : 'bundled'}
              onChange={(e) => setUseCustomProjector(e.target.value === 'custom')}
            >
              <Space direction="vertical" size={6}>
                <Radio value="bundled">{strings.exe.bundledProjector}</Radio>
                <Radio value="custom">{strings.exe.customProjector}</Radio>
              </Space>
            </Radio.Group>
            {useCustomProjector && (
              <Space size={8}>
                <input
                  ref={projectorInputRef}
                  type="file"
                  accept=".exe"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void pickProjector(file)
                  }}
                />
                <Button size="small" onClick={() => projectorInputRef.current?.click()}>
                  {strings.exe.chooseExe}
                </Button>
                {projectorName && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {projectorName}
                  </Typography.Text>
                )}
              </Space>
            )}
          </Space>
        </div>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {strings.exe.note}
        </Typography.Paragraph>
      </Space>
    </Modal>
  )
}
