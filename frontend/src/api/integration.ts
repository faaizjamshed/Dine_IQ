import { apiGet, apiPost, ApiError, type AuthHeaders } from './client'
import { NA, num, str, sum, ratio, group, scope, envelope, performance, mapUser, menuRows, completeReport, query, type Row, type List, type Report } from './backend'
import type * as T from './types'
export { fetchCustomersOverview, fetchBasketAnalysis, fetchWastageOverview, fetchPricingOverview } from './integration-details'
export { fetchModelComparison, fetchForecastOverview, fetchAdminOverview, fetchReportsCatalog, runReport } from './integration-system'

export async function postLogin(body: {email:string;password:string}): Promise<T.LoginResponse> {
  const res = await apiPost<{user:Row}>('/api/auth/login',body)
  return {user:mapUser(res.user)}
}
export async function postRegister(body: {email:string;password:string}): Promise<T.LoginResponse> {
  const res = await apiPost<{user:Row}>('/api/auth/register',body)
  return {user:mapUser(res.user)}
}
export async function fetchMe(_auth?:AuthHeaders): Promise<T.MeResponse> {
  const res = await apiGet<{user:Row|null}>('/api/auth/session')
  return {user:res.user ? mapUser(res.user) : null}
}
export const postLogout = () => apiPost('/api/auth/logout')
export interface FiltersResponse {categories:string[];channels:string[];cities:string[];restaurants:Row[]}
export const fetchFilters = () => apiGet<FiltersResponse>('/api/filters')
export interface Health {status:string; data_window:{start:string;end:string}|null;error:string|null}
export const fetchHealth = () => apiGet<Health>('/api/health')

