import { useEffect, useRef, useState } from 'react'
import type { SimplifiedMcdocType } from './mcdoc-edit'
import type { SpyglassService } from '../engine/spyglass-service'

export type McdocTypeState = 'idle' | 'resolving' | 'ready'

interface Options {
  /** Active file path, or null when no file is open. */
  path: string | null
  /** When false the editor shows raw JSON and we should not resolve a type. */
  formView: boolean
  /** Spyglass must be initialized before types can resolve. */
  spyglassReady: boolean
  /** Optional discriminator (e.g. recipe `type`) that changes the resolved struct. */
  discriminator?: string | null
  serviceRef: React.MutableRefObject<SpyglassService | null>
  content: string
}

/**
 * Resolves the simplified mcdoc root type for an open file via Spyglass.
 * Extracted from the original recipe-specific effect so loot/predicate/advancement
 * formats can reuse the same resolve-retry loop without duplicating it.
 */
export function useResolvedMcdocType(opts: Options): {
  type: SimplifiedMcdocType | null
  state: McdocTypeState
} {
  const { path, formView, spyglassReady, discriminator, serviceRef, content } = opts
  const [type, setType] = useState<SimplifiedMcdocType | null>(null)
  const [state, setState] = useState<McdocTypeState>('idle')

  // Keep the latest content in a ref so the resolve loop reads fresh text without
  // re-subscribing the effect on every keystroke (which would thrash the retry loop).
  const contentRef = useRef(content)
  contentRef.current = content

  useEffect(() => {
    if (!path || !formView || !spyglassReady) {
      setState('idle')
      setType(null)
      return
    }
    let cancelled = false
    setState('resolving')
    setType(null)
    const svc = serviceRef.current
    if (!svc) return
    ;(async () => {
      for (let attempt = 0; attempt < 6 && !cancelled; attempt++) {
        await svc.updateFile(path, contentRef.current)
        const t = await svc.getSimplifiedRootType(path)
        if (cancelled) return
        if (t !== null) {
          setType(t)
          setState('ready')
          return
        }
        await new Promise(r => setTimeout(r, 400))
      }
      setType(null)
      setState('ready')
    })()
    return () => { cancelled = true }
  }, [path, formView, spyglassReady, serviceRef])

  return { type, state }
}
