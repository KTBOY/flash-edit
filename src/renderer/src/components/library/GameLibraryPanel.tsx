import { useEffect, useRef, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Checkbox,
  Empty,
  Input,
  List,
  Modal,
  Pagination,
  Typography,
  type InputRef
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { GameRecord } from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { useGameStore } from '@renderer/store/useGameStore'
import { useAppServices } from '@renderer/services/app-services'

/**
 * 每页条数。
 * 按默认窗口高度（940）实测：侧栏列表区要同时容纳工具条、搜索框、列表与分页条，
 * 单行 48px；13 行会把分页条挤出面板底边，12 行可完整显示且不留空。
 * 改窗口高度后如需重调，只改这里。
 */
const PAGE_SIZE = 12

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  )
}

/**
 * 游戏库（最近游玩）。
 * 支持按名称搜索与分页；单选 / 全选后可批量删除——删除会连同磁盘上的游戏文件
 * 一起移除，但文件仅限下载目录内（目录外的原始文件只移除记录），删除前弹框确认。
 */
export default function GameLibraryPanel({ embedded = true }: { embedded?: boolean }) {
  const { launcher } = useAppServices()
  const { message, modal } = AntdApp.useApp()
  const recent = useGameStore((s) => s.recent)
  const refreshRecent = useGameStore((s) => s.refreshRecent)
  const [selected, setSelected] = useState<string[]>([])
  const [downloadDir, setDownloadDir] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [renaming, setRenaming] = useState<GameRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const renameInputRef = useRef<InputRef>(null)

  useEffect(() => {
    void getApi()
      .getSettings()
      .then((s) => setDownloadDir(s.downloadDir))
      .catch(() => undefined)
  }, [])

  // 弹窗打开后聚焦并全选，方便直接输入覆盖旧名
  useEffect(() => {
    if (!renaming) return
    const timer = window.setTimeout(() => renameInputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [renaming])

  const keyword = query.trim().toLowerCase()
  const filtered = keyword
    ? recent.filter((record) => record.name.toLowerCase().includes(keyword))
    : recent

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // 删除后总页数可能变少，就地收敛页码，避免出现空页
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const allHashes = filtered.map((record) => record.hash)
  const knownHashes = new Set(recent.map((record) => record.hash))
  const selectedHashes = selected.filter((hash) => knownHashes.has(hash))
  const selectedSet = new Set(selectedHashes)
  const allSelected = allHashes.length > 0 && allHashes.every((hash) => selectedSet.has(hash))

  const toggle = (hash: string): void => {
    setSelected((prev) =>
      prev.includes(hash) ? prev.filter((item) => item !== hash) : [...prev, hash]
    )
  }

  const openRename = (record: GameRecord): void => {
    setRenaming(record)
    setRenameValue(record.name)
  }

  const submitRename = async (): Promise<void> => {
    const target = renaming
    if (!target) return
    const name = renameValue.trim()
    if (!name) return
    setRenameSaving(true)
    try {
      const ok = await getApi().renameGame(target.hash, name)
      if (!ok) {
        message.error(strings.library.renameFailed)
        return
      }
      // 正在游玩的同一游戏：同步头部显示名
      const current = useGameStore.getState().game
      if (current && current.hash === target.hash) {
        useGameStore.setState({ game: { ...current, name } })
      }
      await refreshRecent()
      message.success(strings.library.renameDone)
      setRenaming(null)
    } catch {
      message.error(strings.library.renameFailed)
    } finally {
      setRenameSaving(false)
    }
  }

  const confirmDelete = (targets: string[]): void => {
    if (targets.length === 0) return
    modal.confirm({
      title: strings.library.confirmTitle,
      content: (
        <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
          {fill(strings.library.confirmBody, { n: targets.length, dir: downloadDir || '…' })}
        </div>
      ),
      okText: strings.library.confirmOk,
      okButtonProps: { danger: true },
      cancelText: strings.library.confirmCancel,
      onOk: async () => {
        try {
          const result = await getApi().removeGames(targets, true)
          await refreshRecent()
          setSelected((prev) => prev.filter((hash) => !targets.includes(hash)))
          const parts = [fill(strings.library.doneRecords, { n: targets.length })]
          if (result.deletedFiles.length > 0) {
            parts.push(fill(strings.library.doneFiles, { n: result.deletedFiles.length }))
          }
          if (result.keptFiles.length > 0) {
            parts.push(fill(strings.library.noteKept, { n: result.keptFiles.length }))
          }
          if (result.failedFiles.length > 0) {
            parts.push(fill(strings.library.noteFailed, { n: result.failedFiles.length }))
            message.warning(parts.join(''))
            return
          }
          message.success(parts.join(''))
        } catch {
          message.error(strings.library.removeFailed)
        }
      }
    })
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
      <div className="lib-toolbar">
        <Typography.Text strong>{strings.library.title}</Typography.Text>
        {recent.length > 0 && (
          <div className="lib-toolbar-actions">
            <Checkbox
              checked={allSelected}
              indeterminate={selectedHashes.length > 0 && !allSelected}
              onChange={(e) => setSelected(e.target.checked ? allHashes : [])}
            >
              <span style={{ fontSize: 12 }}>{strings.library.selectAll}</span>
            </Checkbox>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              disabled={selectedHashes.length === 0}
              onClick={() => confirmDelete(selectedHashes)}
            >
              {strings.library.deleteSelected}
              {selectedHashes.length > 0 ? ` (${selectedHashes.length})` : ''}
            </Button>
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div style={{ padding: '0 8px 8px' }}>
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder={strings.library.searchPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
          />
        </div>
      )}

      {recent.length === 0 ? (
        <Empty description={strings.library.empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : filtered.length === 0 ? (
        <Empty description={strings.library.noMatch} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <List
            size="small"
            dataSource={pageRows}
            renderItem={(record: GameRecord) => (
              <List.Item
                style={{ padding: '6px 8px' }}
                actions={[
                  <Button
                    key="open"
                    size="small"
                    type="link"
                    icon={<PlayCircleOutlined />}
                    disabled={record.missing === true || (!record.path && record.source !== 'url')}
                    title={
                      record.missing
                        ? strings.library.fileMissing
                        : !record.path && record.source !== 'url'
                          ? strings.library.dropOnly
                          : undefined
                    }
                    onClick={() => void launcher.reopen(record)}
                  >
                    {strings.library.reopen}
                  </Button>,
                  <Button
                    key="rename"
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    title={strings.library.rename}
                    onClick={() => openRename(record)}
                  />,
                  <Button
                    key="del"
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    title={strings.library.remove}
                    onClick={() => confirmDelete([record.hash])}
                  />
                ]}
              >
                <Checkbox
                  checked={selectedHashes.includes(record.hash)}
                  onChange={() => toggle(record.hash)}
                />
                <div style={{ overflow: 'hidden', marginLeft: 8 }}>
                  <Typography.Text
                    ellipsis
                    style={{ maxWidth: 200, fontSize: 12, display: 'block' }}
                  >
                    {record.name}
                  </Typography.Text>
                  {record.missing && (
                    <Typography.Text type="danger" style={{ fontSize: 11, display: 'block' }}>
                      {strings.library.fileMissing}
                    </Typography.Text>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {new Date(record.lastPlayed).toLocaleString()}
                  </Typography.Text>
                </div>
              </List.Item>
            )}
          />
          {filtered.length > PAGE_SIZE && (
            <div className="lib-pager">
              <Pagination
                size="small"
                current={safePage}
                pageSize={PAGE_SIZE}
                total={filtered.length}
                showSizeChanger={false}
                onChange={setPage}
              />
            </div>
          )}
        </>
      )}

      <Modal
        title={strings.library.renameTitle}
        open={renaming !== null}
        onCancel={() => setRenaming(null)}
        width={380}
        okText={strings.library.renameOk}
        cancelText={strings.library.confirmCancel}
        okButtonProps={{ disabled: renameValue.trim().length === 0 }}
        confirmLoading={renameSaving}
        onOk={() => void submitRename()}
      >
        <Input
          ref={renameInputRef}
          value={renameValue}
          maxLength={100}
          placeholder={strings.library.renamePlaceholder}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={() => {
            if (renameValue.trim().length > 0 && !renameSaving) void submitRename()
          }}
        />
      </Modal>
    </div>
  )
}
