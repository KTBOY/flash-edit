import { App as AntdApp, Button, Empty, List, Popconfirm, Typography } from 'antd'
import { CloudDownloadOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons'
import type { GameRecord } from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { useGameStore } from '@renderer/store/useGameStore'
import { useAppServices } from '@renderer/services/app-services'

/**
 * 游戏库（最近游玩）。
 * - 默认内嵌态（侧边栏 Tab）：撑满容器，无浮层装饰；
 * - embedded=false 时为浮层态，保留固定宽高与阴影。
 * onDownload 不传时隐藏「下载新游戏」（打包模式下的精简形态）。
 */
export default function GameLibraryPanel({
  onDownload,
  embedded = true
}: {
  onDownload?: () => void
  embedded?: boolean
}) {
  const { launcher } = useAppServices()
  const { message } = AntdApp.useApp()
  const recent = useGameStore((s) => s.recent)
  const refreshRecent = useGameStore((s) => s.refreshRecent)

  const remove = async (hash: string) => {
    try {
      await getApi().removeRecentGame(hash)
      await refreshRecent()
    } catch {
      message.error('删除记录失败')
    }
  }

  return (
    <div
      style={
        embedded
          ? { width: '100%' }
          : {
              width: 360,
              maxHeight: 420,
              overflow: 'auto',
              background: 'var(--bg-1)',
              border: '1px solid var(--hair)',
              borderRadius: 0,
              padding: 8,
              boxShadow: '0 20px 60px rgba(0,0,0,.6)'
            }
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Text strong style={{ padding: '4px 8px' }}>
          {strings.library.title}
        </Typography.Text>
        {onDownload && (
          <Button size="small" type="link" icon={<CloudDownloadOutlined />} onClick={onDownload}>
            {strings.download.libraryEntry}
          </Button>
        )}
      </div>
      {recent.length === 0 ? (
        <Empty description={strings.library.empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={recent}
          renderItem={(record: GameRecord) => (
            <List.Item
              style={{ padding: '6px 8px' }}
              actions={[
                <Button
                  key="open"
                  size="small"
                  type="link"
                  icon={<PlayCircleOutlined />}
                  disabled={!record.path && record.source !== 'url'}
                  title={
                    !record.path && record.source !== 'url' ? strings.library.dropOnly : undefined
                  }
                  onClick={() => void launcher.reopen(record)}
                >
                  {strings.library.reopen}
                </Button>,
                <Popconfirm
                  key="del"
                  title={strings.library.remove}
                  onConfirm={() => void remove(record.hash)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ]}
            >
              <div style={{ overflow: 'hidden' }}>
                <Typography.Text ellipsis style={{ maxWidth: 200, fontSize: 12, display: 'block' }}>
                  {record.name}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {new Date(record.lastPlayed).toLocaleString()}
                </Typography.Text>
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  )
}
