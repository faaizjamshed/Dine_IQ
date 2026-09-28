import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiPost, fetchFilters } from '@/api/endpoints'
import { ChartCard } from '@/components/charts'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ApiErrorState } from '@/components/errors/states'
import { formatDecimal } from '@/lib/formatters'
import { str } from '@/api/backend'

interface Prediction {predicted_order_arrivals:number;model:string;target_hour_utc:string;warnings:string[]}
export function HourlyPrediction() {
  const locations=useQuery({queryKey:['reference','filters'],queryFn:fetchFilters})
  const [restaurant,setRestaurant]=useState('')
  const [hour,setHour]=useState('')
  const [lags,setLags]=useState({lag_1h:'',lag_24h:'',lag_168h:''})
  const prediction=useMutation({mutationFn:()=>apiPost<Prediction>('/api/ml/predict',{
    restaurant_id:restaurant,target_hour:hour+':00Z',...Object.fromEntries(Object.entries(lags).map(([k,v])=>[k,Number(v)])),
  })})
  const valid=restaurant&&hour&&hour.endsWith(':00')&&Object.values(lags).every(v=>v!==''&&Number.isInteger(Number(v))&&Number(v)>=0)
  const clear=()=>prediction.reset()
  return <ChartCard title="Hourly Demand Prediction" subtitle="Existing persisted model · provide observed order counts for the same restaurant">
    <form onSubmit={e=>{e.preventDefault();if(valid)prediction.mutate()}} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs text-muted">Restaurant<select aria-label="Prediction restaurant" value={restaurant} onChange={e=>{setRestaurant(e.target.value);clear()}} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-strong px-2 text-foreground"><option value="">Select restaurant</option>{locations.data?.restaurants.map(r=><option key={str(r,'restaurant_id')} value={str(r,'restaurant_id')}>{str(r,'restaurant_name')} · {str(r,'city')}</option>)}</select></label>
        <label className="text-xs text-muted">Target hour (UTC)<Input aria-label="Prediction hour UTC" type="datetime-local" step="3600" value={hour} onChange={e=>{setHour(e.target.value);clear()}} className="mt-1" /></label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">{Object.entries(lags).map(([k,v])=><label key={k} className="text-xs text-muted">Orders {k==='lag_1h'?'1 hour':k==='lag_24h'?'24 hours':'168 hours'} before target<Input aria-label={k} type="number" min="0" step="1" required value={v} onChange={e=>{setLags(prev=>({...prev,[k]:e.target.value}));clear()}} className="mt-1" /></label>)}</div>
      <Button type="submit" disabled={!valid||prediction.isPending}>{prediction.isPending?'Predicting…':'Predict hourly orders'}</Button>
      {locations.error&&<ApiErrorState error={locations.error} retry={()=>void locations.refetch()} />}
      {prediction.error&&<ApiErrorState error={prediction.error} />}
      {prediction.data&&<div role="status" className="rounded-lg border border-primary/40 bg-primary/10 p-4"><p className="font-bold">Estimate: {formatDecimal(prediction.data.predicted_order_arrivals,3)} orders</p><p className="text-xs text-muted">{prediction.data.model} · {prediction.data.target_hour_utc}</p>{prediction.data.warnings.map(w=><p key={w} className="mt-2 text-xs text-muted">{w}</p>)}</div>}
    </form>
  </ChartCard>
}
