import type { CSSProperties, ChangeEvent } from 'react'

/**
 * 硬朗滑杆：原生 input[type=range] + 菱形滑块，金色填充进度由 --pct 驱动。
 * 轨道造型只通过背景分层实现（轨道上禁用 clip-path）。
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
  const pct = ((value - min) / (max - min)) * 100
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.target.value))
  }
  return (
    <input
      type="range"
      className="hud-slider"
      style={{ '--pct': `${pct}%`, width } as CSSProperties}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={handleChange}
    />
  )
}
