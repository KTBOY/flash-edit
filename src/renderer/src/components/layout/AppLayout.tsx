import { useEffect, useState, type ReactNode } from 'react'
import { App as AntdApp, Button, Dropdown, Input, Layout, Space, Tabs } from 'antd'
import {
  ExportOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  ReadOutlined
} from '@ant-design/icons'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { useGameStore } from '@renderer/store/useGameStore'
import { useCheatStore } from '@renderer/store/useCheatStore'
import { AppServicesProvider, useAppServices } from '@renderer/services/app-services'
import PlayerPanel from '@renderer/components/player/PlayerPanel'
import ScanPanel from '@renderer/components/scan/ScanPanel'
import CheatListPanel from '@renderer/components/cheat/CheatListPanel'
import SettingsPanel from '@renderer/components/settings/SettingsPanel'
import GameLibraryPanel from '@renderer/components/library/GameLibraryPanel'
import ExportExeModal from '@renderer/components/exe/ExportExeModal'
import WindowControls from './WindowControls'
import StatusBar from './StatusBar'

const { Header, Content, Sider } = Layout

/** 顶部栏：菱形标记 + 中英双语标题堆叠 + 运行状态 + 加载入口 */
function LayoutHeader() {
  const { launcher } = useAppServices()
  const phase = useGameStore((s) => s.phase)
  const game = useGameStore((s) => s.game)
  const [urlText, setUrlText] = useState('')
  const [urlOpen, setUrlOpen] = useState(false)
  const [exeModalOpen, setExeModalOpen] = useState(false)

  const loading = phase === 'loading'

  const openUrl = async () => {
    if (!urlText.trim()) return
    setUrlOpen(false)
    await launcher.loadFromUrl(urlText)
    setUrlText('')
  }

  return (
    <Header className="hud-header">
      <Space size={14}>
        <span className="diamond" />
        <div className="hud-titlebar">
          <div className="tt">
            <b>{strings.app.title}</b>
            <i>{strings.latin.appTitle}</i>
          </div>
        </div>
        {game ? (
          <>
            <span className="hud-state on">
              <s className="diamond live" style={{ textDecoration: 'none' }} />
              {strings.latin.stateOn}
            </span>
            <span className="hud-game-name" title={game.name}>
              {game.name}
            </span>
          </>
        ) : (
          <span className="hud-state">{strings.latin.stateIdle}</span>
        )}
      </Space>

      <div className="header-right">
        <Space>
          <Button icon={<ExportOutlined />} onClick={() => setExeModalOpen(true)}>
            {strings.exe.titleShort}
          </Button>
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            loading={loading}
            onClick={() => void launcher.loadPickedFile()}
          >
            {strings.header.openSwf}
          </Button>

        <Dropdown
          open={urlOpen}
          onOpenChange={setUrlOpen}
          trigger={['click']}
          popupRender={() => (
            <div
              style={{
                background: '#1f1f1f',
                padding: 8,
                borderRadius: 0,
                display: 'flex',
                gap: 8
              }}
            >
              <Input
                style={{ width: 360 }}
                placeholder="https://example.com/game.swf"
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                onPressEnter={() => void openUrl()}
              />
              <Button type="primary" onClick={() => void openUrl()}>
                {strings.header.openUrl}
              </Button>
            </div>
          )}
        >
          <Button icon={<GlobalOutlined />}>{strings.header.openUrl}</Button>
        </Dropdown>

        <Dropdown trigger={['click']} popupRender={() => <GameLibraryPanel />} destroyPopupOnHide>
          <Button icon={<ReadOutlined />}>{strings.header.library}</Button>
        </Dropdown>
        </Space>

        <WindowControls />
      </div>

      <ExportExeModal open={exeModalOpen} onClose={() => setExeModalOpen(false)} />
    </Header>
  )
}

/** 右侧功能面板：扫描 / 修改列表 / 设置（拉丁小标随中文标签） */
function ToolPanel() {
  const items: { key: string; label: ReactNode; children: ReactNode }[] = [
    {
      key: 'scan',
      label: (
        <span>
          {strings.scan.tab}
          <em className="tab-lat">{strings.latin.tabScan}</em>
        </span>
      ),
      children: <ScanPanel />
    },
    {
      key: 'cheat',
      label: (
        <span>
          {strings.cheat.tab}
          <em className="tab-lat">{strings.latin.tabCheat}</em>
        </span>
      ),
      children: <CheatListPanel />
    },
    {
      key: 'settings',
      label: (
        <span>
          {strings.settings.tab}
          <em className="tab-lat">{strings.latin.tabSettings}</em>
        </span>
      ),
      children: <SettingsPanel />
    }
  ]
  return (
    <Sider width={470} theme="dark" className="panel" style={{ overflow: 'hidden' }}>
      <div className="scroll-panel" style={{ height: '100%', padding: '6px 12px 12px' }}>
        <Tabs items={items} tabBarGutter={20} />
      </div>
    </Sider>
  )
}

/** 应用骨架：Header /（播放器 + 工具面板）/ 状态栏 */
function AppShell() {
  const { message } = AntdApp.useApp()

  // 应用初始化：拉取版本信息与游戏库
  useEffect(() => {
    void useGameStore.getState().init()
  }, [])

  // 修改配置自动保存（防抖 800ms；speed 一并持久化）
  const entries = useCheatStore((s) => s.entries)
  const gameHash = useCheatStore((s) => s.gameHash)
  const speed = useGameStore((s) => s.speed)

  useEffect(() => {
    if (!gameHash) return
    const timer = setTimeout(() => {
      const profile = useCheatStore.getState().buildProfile()
      if (!profile) return
      getApi()
        .saveProfile(profile)
        .catch(() => message.warning('修改配置自动保存失败'))
    }, 800)
    return () => clearTimeout(timer)
  }, [entries, gameHash, speed, message])

  return (
    <Layout style={{ height: '100vh' }}>
      <LayoutHeader />
      <Layout style={{ padding: 12, gap: 12, background: 'transparent', minHeight: 0 }}>
        <Content style={{ display: 'flex', minWidth: 0, minHeight: 0 }}>
          <PlayerPanel />
        </Content>
        <ToolPanel />
      </Layout>
      <StatusBar />
    </Layout>
  )
}

export default function AppLayout() {
  return (
    <AppServicesProvider>
      <AppShell />
    </AppServicesProvider>
  )
}
