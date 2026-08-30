import { useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableProps
} from 'antd'
import { LockOutlined, UndoOutlined } from '@ant-design/icons'
import type { ScanOp, ScanResultRow, ValueType } from '@shared/types'
import { VALUE_TYPE_META } from '@shared/types'
import { strings } from '@renderer/locales/zh'
import { scanEngine } from '@renderer/core/runtime'
import { useScanStore, type TypeKey } from '@renderer/store/useScanStore'
import { useCheatStore } from '@renderer/store/useCheatStore'
import { useGameStore } from '@renderer/store/useGameStore'
import HudCard from '@renderer/components/common/HudCard'

const TYPE_OPTIONS = [
  { value: 'auto', label: strings.scan.autoType },
  ...(Object.keys(VALUE_TYPE_META) as ValueType[]).map((key) => ({
    value: key,
    label: VALUE_TYPE_META[key].label
  }))
]

const OP_LABELS: Record<ScanOp, string> = {
  exact: strings.scan.opExact,
  between: strings.scan.opBetween,
  unknown: strings.scan.opUnknown,
  increased: strings.scan.opIncreased,
  decreased: strings.scan.opDecreased,
  changed: strings.scan.opChanged,
  unchanged: strings.scan.opUnchanged
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(8)))
}

/** 单行操作：写入新值 / 加入修改列表并锁定 */
function ResultActions({ row }: { row: ScanResultRow }) {
  const { message } = AntdApp.useApp()
  const [text, setText] = useState(formatNumber(row.value))
  const bumpResults = useScanStore((s) => s.bumpResults)

  const write = () => {
    const value = Number(text)
    if (!Number.isFinite(value)) {
      message.error('请输入有效数值')
      return
    }
    if (scanEngine.writeCandidate(row.index, value)) {
      bumpResults()
    } else {
      message.error('写入失败：内存不可访问')
    }
  }

  const lock = () => {
    const cheat = useCheatStore.getState()
    const entry = cheat.addFromResult(row.index)
    if (!entry) {
      message.error('加入修改列表失败')
      return
    }
    cheat.toggleLock(entry.id)
    message.success(`已锁定 ${entry.desc} = ${formatNumber(row.value)}`)
  }

  return (
    <Space size={4}>
      <Input
        size="small"
        className="result-value-editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPressEnter={write}
      />
      <Button size="small" type="primary" onClick={write}>
        {strings.scan.write}
      </Button>
      <Tooltip title={strings.scan.lockPrompt}>
        <Button size="small" icon={<LockOutlined />} onClick={lock} />
      </Tooltip>
    </Space>
  )
}

const columns: TableProps<ScanResultRow>['columns'] = [
  { title: strings.scan.colIndex, dataIndex: 'index', width: 56, render: (v: number) => v + 1 },
  { title: strings.scan.colAddress, dataIndex: 'address', width: 150 },
  {
    title: strings.scan.colType,
    dataIndex: 'type',
    width: 70,
    render: (v: ValueType) => <Tag>{v}</Tag>
  },
  {
    title: strings.scan.colValue,
    dataIndex: 'value',
    width: 90,
    render: (v: number) => formatNumber(v)
  },
  {
    title: strings.scan.colActions,
    key: 'actions',
    render: (_, row) => <ResultActions row={row} />
  }
]

/** 轻量进度条 */
function ScanProgress({ percent }: { percent: number }) {
  return (
    <div>
      <div style={{ height: 6, borderRadius: 3, background: '#303030', overflow: 'hidden' }}>
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: '#1668dc',
            transition: 'width 0.1s'
          }}
        />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {strings.scan.scanning} {percent.toFixed(0)}%
      </Typography.Text>
    </div>
  )
}

