import { useState } from 'react'
import { App as AntdApp, Button, Modal, Space, Typography } from 'antd'
import { FolderOpenOutlined, LinkOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { toast } from '@renderer/services/ui-message'

/**
 * 工具箱面板：轻量小工具的入口，当前只有「创建快捷方式（生成 bat）」。
 * 面板按工具卡片纵向排列，后续工具往这里加卡片即可。
 */

/** 与主进程 SHORTCUT_BAT_NAME 一致，仅用于界面预览生成位置 */
const SHORTCUT_BAT_NAME = '点我就可以创建快捷方式.bat'

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {label}
      </Typography.Text>
      <Typography.Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{path}</Typography.Text>
    </div>
  )
}

/** 创建快捷方式卡片：选 EXE → 选输出目录 → 确认生成 → 成功后可定位文件 */
function ShortcutToolCard() {
  const { message, modal } = AntdApp.useApp()
  const [exePath, setExePath] = useState<string | null>(null)
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [doneBatPath, setDoneBatPath] = useState<string | null>(null)

  const pickExe = async (): Promise<void> => {
    try {
      const picked = await getApi().pickExeFile()
      if (!picked) return
      setExePath(picked.path)
      setDoneBatPath(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const pickDir = async (): Promise<void> => {
    try {
      const dir = await getApi().pickDirectory(strings.toolbox.pickDirTitle)
      if (!dir) return
      setOutputDir(dir)
      setDoneBatPath(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const confirmGenerate = (): void => {
    if (!exePath || !outputDir) return
    modal.confirm({
      title: strings.toolbox.confirmTitle,
      width: 520,
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
          <PathRow label={strings.toolbox.confirmExe} path={exePath} />
          <PathRow
            label={strings.toolbox.confirmBat}
            path={`${outputDir}\\${SHORTCUT_BAT_NAME}`}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {strings.toolbox.confirmNote}
          </Typography.Text>
        </Space>
      ),
      okText: strings.toolbox.generate,
      cancelText: strings.library.confirmCancel,
      onOk: async () => {
        setBusy(true)
        try {
          const result = await getApi().createShortcutBat(exePath, outputDir)
          setDoneBatPath(result.batPath)
          message.success(
            toast(
              result.mode === 'portable'
                ? strings.toolbox.done
                : strings.toolbox.doneAbsolute
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
        <ThunderboltOutlined style={{ color: 'var(--gold-dim)' }} />
        <Typography.Text strong style={{ fontSize: 13 }}>
          {strings.toolbox.shortcutTitle}
        </Typography.Text>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        {strings.toolbox.shortcutHint}
      </Typography.Paragraph>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Button icon={<LinkOutlined />} onClick={() => void pickExe()}>
            {strings.toolbox.pickExe}
          </Button>
          <Typography.Text style={{ fontSize: 12, maxWidth: 260 }} ellipsis>
            {exePath ?? strings.toolbox.noneSelected}
          </Typography.Text>
        </Space>
        <Space size={8} wrap>
          <Button icon={<FolderOpenOutlined />} onClick={() => void pickDir()}>
            {strings.toolbox.pickDir}
          </Button>
          <Typography.Text style={{ fontSize: 12, maxWidth: 260 }} ellipsis>
            {outputDir ?? strings.toolbox.noneSelected}
          </Typography.Text>
        </Space>
      </Space>

      <Space size={8} wrap>
        <Button
          type="primary"
          disabled={!exePath || !outputDir}
          loading={busy}
          onClick={confirmGenerate}
        >
          {strings.toolbox.generate}
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

      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {strings.toolbox.securityNote}
      </Typography.Text>
    </div>
  )
}

export default function ToolboxPanel() {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12, padding: 8 }}>
      <ShortcutToolCard />
    </div>
  )
}
