import { Layout, Space } from 'antd'
import { strings } from '@renderer/locales/zh'
import { memoryTracker } from '@renderer/core/runtime'
import { useGameStore } from '@renderer/store/useGameStore'
import { useScanStore } from '@renderer/store/useScanStore'
import { useCheatStore } from '@renderer/store/useCheatStore'
import { useTick } from '@renderer/hooks/useTick'
import { useModeStore } from '@renderer/store/useModeStore'

const { Footer } = Layout

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function DotRow({ mirror }: { mirror?: boolean }) {
  return (
    <span className={`dots ${mirror ? 'mirror' : ''}`}>
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

/** 底部状态栏：点阵括号 + 运行指标 + 版本 */
export default function StatusBar() {
  const tick = useTick(1500)
  const speed = useGameStore((s) => s.speed)
  const appInfo = useGameStore((s) => s.appInfo)
  const summary = useScanStore((s) => s.summary)
  const entries = useCheatStore((s) => s.entries)
  const lockedCount = entries.filter((e) => e.locked).length
  // 打包模式不暴露专家级指标（面板本身也是隐藏的）
  const fullMode = useModeStore((s) => s.fullMode)

  return (
    <Footer className="hud-footer" data-tick={tick}>
      <Space size={10}>
        <DotRow />
        <div className="stats">
          <span>
            {strings.status.memories}
            <b>{memoryTracker.count}</b>· {formatBytes(memoryTracker.totalBytes)}
          </span>
          {fullMode && (
            <>
              <span>
                {strings.status.candidates}
                <b>{summary?.total ?? 0}</b>
              </span>
              <span>
                {strings.status.cheats}
                <b>
                  {entries.length}/{lockedCount}
                </b>
              </span>
            </>
          )}
          <span>
            {strings.status.speed}
            <b>x{speed.toFixed(1)}</b>
          </span>
        </div>
      </Space>
      <div className="foot-tag">
        {strings.app.disclaimer}
        {appInfo ? ` · V${appInfo.version}` : ''}
        <DotRow mirror />
      </div>
    </Footer>
  )
}
