import { useEffect, useState } from 'react'
import { App as AntdApp, Button, Typography } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import HudCard from '@renderer/components/common/HudCard'
import AboutSection from '@renderer/components/settings/AboutSection'

/** 设置面板：下载保存位置 / 关于 */
export default function SettingsPanel() {
  const { message } = AntdApp.useApp()
  const [downloadDir, setDownloadDir] = useState('')

  // 载入当前生效的下载保存目录
  useEffect(() => {
    void getApi()
      .getSettings()
      .then((s) => setDownloadDir(s.downloadDir))
      .catch(() => undefined)
  }, [])

  const changeDownloadDir = async () => {
    try {
      const next = await getApi().chooseDownloadDir()
      if (next) {
        setDownloadDir(next.downloadDir)
        message.success('下载保存位置已更新')
      }
    } catch {
      message.error('修改下载位置失败')
    }
  }

  return (
    <HudCard zh={strings.settings.tab} en={strings.latin.settings}>
      <div className="card-head" style={{ marginTop: 8 }}>
        <span className="mk" />
        <span className="zh">{strings.settings.downloadTitle}</span>
        <span className="ln" />
        <span className="en">{strings.latin.downloadPath}</span>
      </div>
      <div className="settings-row">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {strings.settings.downloadDirLabel}
        </Typography.Text>
        <Typography.Text
          style={{ fontSize: 12, color: 'var(--cream-dim)', maxWidth: 260 }}
          ellipsis={{ tooltip: downloadDir }}
        >
          {downloadDir || '…'}
        </Typography.Text>
        <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void changeDownloadDir()}>
          {strings.settings.changeDir}
        </Button>
      </div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
        {strings.settings.downloadDirHint}
      </Typography.Paragraph>

      <div className="hud-divider" />

      <div className="card-head">
        <span className="mk" />
        <span className="zh">{strings.settings.aboutTitle}</span>
        <span className="ln" />
        <span className="en">{strings.latin.about}</span>
      </div>
      <AboutSection />
    </HudCard>
  )
}
