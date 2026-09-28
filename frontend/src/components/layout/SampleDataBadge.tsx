import { FlaskConical } from 'lucide-react'
import { USE_MOCKS } from '@/api/client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * SampleDataBadge — persistent, visible indicator whenever mock mode is
 * active (spec §03, HARD RULE 3). Placed in the top bar and the login brand
 * panel; sample-data mode is never hidden from the user.
 */
export function SampleDataBadge() {
  if (!USE_MOCKS) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="sample-data-badge"
          className="inline-flex cursor-help items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-primary"
        >
          <FlaskConical className="h-3 w-3" aria-hidden />
          Sample Data
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        Mock mode is active: every value is served from the sample dataset through the same typed
        API contract as the production backend.
      </TooltipContent>
    </Tooltip>
  )
}
