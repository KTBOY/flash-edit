import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Empty, Input, Modal, Spin, Typography } from 'antd'
import {
  CopyOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { SkillItem } from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { copyText } from '@renderer/services/clipboard.service'
import { useSkillStore } from '@renderer/store/useSkillStore'
import HudCard from '@renderer/components/common/HudCard'

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

/**
 * 当前项目的 Skill 面板。
 *
 * 列出仓库自己的 SKILL.md，方便改游戏时确认「这套流程到底有没有被读到」，
 * 并一键复制 skill 目录路径贴给 AI 会话。同名条目只标警告，谁生效不由本应用裁决。
 */
export default function SkillPanel() {
  const { message } = AntdApp.useApp()
  const items = useSkillStore((s) => s.items)
  const loading = useSkillStore((s) => s.loading)
  const loaded = useSkillStore((s) => s.loaded)
  const failed = useSkillStore((s) => s.failed)
  const refresh = useSkillStore((s) => s.refresh)

  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<SkillItem | null>(null)
  const [detailBody, setDetailBody] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailTruncated, setDetailTruncated] = useState(false)

  useEffect(() => {
    if (!loaded && !loading) void refresh()
  }, [loaded, loading, refresh])

  const keyword = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      keyword
        ? items.filter(
            (item) =>
              item.name.toLowerCase().includes(keyword) ||
              item.description.toLowerCase().includes(keyword)
          )
        : items,
    [items, keyword]
  )

  const copyPath = async (item: SkillItem): Promise<void> => {
    const ok = await copyText(item.dir)
    if (ok) message.success(`${item.name} · ${strings.skill.copyPathDone}`)
    else message.warning(strings.skill.copyFailed)
  }

  const openDetail = async (item: SkillItem): Promise<void> => {
    setDetail(item)
    setDetailBody(null)
    setDetailTruncated(false)
    setDetailLoading(true)
    try {
      const result = await getApi().readSkillMarkdown(item.path)
      setDetailBody(result?.body ?? null)
      setDetailTruncated(result?.truncated ?? false)
    } catch {
      setDetailBody(null)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <HudCard zh={strings.skill.title} en={strings.latin.tabSkill}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 10px' }}>
        {strings.skill.hint}
      </Typography.Paragraph>

      <div className="skill-toolbar">
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          placeholder={strings.skill.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          loading={loading}
          title={strings.skill.refresh}
          onClick={() => void refresh()}
        />
      </div>

      {failed && items.length === 0 ? (
        <Empty description={strings.skill.scanFailed} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : items.length === 0 ? (
        <Empty
          description={loading ? strings.skill.refreshing : strings.skill.empty}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : filtered.length === 0 ? (
        <Empty description={strings.skill.noMatch} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="skill-list scroll-panel">
          {filtered.map((item) => (
            <div className="skill-item" key={item.path}>
              <div className="skill-top">
                <Button
                  className="skill-name"
                  type="link"
                  size="small"
                  icon={<FileTextOutlined />}
                  title={strings.skill.detail}
                  onClick={() => void openDetail(item)}
                >
                  <span className="tt">{item.name}</span>
                </Button>
                {item.duplicated && (
                  <span className="skill-warn" title={strings.skill.duplicate}>
                    <ExclamationCircleOutlined />
                  </span>
                )}
              </div>
              {item.description && (
                <Typography.Text className="skill-desc">{item.description}</Typography.Text>
              )}
              <div className="skill-meta">
                <span className="skill-meta-info" title={item.dir}>
                  {item.dir} · {formatSize(item.sizeBytes)} · {formatDate(item.updatedAt)}
                </span>
                <span className="skill-actions">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    title={strings.skill.copyPath}
                    onClick={() => void copyPath(item)}
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<FolderOpenOutlined />}
                    title={strings.skill.reveal}
                    onClick={() => getApi().showFileInFolder(item.path)}
                  />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        className="skill-detail"
        title={detail ? `${strings.skill.detailTitle} · ${detail.name}` : strings.skill.detailTitle}
        open={detail !== null}
        onCancel={() => setDetail(null)}
        width={680}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={() => detail && void copyPath(detail)}>
            {strings.skill.copyPath}
          </Button>,
          <Button key="close" type="primary" onClick={() => setDetail(null)}>
            {strings.skill.close}
          </Button>
        ]}
      >
        {detail && (
          <>
            <div className="skill-path-row">
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {strings.skill.pathLabel}
              </Typography.Text>
              <Input readOnly size="small" value={detail.dir} onFocus={(e) => e.target.select()} />
            </div>
            {detail.duplicated && (
              <Typography.Paragraph type="warning" style={{ fontSize: 12, marginBottom: 8 }}>
                {strings.skill.duplicate}
              </Typography.Paragraph>
            )}
            <Spin spinning={detailLoading}>
              {detailBody === null && !detailLoading ? (
                <Empty
                  description={strings.skill.readFailed}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <pre className="skill-body scroll-panel">
                  {detailBody ?? strings.skill.emptyBody}
                </pre>
              )}
            </Spin>
            {detailTruncated && (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {strings.skill.truncated}
              </Typography.Text>
            )}
          </>
        )}
      </Modal>
    </HudCard>
  )
}
