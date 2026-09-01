import { useRef } from 'react'
import { App as AntdApp, Typography } from 'antd'
import { strings } from '@renderer/locales/zh'
import { useModeStore } from '@renderer/store/useModeStore'

/**
 * 密令解锁入口（打包模式 → 完整模式）。
 *
 * 用非受控 input + ref：设置面板有 useTick 定时重渲染，非受控可彻底排除
 * 输入过程中丢焦点/丢值的可能。解锁成功后就地替换为一行说明文字。
 */
export default function UnlockInput() {
  const { message } = AntdApp.useApp()
  const fullMode = useModeStore((s) => s.fullMode)
  const unlock = useModeStore((s) => s.unlock)
  const inputRef = useRef<HTMLInputElement | null>(null)

  if (fullMode) {
    return (
      <Typography.Paragraph type="secondary" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
        {strings.unlock.unlocked}
      </Typography.Paragraph>
    )
  }

  const submit = (): void => {
    const value = inputRef.current?.value ?? ''
    if (!value.trim()) return
    if (unlock(value)) {
      message.success(strings.unlock.success)
      return
    }
    message.warning(strings.unlock.failed)
    if (inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.focus()
    }
  }

  return (
    <input
      ref={inputRef}
      className="unlock-input"
      type="text"
      autoComplete="off"
      spellCheck={false}
      placeholder={strings.unlock.placeholder}
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit()
        else if (event.key === 'Escape') event.currentTarget.blur()
      }}
    />
  )
}
