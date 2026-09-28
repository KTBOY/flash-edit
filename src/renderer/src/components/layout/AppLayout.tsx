import { useEffect, useState, type ReactNode } from 'react'
import { Button, Layout, Space, Tabs } from 'antd'
import {
  ExportOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons'
import { strings } from '@renderer/locales/zh'
import { useGameStore } from '@renderer/store/useGameStore'
import { useDownloadStore } from '@renderer/store/useDownloadStore'
import { SIDER_WIDTH, useUiStore } from '@renderer/store/useUiStore'
import { AppServicesProvider, useAppServices } from '@renderer/services/app-services'
import PlayerPanel from '@renderer/components/player/PlayerPanel'
import ScanPanel from '@renderer/components/scan/ScanPanel'
import CheatListPanel from '@renderer/components/cheat/CheatListPanel'
import SettingsPanel from '@renderer/components/settings/SettingsPanel'
import GameLibraryPanel from '@renderer/components/library/GameLibraryPanel'
import DownloadPanel from '@renderer/components/download/DownloadPanel'
import ExportExeModal from '@renderer/components/exe/ExportExeModal'
import ProfileAutoSaver from './ProfileAutoSaver'
import WindowControls from './WindowControls'
import StatusBar from './StatusBar'

const { Header, Content } = Layout

/** 顶部栏：菱形标记 + 中英双语标题堆叠 + 运行状态 + 本地载入入口 */
function LayoutHeader() {
  const { launcher } = useAppServices()
  const phase = useGameStore((s) => s.phase)
  const game = useGameStore((s) => s.game)
  const siderOpen = useUiStore((s) => s.siderOpen)
  const toggleSider = useUiStore((s) => s.toggleSider)
  const [exeModalOpen, setExeModalOpen] = useState(false)

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
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            loading={phase === 'loading'}
            onClick={() => void launcher.loadPickedFile()}
          >
            {strings.header.openSwf}
          </Button>

          <Button icon={<ExportOutlined />} onClick={() => setExeModalOpen(true)}>
            {strings.exe.titleShort}
          </Button>

          <Button
            className="sider-toggle"
            icon={siderOpen ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            title={strings.header.siderToggle}
            onClick={toggleSider}
          />
        </Space>

        <WindowControls />
      </div>

      <ExportExeModal open={exeModalOpen} onClose={() => setExeModalOpen(false)} />
    </Header>
  )
}

/** 右侧功能面板：游戏库 / 网络下载 / 数值扫描 / 修改列表 / 设置 */
type PanelTabKey = 'library' | 'download' | 'scan' | 'cheat' | 'settings'

/**
 * 数值修改功能（数值扫描 + 修改列表）总开关。
 * 置为 false 仅隐藏侧边栏入口，相关组件、store 与内存扫描逻辑完整保留，
 * 恢复时改回 true 即可。
 */
const SHOW_CHEAT_FEATURES: boolean = false

function ToolPanel() {
  const [activeKey, setActiveKey] = useState<PanelTabKey>('library')

  const all: { key: PanelTabKey; label: string; children: ReactNode }[] = [
    { key: 'library', label: strings.library.tab, children: <GameLibraryPanel /> },
    { key: 'download', label: strings.download.tab, children: <DownloadPanel /> },
    { key: 'scan', label: strings.scan.tab, children: <ScanPanel /> },
    { key: 'cheat', label: strings.cheat.tab, children: <CheatListPanel /> },
    { key: 'settings', label: strings.settings.tab, children: <SettingsPanel /> }
  ]
  const items = SHOW_CHEAT_FEATURES
    ? all
    : all.filter((item) => item.key !== 'scan' && item.key !== 'cheat')

  return (
    <Tabs
      className="panel-tabs"
      activeKey={activeKey}
      onChange={(key) => setActiveKey(key as PanelTabKey)}
      tabBarGutter={20}
      items={items}
    />
  )
}

/** 应用骨架：Header /（播放器 + 侧边栏）/ 状态栏 */
function AppShell() {
  const siderOpen = useUiStore((s) => s.siderOpen)

  // 应用初始化：版本信息与游戏库；下载任务事件全局订阅（面板切走也不掉进度）
  useEffect(() => {
    void useGameStore.getState().init()
    useDownloadStore.getState().attach()
  }, [])

  return (
    <Layout style={{ height: '100vh' }}>
      <LayoutHeader />
      <Layout
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'row',
          padding: 12,
          gap: 12,
          background: 'transparent',
          minHeight: 0
        }}
      >
        <Content style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
          <PlayerPanel />
        </Content>
        {siderOpen && (
          <aside className="panel" style={{ flex: `0 0 ${SIDER_WIDTH}px`, minHeight: 0 }}>
            <ToolPanel />
          </aside>
        )}
      </Layout>
      <StatusBar />

      <ProfileAutoSaver />
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
