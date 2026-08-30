import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Checkbox, InputNumber, Modal, Space, Table, Tag, Typography, type TableProps } from 'antd'
import type { SwfPatchSpec, SwfPatchReportItem } from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { getLoadedSwfSource } from '@renderer/services/game-launcher'
import { useCheatStore } from '@renderer/store/useCheatStore'
import { useGameStore } from '@renderer/store/useGameStore'

interface RowState {
  id: string
  desc: string
  kind: 'f64' | 'f32' | 'i32'
  original: number | null
  value: number
  checked: boolean
  sites?: number
  skipped?: number
}

/** 值类型 → 补丁匹配形态：整数家族统一走 ABC 整数池 */
function toPatchKind(type: string): 'f64' | 'f32' | 'i32' {
  if (type === 'f32') return 'f32'
  if (type === 'f64') return 'f64'
  return 'i32'
}

/**
 * 「写入 SWF」弹窗：把运行时修改固化为离线常量补丁。
 * 流程：勾选条目 →（可编辑原值）→ 分析命中 → 另存为新 SWF。
 */
export default function SaveToSwfModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntdApp.useApp()
  const entries = useCheatStore((s) => s.entries)
  const game = useGameStore((s) => s.game)
  const [rows, setRows] = useState<RowState[]>([])
  const [busy, setBusy] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)

  const source = useMemo(() => (open ? getLoadedSwfSource() : null), [open])

  useEffect(() => {
    if (!open) return
    setAnalyzed(false)
    setRows(
      entries.map((entry) => ({
        id: entry.id,
        desc: entry.desc,
        kind: toPatchKind(entry.type),
        original: entry.originalValue ?? entry.value,
        value: entry.value,
        checked: !entry.stale
      }))
    )
  }, [open, entries])

  const patchRows = rows.filter((row) => row.checked && row.original !== null && row.original !== row.value)

  const buildSpecs = (): SwfPatchSpec[] | null => {
    if (rows.filter((r) => r.checked).length === 0) {
      message.warning(strings.cheat.swfNothingChecked)
      return null
    }
    if (patchRows.length !== rows.filter((r) => r.checked).length) {
      message.warning(strings.cheat.swfNeedOriginal)
      return null
    }
    return patchRows.map((row) => ({
      id: row.id,
      desc: row.desc,
      kind: row.kind,
      original: row.original as number,
      value: row.value
    }))
  }

  const applyReport = (report: SwfPatchReportItem[]) => {
    setRows((prev) =>
      prev.map((row) => {
        const item = report.find((r) => r.id === row.id)
        return item ? { ...row, sites: item.sites, skipped: item.skipped } : row
      })
    )
  }

  const analyze = async () => {
    const sourceBytes = getLoadedSwfSource()
    const specs = buildSpecs()
    if (!sourceBytes || !specs) return
    setBusy(true)
    try {
      const report = await getApi().analyzeSwfPatch(sourceBytes.bytes, specs)
      applyReport(report)
      setAnalyzed(true)
      message.success(strings.cheat.swfAnalyzed)
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const saveAs = async () => {
    const sourceBytes = getLoadedSwfSource()
    const specs = buildSpecs()
    if (!sourceBytes || !specs) return
    setBusy(true)
    try {
      const defaultName = (game?.name ?? 'game').replace(/\.swf$/i, '') + '_modified.swf'
      const result = await getApi().savePatchedSwf(sourceBytes.bytes, specs, defaultName)
      if (result.canceled) {
        message.info(strings.cheat.swfCanceled)
        return
      }
      applyReport(result.report)
      message.success(`${strings.cheat.swfSaved}${result.path}`)
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const columns: TableProps<RowState>['columns'] = [
    {
      title: '',
      key: 'check',
      width: 40,
      render: (_, row: RowState) => (
        <Checkbox
          checked={row.checked}
          onChange={(e) =>
            setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, checked: e.target.checked } : r)))
          }
        />
      )
    },
    { title: strings.cheat.colDesc, dataIndex: 'desc', ellipsis: true },
    {
      title: strings.cheat.swfColOriginal,
      key: 'original',
      width: 120,
      render: (_, row: RowState) => (
        <InputNumber
          size="small"
          style={{ width: 110 }}
          value={row.original}
          onChange={(v) =>
            setRows((prev) =>
              prev.map((r) => (r.id === row.id ? { ...r, original: v === null ? null : Number(v) } : r))
            )
          }
        />
      )
    },
    {
      title: strings.cheat.swfColValue,
      dataIndex: 'value',
      width: 80,
      render: (v: number) => <Typography.Text strong>{v}</Typography.Text>
    },
    {
      title: strings.cheat.colType,
      dataIndex: 'kind',
      width: 64,
      render: (v: string) => <Tag>{v}</Tag>
    },
    {
      title: strings.cheat.swfColSites,
      key: 'sites',
      width: 80,
      render: (_, row: RowState) =>
        row.sites === undefined ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text type={row.sites === 0 ? 'warning' : undefined}>
            {row.sites}
            {(row.skipped ?? 0) > 0 ? ` (+${row.skipped}跳过)` : ''}
          </Typography.Text>
        )
    }
  ]

  return (
    <Modal
      title={strings.cheat.swfModalTitle}
      open={open}
      onCancel={onClose}
      width={640}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button disabled={!source || rows.length === 0} loading={busy} onClick={() => void analyze()}>
            {strings.cheat.swfAnalyze}
          </Button>
          <Button type="primary" disabled={!source || rows.length === 0} loading={busy} onClick={() => void saveAs()}>
            {strings.cheat.swfSaveAs}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {strings.cheat.swfModalHint}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {strings.cheat.swfSourceNote}
        </Typography.Paragraph>
        {!source && <Typography.Paragraph type="warning">{strings.cheat.swfNoBytes}</Typography.Paragraph>}
        {analyzed && patchRows.every((r) => (r.sites ?? 0) === 0) && (
          <Typography.Paragraph type="warning">{strings.cheat.swfZeroSites}</Typography.Paragraph>
        )}
        <Table
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ y: 280 }}
          locale={{ emptyText: strings.cheat.empty }}
        />
      </Space>
    </Modal>
  )
}
