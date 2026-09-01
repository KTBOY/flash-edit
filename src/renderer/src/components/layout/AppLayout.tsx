import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Dropdown, Input, Layout, Space, Tabs } from 'antd'
import {
  CloudDownloadOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons'
import { strings } from '@renderer/locales/zh'
import { isOldswfGamePageUrl } from '@shared/oldswf'
import { useGameStore } from '@renderer/store/useGameStore'
import { SIDER_WIDTH, useModeStore } from '@renderer/store/useModeStore'
import { AppServicesProvider, useAppServices } from '@renderer/services/app-services'
import PlayerPanel from '@renderer/components/player/PlayerPanel'
import ScanPanel from '@renderer/components/scan/ScanPanel'
import CheatListPanel from '@renderer/components/cheat/CheatListPanel'
import SettingsPanel from '@renderer/components/settings/SettingsPanel'
import GameLibraryPanel from '@renderer/components/library/GameLibraryPanel'
import ExportExeModal from '@renderer/components/exe/ExportExeModal'
import DownloadGameModal from '@renderer/components/download/DownloadGameModal'
import ProfileAutoSaver from './ProfileAutoSaver'
import WindowControls from './WindowControls'
import StatusBar from './StatusBar'

const { Header, Content } = Layout

/** 侧边栏 Tab 标识；打包模式下 scan / cheat 会被过滤掉 */
type PanelTabKey = 'library' | 'scan' | 'cheat' | 'settings'

/** 小号拉丁副标，与中文标签并列 */
function TabLabel({ zh, en }: { zh: string; en: string }) {
  return (
    <span>
      {zh}
      <em className="tab-lat">{en}</em>
    </span>
  )
}

/** 顶部栏：菱形标记 + 中英双语标题堆叠 + 运行状态 + 加载入口 */
function LayoutHeader({
  onOpenDownload
}: {
  onOpenDownload: (prefill?: string) => void
}) {
  const { launcher } = useAppServices()
  const phase = useGameStore((s) => s.phase)
  const game = useGameStore((s) => s.game)
  const fullMode = useModeStore((s) => s.fullMode)
  const siderOpen = useModeStore((s) => s.siderOpen)
  const toggleSider = useModeStore((s) => s.toggleSider)
  const [urlText, setUrlText] = useState('')
  const [urlOpen, setUrlOpen] = useState(false)
  const [exeModalOpen, setExeModalOpen] = useState(false)

  const loading = phase === 'loading'

  const openUrl = async () => {
    const url = urlText.trim()
    if (!url) return
    setUrlOpen(false)
    setUrlText('')
    // oldswf 游戏页有 TLS 指纹反爬且不支持跨域，网络加载必失败 → 引导到下载流程
    if (isOldswfGamePageUrl(url)) {
      onOpenDownload(url)
      return
    }
    await launcher.loadFromUrl(url)
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
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            loading={loading}
            onClick={() => void launcher.loadPickedFile()}
          >
            {strings.header.openSwf}
          </Button>

          <Button icon={<ExportOutlined />} onClick={() => setExeModalOpen(true)}>
            {strings.exe.titleShort}
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

          {fullMode && (
            <Button icon={<CloudDownloadOutlined />} onClick={() => onOpenDownload()}>
              {strings.download.titleShort}
            </Button>
          )}

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

/**
 * 右侧功能面板：游戏库 / 数值扫描 / 修改列表 / 设置。
 * 打包模式下只保留游戏库与设置；解锁完整模式后扫描与修改列表重新出现。
 */
function ToolPanel({ onOpenDownload }: { onOpenDownload: (prefill?: string) => void }) {
  const fullMode = useModeStore((s) => s.fullMode)
  const [activeKey, setActiveKey] = useState<PanelTabKey>('library')

  const items = useMemo(() => {
    const all: { key: PanelTabKey; label: ReactNode; children: ReactNode }[] = [
      {
        key: 'library',
        label: <TabLabel zh={strings.library.tab} en={strings.latin.tabLibrary} />,
        children: (
          <GameLibraryPanel onDownload={fullMode ? onOpenDownload : undefined} />
        )
      },
      {
        key: 'scan',
        label: <TabLabel zh={strings.scan.tab} en={strings.latin.tabScan} />,
        children: <ScanPanel />
      },
      {
        key: 'cheat',
        label: <TabLabel zh={strings.cheat.tab} en={strings.latin.tabCheat} />,
        children: <CheatListPanel />
      },
      {
        key: 'settings',
        label: <TabLabel zh={strings.settings.tab} en={strings.latin.tabSettings} />,
        children: <SettingsPanel />
      }
    ]
    return fullMode ? all : all.filter((item) => item.key !== 'scan' && item.key !== 'cheat')
  }, [fullMode, onOpenDownload])

  // 受控 activeKey：Tab 被模式过滤后，避免 rc-tabs 自动回退到 tabs[0] 造成跳 Tab
  useEffect(() => {
    if (!items.some((item) => item.key === activeKey)) setActiveKey('library')
  }, [items, activeKey])

  return (
    <Tabs
      className="panel-tabs"
      items={items}
      activeKey={activeKey}
      onChange={(key) => setActiveKey(key as PanelTabKey)}
      tabBarGutter={20}
    />
  )
}

/** 应用骨架：Header /（播放器 + 侧边栏）/ 状态栏 */
function AppShell() {
  const siderOpen = useModeStore((s) => s.siderOpen)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloadInput, setDownloadInput] = useState('')

  // 应用初始化：拉取版本信息与游戏库
  useEffect(() => {
    void useGameStore.getState().init()
  }, [])

  const openDownload = useCallback((prefill?: string) => {
    if (prefill !== undefined) setDownloadInput(prefill)
    setDownloadOpen(true)
  }, [])

  return (
    <Layout style={{ height: '100vh' }}>
      <LayoutHeader onOpenDownload={openDownload} />
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
            <ToolPanel onOpenDownload={openDownload} />
          </aside>
        )}
      </Layout>
      <StatusBar />

      <ProfileAutoSaver />
      <DownloadGameModal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        initialInput={downloadInput}
      />
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
