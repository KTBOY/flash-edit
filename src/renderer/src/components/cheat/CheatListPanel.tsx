import { useState } from 'react'
import { Button, Empty, Input, InputNumber, Space, Switch, Table, Tag, Tooltip, type TableProps } from 'antd'
import { DeleteOutlined, SaveOutlined, UnlockOutlined } from '@ant-design/icons'
import type { CheatEntry } from '@shared/types'
import { VALUE_TYPE_META } from '@shared/types'
import { formatAddress } from '@renderer/core/scan/engine'
import { strings } from '@renderer/locales/zh'
import { useCheatStore } from '@renderer/store/useCheatStore'
import { getLoadedSwfSource } from '@renderer/services/game-launcher'
import HudCard from '@renderer/components/common/HudCard'
import SaveToSwfModal from './SaveToSwfModal'

/** 数值编辑：整数类型限制步长为 1 */
function ValueEditor({ entry }: { entry: CheatEntry }) {
  const updateValue = useCheatStore((s) => s.updateValue)
  const integer = VALUE_TYPE_META[entry.type].integer
  return (
    <InputNumber
      size="small"
      style={{ width: 110 }}
      value={entry.value}
      precision={integer ? 0 : undefined}
      step={integer ? 1 : 0.1}
      onChange={(v) => {
        if (v !== null && Number.isFinite(v)) updateValue(entry.id, v)
      }}
    />
  )
}

const columns: TableProps<CheatEntry>['columns'] = [
  {
    title: strings.cheat.colDesc,
    dataIndex: 'desc',
    render: (_, entry) => <DescEditor entry={entry} />
  },
  {
    title: strings.cheat.colAddress,
    key: 'address',
    width: 140,
    render: (_, entry) => formatAddress(entry.memId, entry.offset)
  },
  {
    title: strings.cheat.colType,
    dataIndex: 'type',
    width: 64,
    render: (type: CheatEntry['type']) => <Tag>{type}</Tag>
  },
  {
    title: strings.cheat.colValue,
    key: 'value',
    width: 120,
    render: (_, entry) => <ValueEditor entry={entry} />
  },
  {
    title: strings.cheat.colLock,
    key: 'lock',
    width: 64,
    render: (_, entry) => (
      <Switch size="small" checked={entry.locked} onChange={() => useCheatStore.getState().toggleLock(entry.id)} />
    )
  },
  {
    title: strings.cheat.colActions,
    key: 'actions',
    width: 56,
    render: (_, entry) => (
      <Tooltip title={strings.cheat.remove}>
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => useCheatStore.getState().remove(entry.id)}
        />
      </Tooltip>
    )
  }
]

function DescEditor({ entry }: { entry: CheatEntry }) {
  const updateDesc = useCheatStore((s) => s.updateDesc)
  return (
    <Space size={4}>
      {entry.stale && <Tag color="warning">{strings.cheat.staleTag}</Tag>}
      <Input
        size="small"
        variant="borderless"
        value={entry.desc}
        onChange={(e) => updateDesc(entry.id, e.target.value)}
      />
    </Space>
  )
}

/** 修改列表：扫描结果的锁定与数值管理 + 写入 SWF 离线补丁 */
export default function CheatListPanel() {
  const entries = useCheatStore((s) => s.entries)
  const [swfModalOpen, setSwfModalOpen] = useState(false)
  const swfAvailable = getLoadedSwfSource() !== null

  const unlockAll = () => {
    entries.forEach((entry) => {
      if (entry.locked) useCheatStore.getState().toggleLock(entry.id)
    })
  }

  return (
    <HudCard zh={strings.cheat.tab} en={strings.latin.cheat}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space size={8}>
          <Button
            size="small"
            icon={<UnlockOutlined />}
            disabled={!entries.some((e) => e.locked)}
            onClick={unlockAll}
          >
            {strings.cheat.unlockAll}
          </Button>
          <Button size="small" danger disabled={entries.length === 0} onClick={() => useCheatStore.getState().clear()}>
            {strings.cheat.clear}
          </Button>
          <Tooltip title={swfAvailable ? strings.cheat.swfSourceNote : strings.cheat.swfNoBytes}>
            <Button
              size="small"
              icon={<SaveOutlined />}
              disabled={!swfAvailable || entries.length === 0}
              onClick={() => setSwfModalOpen(true)}
            >
              {strings.cheat.writeSwf}
            </Button>
          </Tooltip>
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>提示：锁定 = 持续写回该数值</span>
        </Space>

        {entries.length === 0 ? (
          <Empty description={strings.cheat.empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={entries}
            pagination={false}
            scroll={{ y: 420 }}
          />
        )}

        <SaveToSwfModal open={swfModalOpen} onClose={() => setSwfModalOpen(false)} />
      </Space>
    </HudCard>
  )
}
