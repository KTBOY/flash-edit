import { useState } from 'react'
import { App as AntdApp, Button, Space, Typography } from 'antd'
import { FileZipOutlined, FolderOpenOutlined, LinkOutlined } from '@ant-design/icons'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { toast } from '@renderer/services/ui-message'

/**
 * 一键解压安装卡片：选 WinRAR 自解压游戏包 + 解压产物里的启动器 EXE +
 * bat 输出目录，生成「一键解压安装.bat」供随包分发。
 */
function SfxInstallToolCard() {
  const { message, modal } = AntdApp.useApp()
  const [sfxPath, setSfxPath] = useState<string | null>(null)
  const [launcherPath, setLauncherPath] = useState<string | null>(null)
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [doneBatPath, setDoneBatPath] = useState<string | null>(null)

  const pickSfx = async (): Promise<void> => {
    try {
      const picked = await getApi().pickExeFile()
      if (!picked) return
      setSfxPath(picked.path)
      setDoneBatPath(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const pickLauncher = async (): Promise<void> => {
    try {
      const picked = await getApi().pickExeFile()
      if (!picked) return
      setLauncherPath(picked.path)
      setDoneBatPath(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const pickDir = async (): Promise<void> => {
    try {
      const dir = await getApi().pickDirectory(strings.toolbox.sfxPickDirTitle)
      if (!dir) return
      setOutputDir(dir)
      setDoneBatPath(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const confirmGenerate = (): void => {
    if (!sfxPath || !launcherPath || !outputDir) return
    modal.confirm({
      title: strings.toolbox.sfxConfirmTitle,
      width: 560,
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
          <Row label={strings.toolbox.sfxConfirmSfx} path={sfxPath} />
          <Row label={strings.toolbox.sfxConfirmLauncher} path={launcherPath} />
          <Row label={strings.toolbox.sfxConfirmBat} path={outputDir} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {strings.toolbox.sfxConfirmNote}
          </Typography.Text>
        </Space>
      ),
      okText: strings.toolbox.sfxGenerate,
      cancelText: strings.library.confirmCancel,
      onOk: async () => {
        setBusy(true)
        try {
          const result = await getApi().createSfxInstallBat(sfxPath, launcherPath, outputDir)
          setDoneBatPath(result.batPath)
          message.success(
            toast(
              result.mode === 'portable'
                ? strings.toolbox.sfxDone
                : strings.toolbox.sfxDoneAbsolute
            )
          )
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }
    })
  }

  return (
    <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Space size={8}>
        <FileZipOutlined style={{ color: 'var(--gold-dim)' }} />
        <Typography.Text strong style={{ fontSize: 13 }}>
          {strings.toolbox.sfxTitle}
        </Typography.Text>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        {strings.toolbox.sfxHint}
      </Typography.Paragraph>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Button icon={<FileZipOutlined />} onClick={() => void pickSfx()}>
            {strings.toolbox.sfxPickSfx}
          </Button>
          <Typography.Text style={{ fontSize: 12, maxWidth: 220 }} ellipsis>
            {sfxPath ?? strings.toolbox.noneSelected}
          </Typography.Text>
        </Space>
        <Space size={8} wrap>
          <Button icon={<LinkOutlined />} onClick={() => void pickLauncher()}>
            {strings.toolbox.sfxPickLauncher}
          </Button>
          <Typography.Text style={{ fontSize: 12, maxWidth: 220 }} ellipsis>
            {launcherPath ?? strings.toolbox.noneSelected}
          </Typography.Text>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {strings.toolbox.sfxLauncherHint}
        </Typography.Text>
        <Space size={8} wrap>
          <Button icon={<FolderOpenOutlined />} onClick={() => void pickDir()}>
            {strings.toolbox.sfxPickDir}
          </Button>
          <Typography.Text style={{ fontSize: 12, maxWidth: 220 }} ellipsis>
            {outputDir ?? strings.toolbox.noneSelected}
          </Typography.Text>
        </Space>
      </Space>

      <Space size={8} wrap>
        <Button
          type="primary"
          disabled={!sfxPath || !launcherPath || !outputDir}
          loading={busy}
          onClick={confirmGenerate}
        >
          {strings.toolbox.sfxGenerate}
        </Button>
        {doneBatPath && (
          <Button
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => getApi().showFileInFolder(doneBatPath)}
          >
            {strings.toolbox.reveal}
          </Button>
        )}
      </Space>
    </div>
  )
}

function Row({ label, path }: { label: string; path: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {label}
      </Typography.Text>
      <Typography.Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{path}</Typography.Text>
    </div>
  )
}

export default SfxInstallToolCard
