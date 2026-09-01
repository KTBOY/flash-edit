import { List, Select, Space, Typography } from 'antd'
import { strings } from '@renderer/locales/zh'
import { MAX_SPEED, MIN_SPEED } from '@renderer/core/wasm/time-scaler'
import { memoryTracker, timeScaler } from '@renderer/core/runtime'
import { useGameStore } from '@renderer/store/useGameStore'
import { useScanStore } from '@renderer/store/useScanStore'
import { useTick } from '@renderer/hooks/useTick'
import HudCard from '@renderer/components/common/HudCard'
import HudSlider from '@renderer/components/common/HudSlider'
import AboutSection from '@renderer/components/settings/AboutSection'
import UnlockInput from '@renderer/components/settings/UnlockInput'

const SPEED_PRESETS = [0.5, 1, 2, 3, 5]

const TOLERANCE_OPTIONS = [
  { value: 1e-3, label: '1e-3（宽松，适合单精度小数）' },
  { value: 1e-6, label: '1e-6（默认）' },
  { value: 1e-9, label: '1e-9（严格）' }
]

/** 设置面板：变速读数 / 扫描参数 / 内存区块 / 关于 */
export default function SettingsPanel() {
  const speed = useGameStore((s) => s.speed)
  const setSpeed = useGameStore((s) => s.setSpeed)
  const tolerance = useScanStore((s) => s.options.tolerance)
  const setOption = useScanStore((s) => s.setOption)
  const tick = useTick(2000)

  const applySpeed = (value: number) => {
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, value))
    timeScaler.setSpeed(clamped)
    setSpeed(clamped)
  }

  return (
    <HudCard zh={strings.settings.tab} en={strings.latin.settings}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {/* 变速齿轮 */}
        <div className="card-head" style={{ marginTop: 8 }}>
          <span className="mk" />
          <span className="zh">{strings.settings.speedTitle}</span>
          <span className="ln" />
          <span className="en">{strings.latin.speed}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="readout">
            x{speed.toFixed(1)}
            <small>SPD</small>
          </div>
          <div style={{ flex: 1 }}>
            <HudSlider min={MIN_SPEED} max={MAX_SPEED} step={0.1} value={speed} onChange={applySpeed} />
            <div className="seg" style={{ marginTop: 6 }}>
              {SPEED_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={speed === preset ? 'active' : ''}
                  onClick={() => applySpeed(preset)}
                >
                  x{preset}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          {strings.settings.speedHint}
        </Typography.Paragraph>

        <div className="hud-divider" />

        {/* 扫描参数 */}
        <div className="card-head">
          <span className="mk" />
          <span className="zh">{strings.settings.scanTitle}</span>
          <span className="ln" />
          <span className="en">{strings.latin.scanParams}</span>
        </div>
        <Space size={8} align="center" wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {strings.settings.tolerance}
          </Typography.Text>
          <Select
            style={{ width: 260 }}
            value={tolerance}
            options={TOLERANCE_OPTIONS}
            onChange={(v) => setOption({ tolerance: v })}
          />
        </Space>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
          {strings.settings.toleranceHint}
        </Typography.Paragraph>

        <div className="hud-divider" />

        {/* 内存区块 */}
        <div className="card-head" data-tick={tick}>
          <span className="mk" />
          <span className="zh">{strings.settings.memoryTitle}</span>
          <span className="ln" />
          <span className="en">{strings.latin.memory}</span>
        </div>
        {memoryTracker.count === 0 ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            {strings.settings.memoryEmpty}
          </Typography.Paragraph>
        ) : (
          <List
            size="small"
            dataSource={[...memoryTracker.list()]}
            renderItem={(record) => (
              <List.Item style={{ padding: '4px 0', gap: 8 }}>
                <span className="diamond dim" style={{ width: 6, height: 6 }} />
                <Typography.Text style={{ fontSize: 12, color: 'var(--cream-dim)' }}>
                  {record.label}
                  <span
                    style={{
                      fontFamily: 'var(--latin)',
                      color: 'var(--gold)',
                      marginLeft: 8,
                      letterSpacing: 1
                    }}
                  >
                    {(record.memory.buffer.byteLength / 1024 / 1024).toFixed(1)} MB
                  </span>
                </Typography.Text>
              </List.Item>
            )}
          />
        )}

        <div className="hud-divider" />

        {/* 关于 */}
        <div className="card-head">
          <span className="mk" />
          <span className="zh">{strings.settings.aboutTitle}</span>
          <span className="ln" />
          <span className="en">{strings.latin.about}</span>
        </div>
        <AboutSection />
        <UnlockInput />
      </Space>
    </HudCard>
  )
}
