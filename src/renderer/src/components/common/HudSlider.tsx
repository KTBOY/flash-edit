import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'

/**
 * 硬朗滑杆：原生 input[type=range] + 菱形滑块，金色填充进度由 --pct 驱动。
 * 轨道造型只通过背景分层实现（轨道上禁用 clip-path）。
 *
 * 对外回调按帧合并：拖动时 input 每产生一个中间值都会触发 onChange，
 * 若直接透传会让整条组件树每帧重渲染（进而牵连 antd Tabs 重新测量几何）。
 * 这里用内部 state 承接即时值保证跟手，再用 rAF 把对外通知压到每帧最多一次。
 */
export default function HudSlider({
  min,
  max,
  step,
  value,
  onChange,
  width
}: {
  min: number
  max: number
  step: number
  value: number
  onChange(value: number): void
  width?: number | string
}) {
  const [local, setLocal] = useState(value)
  const pending = useRef<number | null>(null)
  const frame = useRef(0)
  const emit = useRef(onChange)
  emit.current = onChange

  // 外部值变化（预设按钮 / store 恢复）时同步回滑块
  useEffect(() => {
    setLocal((current) => (current === value ? current : value))
  }, [value])

  // 卸载时取消未执行的帧，避免在已卸载组件上触发回调
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const flush = (): void => {
    frame.current = 0
    const next = pending.current
    pending.current = null
    if (next !== null) emit.current(next)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = Number(event.target.value)
    setLocal(next)
    pending.current = next
    if (!frame.current) frame.current = requestAnimationFrame(flush)
  }

  const pct = ((local - min) / (max - min)) * 100
  return (
    <input
      type="range"
      className="hud-slider"
      style={{ '--pct': `${pct}%`, width } as CSSProperties}
      min={min}
      max={max}
      step={step}
      value={local}
      onChange={handleChange}
    />
  )
}
