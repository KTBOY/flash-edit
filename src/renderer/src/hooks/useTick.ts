import { useEffect, useState } from 'react'

/** 以固定间隔递增的时钟信号，用于驱动非响应式数据（WASM 内存列表等）刷新 */
export function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return tick
}
