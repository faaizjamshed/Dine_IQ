import { apiGet,type AuthHeaders } from './client'
import { NA,num,str,sum,ratio,scope,envelope,type Row,type List,type Report } from './backend'
import type * as T from './types'
interface Comparison {spark_model:string;python_model:string;spark_metrics:Row;python_metrics:Row;feature_semantics_note:string;keyed_cases:number;test_rows:number;test_period:unknown;prediction_cases:Row[]}
interface Evidence {production_tables:number;tables:Row[];quality_audits:number;analytics_execution_seconds:number;python_spark_comparison:Row;ml:Row}
interface Jobs {jobs:Row[];monitoring_mode:string;active_jobs:null}
const comparison=()=>apiGet<Comparison>('/api/ml/demand-comparison?limit=100')
export async function fetchForecastOverview(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.ForecastOverviewResponse> {
  scope(filters)
  const c=await comparison()
  return envelope({periodLabel:'Historical model evaluation · hourly restaurant order arrivals',kpis:{horizonDays:NA,forecastOrders:NA,forecastRevenue:NA,mapePct:NA,biasPct:NA,confidence:NA},daily:[],items:[],
    accuracy:([{modelName:c.spark_model,pipeline:'spark',metrics:c.spark_metrics},{modelName:c.python_model,pipeline:'python',metrics:c.python_metrics}] as const).map(r=>({modelName:r.modelName,pipeline:r.pipeline,mapePct:NA,rmse:num(r.metrics,'rmse'),mae:num(r.metrics,'mae'),r2:num(r.metrics,'r2'),withinTolerancePct:NA,horizonTestedDays:NA}))},
    `Multi-day revenue/item forecasts, prediction intervals, MAPE and confidence are unavailable. Use the hourly predictor with explicit lag inputs. ${c.feature_semantics_note}`)
}
export async function fetchModelComparison(_auth?:AuthHeaders):Promise<T.ModelComparisonResponse> {
  const [c,e,j]=await Promise.all([comparison(),apiGet<Evidence>('/api/system/evidence'),apiGet<Jobs>('/api/system/spark-jobs')])
  const pc=e.python_spark_comparison
  return envelope({kpis:{agreementPct:ratio(num(pc,'matched_metrics'),num(pc,'matched_metrics')+num(pc,'mismatched_metrics'))*100,sparkJobs:j.jobs.length,pythonJobs:NA,recordsCompared:c.keyed_cases,lastComparedAt:''},
    metrics:['rmse','mae','r2'].map(k=>({metric:k.toUpperCase(),unit:k==='r2'?'score':'orders',sparkValue:num(c.spark_metrics,k),pythonValue:num(c.python_metrics,k),better:'tie',note:c.feature_semantics_note})),agreement:[],
    recentRuns:j.jobs.map((r,i)=>({id:String(i),jobName:str(r,'job'),pipeline:'spark',startedAt:'',durationSec:num(r,'elapsed_seconds'),rowsIn:NA,rowsOut:NA,status:str(r,'status')==='historical-success'?'success':'unknown'})),
    recordDiffSample:c.prediction_cases.map(r=>({recordId:`${str(r,'restaurant_id')} ${str(r,'hour_start')}`,field:'Hourly orders prediction',sparkValue:String(r.spark_prediction),pythonValue:String(r.python_prediction),match:num(r,'spark_prediction')===num(r,'python_prediction')}))},
    `${c.feature_semantics_note} Agreement KPI refers to aggregate analytics checks, not equality of model predictions. Record table shows ${c.prediction_cases.length} of ${c.keyed_cases} keyed evaluation cases. Job history is saved evidence; start times and live status are unavailable.`)
}
export async function fetchAdminOverview(_auth?:AuthHeaders):Promise<T.AdminOverviewResponse> {
  const [e,j,a,artifacts]=await Promise.all([apiGet<Evidence>('/api/system/evidence'),apiGet<Jobs>('/api/system/spark-jobs'),apiGet<List>('/api/system/audit?limit=100'),apiGet<{artifacts:Row[]}>('/api/system/analytics-artifacts')])
  return envelope({kpis:{tablesIngested:e.production_tables,rowsIngested:sum(e.tables,'raw_rows'),runsLast24h:NA,failedJobs:NA,storageGb:NA,openQualityFails:NA},
    sparkJobs:j.jobs.map((r,i)=>({id:String(i),name:str(r,'job'),status:str(r,'status')==='historical-success'?'success':'unknown',startedAt:'',durationSec:num(r,'elapsed_seconds'),stages:'Unavailable',cores:NA,rowsShuffled:NA})),
    dataQuality:[],modelRegistry:artifacts.artifacts.filter(r=>str(r,'artifact_type').includes('model')).map(r=>({name:str(r,'artifact_id'),version:str(r,'source_version'),pipeline:'spark',trainedAt:'',status:'evidence',metrics:[]})),
    auditTrail:a.items.map(r=>({id:String(r.event_id),user:r.actor_user_id===null?'Unauthenticated':`User ${r.actor_user_id}`,role:(str(r,'actor_role')==='administrator'?'admin':str(r,'actor_role','unknown')) as T.AuditEvent['role'],action:str(r,'action'),target:[str(r,'entity'),str(r,'record_key')].filter(Boolean).join(' / '),at:str(r,'occurred_at')}))},
    'Administrator audit events come from operational SQLite. Spark jobs and model artifacts are historical evidence. Live run counts, warehouse storage, individual quality-check outcomes and training timestamps are unavailable.')
}
// Catalog metadata lists only the supported EXPORTS keys in operations_api.py.
const reports:Record<string,string>={menu:'Menu profitability',locations_menu:'Menu by location',baskets:'Basket rules',customers:'Customer RFM',wastage:'Wastage dimensions',wastage_risk:'Historical wastage burden',price_sensitivity:'Price-change observations',promotions:'Promotion cohorts',rating_anomalies:'Rating anomalies',sales_anomalies:'Sales anomalies',recommendations:'Recommendation evidence'}
export async function fetchReportsCatalog(_auth?:AuthHeaders):Promise<T.ReportCatalogResponse> {
  const me=await apiGet<{user:{role:string}|null}>('/api/auth/me')
  return envelope({reports:Object.entries(reports).filter(([id])=>id!=='customers'||me.user?.role!=='restaurant_manager').map(([id,name])=>({id,name,description:'Existing canonical analytics report',format:'csv',rows:NA,lastGenerated:'',requiresPermission:'exports.run',scopeNote:'Full historical scope; first 1000 rows. Total size is returned when run. Global filters are unsupported.'}))},'Report names map to existing backend report datasets. Counts are fetched only when a report runs.')
}
export async function runReport(id:string,filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.ReportRunResponse> {
  scope(filters)
  if(!(id in reports))throw new Error('Unknown report')
  const r=await apiGet<Report>('/api/reports/'+encodeURIComponent(id))
  const columns=Object.keys(r.items[0]??{}).map(key=>({key,label:key}))
  return {data:{reportId:id,columns,rows:r.items.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v===null?'':typeof v==='string'||typeof v==='number'?v:JSON.stringify(v)]))),generatedAt:r.generated_at,rowCount:r.items.length,truncated:r.records>r.items.length},meta:{note:`${r.items.length} of ${r.records} records; full historical scope. ${r.source}`}}
}
