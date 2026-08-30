import type { ReactNode } from 'react'

/**
 * Resonance HUD 卡片：四角角标 + 中英双语区块标题。
 * zh 为主标题，en 为有含义的拉丁领域词（大字距大写）。
 */
export default function HudCard({
  zh,
  en,
  className,
  bodyClassName,
  children
}: {
  zh: string
  en: string
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={`hud-card ${className ?? ''}`}>
      <header className="card-head">
        <span className="mk" />
        <span className="zh">{zh}</span>
        <span className="ln" />
        <span className="en">{en}</span>
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}