/** 数值扫描面板：条件输入 → 扫描 → 结果收敛 → 写入/锁定 */
export default function ScanPanel() {
  const { message } = AntdApp.useApp()
  const options = useScanStore((s) => s.options)
  const scanning = useScanStore((s) => s.scanning)
  const summary = useScanStore((s) => s.summary)
  const hasSnapshot = useScanStore((s) => s.hasSnapshot)
  const hasResults = useScanStore((s) => s.hasResults)
  const limitReached = useScanStore((s) => s.limitReached)
  const error = useScanStore((s) => s.error)
  const resultsVersion = useScanStore((s) => s.resultsVersion)
  const page = useScanStore((s) => s.page)
  const pageSize = useScanStore((s) => s.pageSize)
  const { setOption, runScan, undoScan, resetScan, setPage } = useScanStore.getState()

  const game = useGameStore((s) => s.game)
  const [writeAllText, setWriteAllText] = useState('')

  const isFirst = !hasResults && !hasSnapshot
  const progress = useScanStore((s) => (s.scanning ? s.progress : 0))

  const rows = useMemo(
    () => scanEngine.getResults(page * pageSize, pageSize),
    // resultsVersion 是"引擎数据已变化"的信号，驱动 memo 重算（非取值依赖）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultsVersion, page, pageSize]
  )

  const writeAll = () => {
    const value = Number(writeAllText)
    if (!Number.isFinite(value)) {
      message.error('请输入有效数值')
      return
    }
    const written = scanEngine.writeAll(value)
    useScanStore.getState().bumpResults()
    message.success(`已写入 ${written} 个地址`)
  }

  return (
    <HudCard zh={strings.scan.tab} en={strings.latin.scan}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {isFirst
          ? strings.scan.hintFirstScan
          : hasSnapshot && !hasResults
            ? strings.scan.hintSnapshot
            : strings.scan.hintResults}
      </Typography.Text>

      <Space size={8} wrap>
        <Input
          style={{ width: 130 }}
          placeholder={strings.scan.valuePlaceholder}
          value={options.valueText}
          onChange={(e) => setOption({ valueText: e.target.value })}
          onPressEnter={() => void runScan()}
        />
        {options.op === 'between' && (
          <Input
            style={{ width: 110 }}
            placeholder={strings.scan.value2}
            value={options.value2Text}
            onChange={(e) => setOption({ value2Text: e.target.value })}
            onPressEnter={() => void runScan()}
          />
        )}
        <Select
          style={{ width: 150 }}
          value={options.typeKey}
          options={TYPE_OPTIONS}
          onChange={(v) => setOption({ typeKey: v as TypeKey })}
        />
        <Select
          style={{ width: 130 }}
          value={options.op}
          options={(Object.keys(OP_LABELS) as ScanOp[]).map((op) => ({ value: op, label: OP_LABELS[op] }))}
          onChange={(v) => setOption({ op: v as ScanOp })}
        />
        <Button type="primary" loading={scanning} disabled={!game} onClick={() => void runScan()}>
          {isFirst ? strings.scan.firstScan : strings.scan.nextScan}
        </Button>
        <Button icon={<UndoOutlined />} disabled={scanning || isFirst} onClick={undoScan}>
          {strings.scan.undo}
        </Button>
        <Button danger disabled={isFirst && !hasSnapshot} onClick={resetScan}>
          {strings.scan.reset}
        </Button>
      </Space>

      {!game && <Alert type="info" showIcon message={strings.scan.noGame} />}
      {error && <Alert type="error" showIcon message={error} />}
      {limitReached && <Alert type="warning" showIcon message={strings.scan.limitReached} />}

      {scanning && <ScanProgress percent={progress} />}

      {summary && !scanning && (
        <div className="scan-stats">
          <div className="readout">
            {summary.total}
            <small>{strings.scan.statsCandidates}</small>
          </div>
          <div className="side">
            <i>TIME</i>
            <b>{summary.durationMs} ms</b>
          </div>
          {summary.scannedBytes > 0 && (
            <div className="side">
              <i>SCANNED</i>
              <b>{(summary.scannedBytes / 1024 / 1024).toFixed(1)} MB</b>
            </div>
          )}
        </div>
      )}

      {hasResults && (
        <>
          <Space size={8}>
            <Input
              style={{ width: 130 }}
              value={writeAllText}
              placeholder={strings.scan.valuePlaceholder}
              onChange={(e) => setWriteAllText(e.target.value)}
            />
            <Popconfirm title={strings.scan.writeAllConfirm} onConfirm={writeAll}>
              <Button>{strings.scan.writeAll}</Button>
            </Popconfirm>
          </Space>
          <Table
            size="small"
            rowKey="index"
            columns={columns}
            dataSource={rows}
            pagination={{
              current: page + 1,
              pageSize,
              total: summary?.total ?? 0,
              showSizeChanger: false,
              onChange: (p) => setPage(p - 1)
            }}
            scroll={{ y: 300 }}
          />
        </>
      )}
      </Space>
    </HudCard>
  )
}
