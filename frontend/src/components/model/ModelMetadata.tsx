import { ArrowRight, Cpu } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/formatters'
import type { ModelInfo } from '@/api/types'

/**
 * ModelMetadata — mandatory transparency footer for every model-driven panel
 * (spec §06/§41). Displays model name, version, generation timestamp and
 * pipeline exactly as supplied by the API — never fabricated client-side.
 */
export function ModelMetadata({
  model,
  className,
  dense = false,
}: {
  model?: ModelInfo
  className?: string
  dense?: boolean
}) {
  if (!model) return null

  return (
    <div
      className={
        'flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-subtle ' +
        (className ?? '')
      }
    >
      <span className="inline-flex items-center gap-1">
        <Cpu className="h-3 w-3" aria-hidden />
        <span className="font-semibold text-muted">{model.name}</span>
        <span>v{model.version}</span>
      </span>
      <span aria-hidden>·</span>
      <span>Generated {formatDateTime(model.generatedAt)}</span>
      <span aria-hidden>·</span>
      <Badge variant={model.pipeline === 'spark' ? 'high' : 'positive'} className="normal-case">
        {model.pipeline === 'spark' ? 'Spark' : 'Python'}
      </Badge>
      {!dense && typeof model.confidence === 'number' && (
        <>
          <span aria-hidden>·</span>
          <span>Confidence {(model.confidence * 100).toFixed(1)}%</span>
        </>
      )}
    </div>
  )
}
