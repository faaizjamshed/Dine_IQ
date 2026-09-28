import { apiGet, type AuthHeaders, ApiError } from './client'
import { NA,num,str,sum,ratio,group,scope,envelope,menuRows,completeReport,query,type Row,type List } from './backend'
import type * as T from './types'

export async function fetchCustomersOverview(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.CustomerOverviewResponse> {
  scope(filters)
  const [segments,rfm,churn]=await Promise.all([
    apiGet<List>('/api/customer-segments'),apiGet<List>('/api/intelligence/customers?limit=1000'),
    apiGet<List&{as_of:string;definition:string}>('/api/intelligence/churn-risk?limit=1000')])
  const revenue=sum(segments.items,'revenue')
  return envelope({periodLabel:`Historical customer analytics · RFM as of ${churn.as_of}`,kpis:{totalCustomers:rfm.count??NA,activeCustomers:NA,newCustomers:NA,repeatRatePct:NA,avgLifetimeValue:NA,avgOrdersPerCustomer:NA,highChurnRisk:churn.count??NA,revenueAtRisk:NA},
    segments:segments.items.map(r=>({id:str(r,'customer_segment'),label:str(r,'customer_segment'),customers:num(r,'customers'),revenue:num(r,'revenue'),revenueShare:ratio(num(r,'revenue'),revenue),avgOrderValue:num(r,'avg_order_value'),avgOrdersPerCustomer:ratio(num(r,'total_orders'),num(r,'customers')),description:'Source customer segment · historical completed orders'})),
    // These describe the explicitly labelled returned sample, not the full population.
    rfmTiers:group(rfm.items,'behavior_segment').map(([tier,rows])=>({tier,customers:rows.length,revenue:sum(rows,'monetary_value'),revenueShare:ratio(sum(rows,'monetary_value'),sum(rfm.items,'monetary_value')),avgRecencyDays:sum(rows,'recency_days')/rows.length,avgFrequency:sum(rows,'frequency')/rows.length,avgMonetary:sum(rows,'monetary_value')/rows.length})),
    churnRisk:[{bucket:'high',label:'90+ days inactive (descriptive)',customers:churn.count??NA,revenueAtRisk:NA,avgDaysSinceLastOrder:NA}],cohortRetention:[],promoSensitivity:[],
    topCustomers:churn.items.slice(0,30).map(r=>({id:str(r,'customer_id'),segment:str(r,'behavior_segment'),orders:num(r,'frequency'),lifetimeValue:num(r,'monetary_value'),lastOrderDaysAgo:num(r,'recency_days'),churnRisk:'inactive'}))},
    `RFM table summarizes only the top ${rfm.items.length} returned customer records by monetary value (${rfm.count} total). Inactivity is descriptive, not predictive churn. Cohorts, promotion sensitivity, population averages and revenue-at-risk are unavailable.`)
}

export async function fetchBasketAnalysis(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.BasketAnalysisResponse> {
  scope(filters)
  const [r,menu]=await Promise.all([apiGet<List&{association_thresholds:Row;directional_rules:number;minimum_confidence:number}>('/api/intelligence/baskets?limit=1000'),menuRows()])
  return envelope({periodLabel:'Full historical completed-order baskets',kpis:{basketsAnalyzed:num(r.association_thresholds,'basket_count'),avgBasketSize:NA,avgBasketValue:NA,attachRatePct:NA,strongRules:r.items.filter(x=>x.recommendation_supported===true).length,bundleOpportunities:NA},
    rules:r.items.map(x=>({id:str(x,'antecedent_id')+'-'+str(x,'consequent_id'),antecedent:{itemId:str(x,'antecedent_id'),name:str(x,'antecedent')},consequent:{itemId:str(x,'consequent_id'),name:str(x,'consequent')},category:str(menu.find(m=>str(m,'menu_item_id')===str(x,'antecedent_id'))??{},'category_name'),supportPct:num(x,'support')*100,confidencePct:num(x,'confidence')*100,lift:num(x,'lift'),pairOrders:num(x,'pair_count'),opportunity:x.recommendation_supported===true?'cross_sell':'none'})),
    categoryPairs:[],basketSizeDist:[],bundles:[]},
    `Showing ${r.items.length} of ${r.directional_rules} directional rules. Supported means confidence ≥ ${r.minimum_confidence} and lift > 1, as supplied by the backend. Basket-size distribution, category-pair totals and priced bundle suggestions are unavailable.`)
}

export async function fetchWastageOverview(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.WastageOverviewResponse> {
  scope(filters,['location','category','dateFrom','dateTo'])
  const [menu,reasons]=await Promise.all([menuRows(),apiGet<List>('/api/wastage')])
  const detailed=Boolean(filters.location||filters.dateFrom||filters.dateTo)
  let dimensions:Row[]=[]
  // Only complete monthly slices are aggregated. Never turn a capped top-N response into totals.
  if(detailed){
    const health=await apiGet<{data_window:{start:string;end:string}}>('/api/health')
    const from=filters.dateFrom?.slice(0,7)??health.data_window.start,to=filters.dateTo?.slice(0,7)??health.data_window.end
    const months:string[]=[];const d=new Date(from+'-01T00:00:00Z')
    if(!Number.isFinite(d.getTime())||from>to)throw new ApiError('Choose a valid month range.',422,'no_data','/api/intelligence/wastage')
    while(d.toISOString().slice(0,7)<=to&&months.length<240){months.push(d.toISOString().slice(0,7));d.setUTCMonth(d.getUTCMonth()+1)}
    // All restaurants are queried independently because each national month exceeds the route cap.
    const restaurants=filters.location?[{restaurant_id:filters.location}]:(await apiGet<List>('/api/restaurants?limit=1000')).items
    for(const restaurant of restaurants){
      const pages=await Promise.all(months.map(month=>apiGet<List>('/api/intelligence/wastage'+query({restaurant_id:str(restaurant,'restaurant_id'),month,limit:1000}))))
      for(const p of pages){if(p.count!==p.items.length)throw new ApiError('The backend caps this wastage slice. Totals are unavailable for this scope.',422,'no_data','/api/intelligence/wastage');dimensions.push(...p.items)}
    }
    if(filters.category)dimensions=dimensions.filter(r=>{const m=menu.find(x=>str(x,'menu_item_id')===str(r,'menu_item_id'));return m&&(str(m,'category_id')===filters.category||str(m,'category_name')===filters.category)})
  }
  const selected=menu.filter(r=>!filters.category||str(r,'category_id')===filters.category||str(r,'category_name')===filters.category)
  const rows=detailed?dimensions:selected
  const cost=sum(rows,'wastage_cost')
  const byItem=group(rows,detailed?'menu_item_id':'menu_item_id').map(([itemId,rs])=>{
    const m=menu.find(x=>str(x,'menu_item_id')===itemId)??{}
    return {itemId,name:str(m,'item_name'),category:str(m,'category_name'),wastagePct:NA,wastageCost:sum(rs,'wastage_cost'),preparedQty:NA,wastedQty:sum(rs,'quantity_wasted')}
  }).sort((a,b)=>b.wastageCost-a.wastageCost)
  const byCategory=group(rows,'category_name').map(([category,rs])=>({categoryId:category,category,wastageCost:sum(rs,'wastage_cost'),wastagePct:NA,shareOfWastage:ratio(sum(rs,'wastage_cost'),cost),topItem:[...rs].sort((a,b)=>num(b,'wastage_cost')-num(a,'wastage_cost'))[0]?.item_name as string??''})).sort((a,b)=>b.wastageCost-a.wastageCost)
  // The complete 5000-row ranking provides historical outlet totals without sampling.
  let byOutlet:T.WastageOutletRow[]=[]
  if(detailed){byOutlet=group(rows,'restaurant_id').map(([outletId,rs])=>({outletId,outlet:str(rs[0],'restaurant_name'),city:str(rs[0],'city'),wastageCost:sum(rs,'wastage_cost'),wastagePct:NA}))}
  else{
    const [rank,restaurants]=await Promise.all([completeReport('wastage_risk'),apiGet<List>('/api/restaurants?limit=1000')])
    const ids=new Set(selected.map(r=>str(r,'menu_item_id')))
    byOutlet=group(rank.items.filter(r=>ids.has(str(r,'menu_item_id'))),'restaurant_id').map(([outletId,rs])=>{const place=restaurants.items.find(r=>str(r,'restaurant_id')===outletId)??{};return {outletId,outlet:str(place,'restaurant_name'),city:str(place,'city'),wastageCost:sum(rs,'historical_wastage_cost'),wastagePct:NA}})
  }
  byOutlet.sort((a,b)=>b.wastageCost-a.wastageCost)
  const reasonRows=detailed?rows:filters.category?[]:reasons.items
  const reasonCost=(name:string)=>sum(reasonRows.filter(r=>str(r,'reason')===name),'wastage_cost')
  return envelope({periodLabel:detailed?'Selected whole calendar months / outlet':'Full historical period',kpis:{wastageCost:cost,wastagePctOfRevenue:detailed?NA:ratio(cost,sum(selected,'revenue'))*100,deltaPct:NA,prepWasteSharePct:reasonRows.length?ratio(reasonCost('Overproduction'),cost)*100:NA,spoilageSharePct:reasonRows.length?ratio(reasonCost('Spoilage')+reasonCost('Expired'),cost)*100:NA,worstCategory:byCategory[0]?.category??'Unavailable',worstOutlet:byOutlet[0]?.outlet??'Unavailable'},
    trend:detailed?group(rows,'waste_month').sort(([a],[b])=>a.localeCompare(b)).map(([date,rs])=>({date:date+'-01',wastageCost:sum(rs,'wastage_cost'),wastagePct:NA})):[],byCategory,byItem,byOutlet},
    'Historical waste costs and quantities. Preparation quantities, waste-unit percentages and previous-period deltas are unavailable. Select a date/outlet for monthly cost detail; dates cover whole calendar months. No predictive waste claims.')
}

export async function fetchPricingOverview(filters:T.GlobalFilters,_auth?:AuthHeaders):Promise<T.PricingPromoResponse> {
  scope(filters,['location','category'])
  const [prices,promos,menu,promotionBase]=await Promise.all([completeReport('price_sensitivity'),apiGet<List>('/api/intelligence/promotions?limit=1000'),menuRows(),apiGet<List>('/api/promotions?limit=1000')])
  const selected=prices.items.filter(r=>(!filters.location||str(r,'restaurant_id')===filters.location)&&(!filters.category||menu.some(m=>str(m,'menu_item_id')===str(r,'menu_item_id')&&(str(m,'category_id')===filters.category||str(m,'category_name')===filters.category))))
  const mapped=selected.map((r,i)=>{const m=menu.find(m=>str(m,'menu_item_id')===str(r,'menu_item_id'))??{};return {itemId:str(r,'menu_item_id'),rowId:`${str(r,'menu_item_id')}-${str(r,'restaurant_id')}-${str(r,'effective_from')}-${i}`,name:str(m,'item_name',str(r,'menu_item_id')),category:str(m,'category_name'),currentPrice:num(r,'new_price'),elasticity:num(r,'observational_arc_elasticity'),marginPct:NA,trendPct:num(r,'demand_change_pct')*100,recommendation:'unavailable' as const,rationale:`${str(r,'restaurant_id')} · ${str(r,'effective_from')} · ${str(r,'sensitivity')}. ${str(r,'interpretation')}`,confidence:NA}})
  const campaigns=(filters.category||filters.location?[]:promos.items).map(r=>{const basic=promotionBase.items.find(p=>str(p,'promotion_id')===str(r,'promotion_id'))??{};return {id:str(r,'promotion_id'),name:str(r,'promotion_name'),channel:'Unavailable',window:`${str(r,'start_date')} to ${str(r,'end_date')}`,discountPct:ratio(num(basic,'avg_discount'),num(basic,'avg_subtotal'))*100,orders:num(r,'orders'),revenue:num(r,'revenue'),incrementalRevenue:NA,roi:NA,marginImpactPct:NA,status:'historical' as const,verdict:'unavailable' as const}})
  return envelope({periodLabel:'Historical price-change observations · 30-day pre/post windows',pricingKpis:{itemsAnalyzed:new Set(selected.map(r=>str(r,'menu_item_id'))).size,avgElasticity:NA,inelasticItems:NA,elasticItems:NA,testCandidates:NA,revenueAtStake:NA},elasticity:mapped,
    promoKpis:{activeCampaigns:NA,revenueOnPromoPct:NA,avgDiscountPct:NA,positiveRoiCampaigns:NA,trappedItems:NA},campaigns,promoTraps:[]},
    'Price rows are observed item/outlet changes, not causal elasticity estimates or price recommendations. Campaigns are historical. Incremental revenue, ROI, confidence, item-level promotion traps and filtered promotion cohorts are unavailable.')
}
