import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from '@/api/endpoints'
import { Tooltip,TooltipContent,TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
export function ApiStatus(){
 const health=useQuery({queryKey:['health'],queryFn:fetchHealth,refetchInterval:30000,retry:false})
 const ok=health.data?.status==='ok'&&!health.error
 const label=health.isPending?'Checking API':ok?'API connected':'API unavailable'
 return <Tooltip><TooltipTrigger asChild><span className="inline-flex cursor-default items-center gap-1.5 rounded-md border border-border bg-surface-strong px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted"><span aria-hidden className={cn('inline-block h-1.5 w-1.5 rounded-full',ok?'bg-positive':'bg-critical')}/><span className="hidden sm:inline">{label}</span><span className="sr-only">{label}</span></span></TooltipTrigger><TooltipContent>{ok?'Existing DineIQ analytics and model are ready.':'Start the existing DineIQ backend and check its health.'}</TooltipContent></Tooltip>
}
