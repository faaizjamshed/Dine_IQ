import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * KPI count-up — animates numeric values on entrance/update without ever
 * touching business logic. Honors prefers-reduced-motion by snapping
 * straight to the final value.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced ? target : 0)
  const fromRef = useRef(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (reduced) {
      setDisplay(target)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (target - from) * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, durationMs, reduced])

  return display
}