export function mapMenu(r:Row): T.MenuItem {
  return {itemId:str(r,'menu_item_id'),name:str(r,'item_name'),category:str(r,'category_name'),categoryId:str(r,'category_id'),price:num(r,'base_price'),
    revenue:num(r,'revenue'),quantity:num(r,'units_sold'),marginPct:num(r,'contribution_margin_pct')*100,
    costPct:ratio(num(r,'estimated_cost'),num(r,'revenue'))*100,rating:NA,repeatRatePct:NA,
    wastagePct:num(r,'wastage_cost_ratio')*100,promoDependencyPct:NA,trendPct:NA,performanceClass:performance(str(r,'performance_class'))}
}
const menuNote = 'Historical completed-order menu analytics. Margin is contribution / net item revenue. Wastage is waste cost / estimated item cost. Item ratings, repeat rates, promotion dependency and 90-day trends are unavailable.'
export async function fetchMenuItems(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.MenuItemsResponse> {
  return envelope({items:(await menuRows(filters)).map(mapMenu)},menuNote)
}
export async function fetchMenuSummary(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.MenuSummaryResponse> {
  const all=await menuRows(); const rows=await menuRows(filters); const units=sum(rows,'units_sold'); const revenue=sum(rows,'revenue')
  const items=rows.map(mapMenu)
  const classes=[...new Set(items.map(r=>r.performanceClass))]
  return envelope({periodLabel:'Stored historical period · selected menu items',kpis:{itemsTracked:items.length,revenueCoverage:ratio(revenue,sum(all,'revenue')),
    avgMarginPct:ratio(sum(rows,'contribution_margin'),revenue)*100,avgRating:NA,promoDependentItems:NA,wastagePct:ratio(sum(rows,'wastage_cost'),sum(rows,'estimated_cost'))*100},
    scatter:{points:items.map((r,i)=>({...r,popularityShare:ratio(r.quantity,units),inQuadrantStar:r.quantity>=num(rows[i],'popularity_threshold_units_p75')&&r.marginPct>=num(rows[i],'margin_threshold_pct_p75')*100})),
      medianPopularityShare:rows.length ? ratio(num(rows[0],'popularity_threshold_units_p75'),units) : NA,
      medianMarginPct:rows.length ? num(rows[0],'margin_threshold_pct_p75')*100 : NA,
      quadrantLabels:{high:'Above backend 75th-percentile thresholds',low:'Below backend 75th-percentile thresholds'}},
    classDistribution:classes.map(c=>({performanceClass:c,count:items.filter(i=>i.performanceClass===c).length,revenue:items.filter(i=>i.performanceClass===c).reduce((a,i)=>a+i.revenue,0),revenueShare:ratio(items.filter(i=>i.performanceClass===c).reduce((a,i)=>a+i.revenue,0),revenue)})),trickyCases:[]},
    menuNote+' Scatter guides use the backend 75th-percentile thresholds, not medians. A separate watchlist is unavailable.')
}

interface Overview {kpis:Row;period:{start:string;end:string};monthly:Row[];channels:Row[]}
export async function fetchKpis(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.KpisResponse> {
  scope(filters,['dateFrom','dateTo'])
  const [o,peaks,menu]=await Promise.all([apiGet<Overview>('/api/overview'),apiGet<List>('/api/demand/peak-hours'),menuRows()])
  const hasDates=Boolean(filters.dateFrom||filters.dateTo)
  // Only monthly totals are filterable in the existing overview API family.
  const monthly=hasDates ? (await apiGet<List>('/api/demand/monthly'+query({from:filters.dateFrom?.slice(0,7),to:filters.dateTo?.slice(0,7)}))).items : o.monthly
  const revenue=sum(monthly,'completed_revenue');const orders=sum(monthly,'total_orders');const completed=sum(monthly,'completed_orders')
  if(!monthly.length) throw new ApiError('No monthly data exists in the selected range.',422,'no_data','/api/demand/monthly')
  const ranks=[...menu].sort((a,b)=>num(b,'revenue')-num(a,'revenue'))
  const rank=(r:Row,i:number):T.DishRankItem=>({rank:i+1,itemId:str(r,'menu_item_id'),name:str(r,'item_name'),category:str(r,'category_name'),revenue:num(r,'revenue'),quantity:num(r,'units_sold'),marginPct:num(r,'contribution_margin_pct')*100,performanceClass:performance(str(r,'performance_class'))})
  const week=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  return envelope({periodLabel:hasDates ? `${str(monthly[0],'order_month')} to ${str(monthly[monthly.length-1],'order_month')} · whole calendar months` : `${o.period.start} to ${o.period.end} · full historical period`,
    kpis:[
      {id:'revenue',label:'Completed revenue',unit:'pkr',value:revenue,source:'/api/demand/monthly',sparkline:monthly.map(r=>num(r,'completed_revenue'))},
      {id:'orders',label:'Orders',unit:'count',value:orders,source:'/api/demand/monthly'},
      {id:'completed',label:'Completed orders',unit:'count',value:completed,source:'/api/demand/monthly'},
      {id:'aov',label:'Completed revenue / order',unit:'pkr',value:ratio(revenue,completed),source:'/api/demand/monthly'},
      {id:'outlets',label:'Restaurants',unit:'count',value:hasDates?NA:num(o.kpis,'restaurants'),source:'/api/overview'},
      {id:'items',label:'Menu items',unit:'count',value:hasDates?NA:num(o.kpis,'menu_items'),source:'/api/overview'},
      {id:'rating',label:'Restaurant rating',unit:'rating',value:hasDates?NA:num(o.kpis,'weighted_restaurant_rating'),source:'/api/overview'},
      {id:'margin',label:'Item contribution margin',unit:'percent',value:hasDates?NA:ratio(sum(menu,'contribution_margin'),sum(menu,'revenue'))*100,source:'/api/intelligence/menu'},
    ],revenueTrend:{series:monthly.map(r=>({date:str(r,'order_month')+'-01',revenue:num(r,'completed_revenue'),orders:num(r,'total_orders')})),annotations:[]},
    channelMix:hasDates?[]:o.channels.map(r=>({channel:str(r,'ordering_channel'),label:str(r,'ordering_channel'),revenue:num(r,'completed_revenue'),share:ratio(num(r,'completed_revenue'),sum(o.channels,'completed_revenue')),orders:num(r,'orders')})),
    hourWeekday:{hours:Array.from({length:24},(_,i)=>i),weekdays:week,values:hasDates?[]:peaks.items.map(r=>({weekday:week[num(r,'weekday')-1],hour:num(r,'hour_of_day'),orders:num(r,'orders')}))},
    topBottomDishes:{top:hasDates?[]:ranks.slice(0,5).map(rank),bottom:hasDates?[]:ranks.slice(-5).reverse().map(rank)}},
    hasDates?'Date ranges select whole calendar months. Other dashboard breakdowns are unavailable for date-filtered scopes.':'Canonical project analytics use the existing synthetic dataset. Values are served by the backend; no demo values are loaded.')
}

export async function fetchLocations(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.LocationsResponse> {
  scope(filters,['location'])
  const [r,ratings,loc]=await Promise.all([apiGet<List>('/api/restaurants?limit=1000'),apiGet<List>('/api/ratings'),completeReport('locations_menu')])
  const total=sum(r.items,'revenue')
  const outlets=r.items.filter(x=>!filters.location||str(x,'restaurant_id')===filters.location).map(x=>{
    const id=str(x,'restaurant_id'),items=loc.items.filter(m=>str(m,'restaurant_id')===id)
    const rating=ratings.items.find(y=>str(y,'restaurant_id')===id)
    return {id,name:str(x,'restaurant_name'),city:str(x,'city'),revenue:num(x,'revenue'),orders:num(x,'order_count'),aov:num(x,'avg_order_value'),
      profitMarginPct:ratio(sum(items,'contribution_margin'),sum(items,'revenue'))*100,rating:rating?num(rating,'avg_rating'):NA,performanceClass:'unclassified' as T.PerformanceClass,revenueShare:ratio(num(x,'revenue'),total)}
  })
  return envelope({outlets},'Full historical period. Outlet performance classes and flags are not supplied. Contribution margin uses the complete location-menu report.')
}
export async function fetchLocationsDetail(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.LocationsDetailResponse> {
  const [outlets,loc,menu]=await Promise.all([fetchLocations(filters),completeReport('locations_menu'),menuRows()])
  const rows=outlets.data.outlets, total=rows.reduce((a,r)=>a+r.revenue,0)
  const cities=[...new Set(rows.map(r=>r.city))]
  const values=new Map<string,{outletId:string;categoryId:string;revenue:number}>()
  const categories=[...new Set(menu.map(r=>str(r,'category_name')))]
  for(const r of loc.items){
    const outletId=str(r,'restaurant_id');if(!rows.some(o=>o.id===outletId))continue
    const item=menu.find(m=>str(m,'menu_item_id')===str(r,'menu_item_id'));if(!item)continue
    const categoryId=str(item,'category_name');const key=outletId+'|'+categoryId
    const prev=values.get(key);values.set(key,{outletId,categoryId,revenue:(prev?.revenue??0)+num(r,'revenue')})
  }
  const margin=(ids:string[])=>{const items=loc.items.filter(r=>ids.includes(str(r,'restaurant_id')));return ratio(sum(items,'contribution_margin'),sum(items,'revenue'))*100}
  return envelope({periodLabel:'Full historical period · canonical restaurants',kpis:{outlets:rows.length,cities:cities.length,bestOutlet:rows[0]?.name??'Unavailable',flaggedOutlets:NA,avgMarginPct:margin(rows.map(r=>r.id))},
    cityAggregates:cities.map(city=>{const c=rows.filter(r=>r.city===city).sort((a,b)=>b.revenue-a.revenue);return {city,outlets:c.length,revenue:c.reduce((a,r)=>a+r.revenue,0),revenueShare:ratio(c.reduce((a,r)=>a+r.revenue,0),total),avgMarginPct:margin(c.map(r=>r.id)),bestOutlet:c[0].name,worstOutlet:c[c.length-1].name}}),
    matrix:{outletIds:rows.map(r=>r.id),outletNames:rows.map(r=>r.name),categories,values:[...values.values()]}},'City totals and the matrix summarize complete API-returned rows. Best/worst outlet means highest/lowest reported revenue.')
}
export async function fetchChannels(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.ChannelsResponse> {
  scope(filters,['channel']);const r=await apiGet<List>('/api/channels');const total=sum(r.items,'completed_revenue')
  return envelope({channels:r.items.filter(x=>!filters.channel||str(x,'ordering_channel')===filters.channel).map(x=>({channel:str(x,'ordering_channel'),label:str(x,'ordering_channel'),revenue:num(x,'completed_revenue'),orders:num(x,'orders'),aov:num(x,'avg_order_value'),revenueShare:ratio(num(x,'completed_revenue'),total),basketSize:NA,discountPct:NA,platformFeePct:NA,contributionMarginPct:NA,peakHours:[]}))},'Full historical period. Channel basket size, discounts, platform fees, margins and hourly breakdowns are unavailable.')
}
export async function fetchChannelsHourly(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.ChannelsHourlyResponse> {
  scope(filters,['channel']);await apiGet<List>('/api/channels')
  return envelope({channels:[],hours:[],values:[]},'Data unavailable: the backend exposes overall weekday/hour demand, but no channel-by-hour breakdown.')
}

export async function fetchRecommendations(filters:T.GlobalFilters&{priority?:string;status?:string},_auth?:AuthHeaders):Promise<T.RecommendationsResponse> {
  const {priority,status,...global}=filters;scope(global)
  const r=await apiGet<List>('/api/intelligence/recommendations?limit=1000')
  if ((priority&&priority!=='all'&&priority!=='unranked')||(status&&status!=='all'&&status!=='unavailable')) throw new ApiError('Priority and review-status data are unavailable. Choose All.',422,'no_data','/api/intelligence/recommendations')
  return envelope({recommendations:r.items.map((x,i)=>({id:`recommendation-${i}-${str(x,'subject')}`,priority:'unranked',type:str(x,'source'),action:str(x,'action'),entityLabel:str(x,'subject'),itemId:str(x,'consequent_id')||undefined,evidence:[{metric:'Backend evidence',value:str(x,'evidence')}],status:'unavailable',createdAt:''}))},`Showing ${r.items.length} of ${r.count} historical recommendations. Priority, created time and status updates are unavailable.`)
}
export async function fetchAnomalies(filters:T.GlobalFilters&{limit?:number},_auth?:AuthHeaders):Promise<T.AnomaliesResponse> {
  const {limit,...global}=filters;scope(global,['location','dateFrom','dateTo'])
  const r=await apiGet<{ratings:Row[];sales:Row[];rating_count:number;sales_count:number;interpretation:string}>('/api/intelligence/anomalies?limit=1000')
  let anomalies:T.Anomaly[]=[...r.ratings.map(x=>({...x,kind:'rating'})),...r.sales.map(x=>({...x,kind:'sales'}))].map((x,i)=>{
    const row=x as Row;const date=str(row,'event_date')||str(row,'hour_start')
    return {id:`${str(row,'kind')}-${str(row,'restaurant_id')}-${date}-${i}`,type:str(row,'kind'),severity:'unranked',detectedAt:date,dimension:'restaurant',dimensionRef:str(row,'restaurant_id'),summary:`${str(row,'kind')} anomaly candidate at ${str(row,'restaurant_id')}`,detectionMethod:str(row,'method'),evidence:Object.entries(row).filter(([k,v])=>typeof v==='number').map(([k,v])=>({metric:k.replaceAll('_',' '),value:String(v)})),status:'unavailable'}
  })
  anomalies=anomalies.filter(a=>(!filters.location||a.dimensionRef===filters.location)&&(!filters.dateFrom||a.detectedAt.slice(0,10)>=filters.dateFrom)&&(!filters.dateTo||a.detectedAt.slice(0,10)<=filters.dateTo))
  if(limit) anomalies=anomalies.slice(0,limit)
  return envelope({anomalies},`${r.interpretation}. Filtering applies to the returned sample (up to 1000 per type; ${r.sales_count+r.rating_count} total). Severity and review status are unavailable. Dates are event dates.`)
}
export async function updateRecommendationStatus(..._args:unknown[]):Promise<T.RecommendationStatusResponse> {throw new ApiError('Recommendation status updates are not supported by the existing backend.',422,'no_data','')}
export async function updateAnomalyStatus(..._args:unknown[]):Promise<T.AnomalyStatusResponse> {throw new ApiError('Anomaly status updates are not supported by the existing backend.',422,'no_data','')}

export async function runWhatIfSimulation(input:T.WhatIfScenarioInput,filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.WhatIfResponse> {
  scope(filters,['category']);if(input.prepChangePct!==0)throw new ApiError('Combined preparation scenarios are unavailable.',422,'no_data','/api/what-if')
  const row=(await menuRows(filters)).find(r=>str(r,'menu_item_id')===input.itemId)
  if(!row)throw new ApiError('Select an available menu item.',422,'no_data','/api/intelligence/menu')
  const price=num(row,'base_price'),units=num(row,'units_sold'),cost=num(row,'unit_cost')
  const result=await apiPost<{baseline:Row;scenario:Row;assumptions:Row;interpretation:string}>('/api/what-if',{scenario:'price',price,unit_cost:cost,units,price_change_pct:(1+input.priceChangePct/100)*(1-input.discountPct/100)-1,elasticity:input.elasticity})
  const metrics=(r:Row,p:number,q:number):T.WhatIfMetrics=>({price:p,quantity:q,revenue:num(r,'revenue'),profit:num(r,'contribution'),marginPct:ratio(num(r,'contribution'),num(r,'revenue'))*100})
  const baseline=metrics(result.baseline,price,units),scenario=metrics(result.scenario,num(result.scenario,'price'),num(result.scenario,'units'))
  return envelope({estimate:true,itemId:input.itemId,itemName:str(row,'item_name'),category:str(row,'category_name'),scopeLabel:'Full historical units at catalog price · user-supplied elasticity',horizonDays:NA,baseline,scenario,
    deltas:([['Effective price','price'],['Items sold','quantity'],['Revenue','revenue'],['Contribution profit','profit'],['Contribution margin','marginPct']] as const).map(([metric,k])=>({metric,baseline:baseline[k],scenario:scenario[k],deltaPct:ratio(scenario[k]-baseline[k],baseline[k])*100,direction:scenario[k]>baseline[k]?'increase':scenario[k]<baseline[k]?'decrease':'flat',favorability:'neutral'})),
    assumptions:Object.entries(result.assumptions).map(([k,v])=>({metric:k.replaceAll('_',' '),value:String(v)})),notes:[result.interpretation,'Baseline revenue uses catalog price times historical units, not recorded realized revenue. Discount adjusts the proposed price; no promotion lift is assumed. Daily horizons and combined preparation effects are unavailable.']},result.interpretation)
}
