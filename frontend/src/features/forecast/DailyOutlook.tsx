import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import { ChartCard } from '@/components/charts'
import { ApiErrorState } from '@/components/errors/states'
import { formatDecimal } from '@/lib/formatters'

interface Outlook {
  version:string; target:string; note:string; level:string; entity:string; entities:string[];
  horizon:number; training_end:string; model:string;
  backtest:{rows:number;model:{mae:number;rmse:number};seasonal_naive:{mae:number;rmse:number}};
  history:{day:string;actual:number}[];
  forecasts:{day:string;prediction:number;baseline:number}[];
}

export function DailyOutlook() {
  const [level,setLevel]=useState('item')
  const [entity,setEntity]=useState('')
  const [horizon,setHorizon]=useState('7')
  const query=useQuery({queryKey:['daily-outlook',level,entity,horizon],
    queryFn:()=>apiGet<Outlook>(`/api/ml/daily-forecast?${new URLSearchParams({level,entity,horizon})}`)})
  const data=query.data
  const selectStyle='h-9 rounded border border-border bg-surface-strong px-2 text-foreground'
  return <ChartCard title="Daily item, category and location outlook" subtitle="Frozen-data forecast · 7, 14 or 28 days · completed-order units">
    <p className="mb-3 text-xs text-muted">This panel uses its own level, entity and horizon controls. Global dashboard filters do not apply.</p>
    <div className="mb-3 flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-xs">Level<select aria-label="Daily forecast level" className={selectStyle} value={level} onChange={e=>{setLevel(e.target.value);setEntity('')}}><option value="item">Item</option><option value="category">Category</option><option value="location">Location</option></select></label>
      <label className="flex flex-col gap-1 text-xs">Entity<select aria-label="Daily forecast entity" className={selectStyle} value={entity||data?.entity||''} onChange={e=>setEntity(e.target.value)}>{data?.entities.map(e=><option key={e}>{e}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs">Horizon<select aria-label="Daily forecast horizon" className={selectStyle} value={horizon} onChange={e=>setHorizon(e.target.value)}>{[7,14,28].map(d=><option key={d} value={d}>{d} days</option>)}</select></label>
    </div>
    {query.isLoading&&<p role="status">Loading verified outlook…</p>}
    {query.error&&<ApiErrorState error={query.error} retry={()=>void query.refetch()} />}
    {data&&<>
      <p className="mb-2 text-xs text-muted">{data.note}</p>
      <p className="mb-3 text-sm">{data.model} / {data.version} · history ends {data.training_end}. Rolling-origin MAE across this level: {formatDecimal(data.backtest.model.mae,2)} vs seasonal baseline {formatDecimal(data.backtest.seasonal_naive.mae,2)} units ({data.backtest.rows.toLocaleString()} evaluated rows).</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div><h3 className="mb-2 text-sm font-semibold">Recent observed demand</h3><div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Date</th><th>Actual units</th></tr></thead><tbody>{data.history.map(r=><tr key={r.day}><td className="py-1">{r.day}</td><td>{formatDecimal(r.actual,0)}</td></tr>)}</tbody></table></div></div>
        <div><h3 className="mb-2 text-sm font-semibold">Recursive forecast</h3><div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Date</th><th>Estimated units</th><th>Baseline</th></tr></thead><tbody>{data.forecasts.map(r=><tr key={r.day}><td className="py-1">{r.day}</td><td>{formatDecimal(r.prediction,2)}</td><td>{formatDecimal(r.baseline,2)}</td></tr>)}</tbody></table></div></div>
      </div>
    </>}
  </ChartCard>
}
