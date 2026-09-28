"""Independent pandas menu-profit metrics from frozen raw CSV (no Spark output input)."""
from __future__ import annotations
import json,time
from pathlib import Path
import pandas as pd

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'results'/'python'/'gap1'; OUT.mkdir(parents=True,exist_ok=True)

def allocate_net_revenue(line_total, order_discount, order_subtotal):
    """Allocate an order discount pro rata to one item line."""
    if order_discount is None or order_subtotal is None or order_subtotal<=0 or line_total<0 or order_discount<0:
        return None
    return line_total-(order_discount*line_total/order_subtotal)

def main():
    began=time.perf_counter(); data=ROOT/'data'/'generated'
    menu=pd.read_csv(data/'menu_items.csv',dtype={'menu_item_id':'string','category_id':'string'})
    menu=menu.drop_duplicates('menu_item_id',keep='first')
    cost=menu.set_index('menu_item_id').cost_price.to_dict()
    names=menu.set_index('menu_item_id').item_name.to_dict()
    orders=pd.read_csv(data/'orders.csv',usecols=['order_id','order_status','subtotal','discount_amount'],dtype={'order_id':'string','order_status':'string'})
    orders=orders.drop_duplicates('order_id',keep='first')
    completed_orders=orders.loc[orders.order_status.eq('Completed')].dropna(subset=['order_id'])
    completed=set(completed_orders.order_id)
    discount=completed_orders.set_index('order_id').discount_amount.to_dict()
    subtotal=completed_orders.set_index('order_id').subtotal.to_dict()
    aggregates={}; seen=set(); valid_rows=0; duplicates=0; chunks=0
    for frame in pd.read_csv(data/'order_items.csv',usecols=['order_item_id','order_id','menu_item_id','quantity','unit_price','item_discount'],dtype={'order_item_id':'string','order_id':'string','menu_item_id':'string'},chunksize=200_000):
        chunks+=1
        is_new=~frame.order_item_id.isin(seen); duplicates+=int((~is_new).sum())
        seen.update(frame.loc[is_new,'order_item_id'].dropna().tolist()); frame=frame.loc[is_new]
        frame=frame[frame.order_id.isin(completed)&frame.quantity.gt(0)&frame.unit_price.gt(0)&frame.item_discount.notna()].copy()
        frame['line_total']=(frame.quantity*frame.unit_price-frame.item_discount).round(2)
        frame['order_discount']=frame.order_id.map(discount); frame['order_subtotal']=frame.order_id.map(subtotal)
        frame=frame[frame.line_total.ge(0)&frame.menu_item_id.isin(cost)&frame.order_discount.notna()&frame.order_discount.ge(0)&frame.order_subtotal.gt(0)].copy()
        frame['net_item_revenue']=frame.line_total-(frame.order_discount*frame.line_total/frame.order_subtotal)
        frame['unit_cost']=frame.menu_item_id.map(cost)
        frame=frame[frame.unit_cost.gt(0)]
        valid_rows+=len(frame)
        frame['estimated_cost']=frame.quantity*frame.unit_cost
        # Preserve additive sums separately from distinct-order counts.
        sums=(frame.groupby('menu_item_id',observed=True).agg(units_sold=('quantity','sum'),gross_item_sales=('line_total','sum'),revenue=('net_item_revenue','sum'),estimated_cost=('estimated_cost','sum')).to_dict('index'))
        counts=frame.drop_duplicates(['menu_item_id','order_id']).groupby('menu_item_id',observed=True).order_id.nunique().to_dict()
        for key,val in sums.items():
            a=aggregates.setdefault(str(key),{'units_sold':0,'gross_item_sales':0.0,'revenue':0.0,'estimated_cost':0.0,'order_count':0})
            a['units_sold']+=int(val['units_sold']); a['gross_item_sales']+=float(val['gross_item_sales']); a['revenue']+=float(val['revenue']); a['estimated_cost']+=float(val['estimated_cost']); a['order_count']+=int(counts[key])
    rows=[]
    for item in menu.itertuples(index=False):
        key=str(item.menu_item_id); a=aggregates.get(key,{'units_sold':0,'gross_item_sales':0.0,'revenue':0.0,'estimated_cost':0.0,'order_count':0})
        margin=a['revenue']-a['estimated_cost']
        rows.append({'menu_item_id':key,'item_name':item.item_name,'units_sold':a['units_sold'],'order_count':a['order_count'],'gross_item_sales':a['gross_item_sales'],'revenue':a['revenue'],'estimated_cost':a['estimated_cost'],'contribution_margin':margin,'contribution_margin_pct':margin/a['revenue'] if a['revenue']>0 else None})
    result=pd.DataFrame(rows).sort_values('menu_item_id'); result.to_csv(OUT/'menu_profitability.csv',index=False)
    payload={'source':'frozen raw CSV; independently deduplicated by order_item_id and independently recomputed valid line totals; completed orders only','input_files':['data/generated/orders.csv','data/generated/order_items.csv','data/generated/menu_items.csv'],'cleaning_semantics':'drop duplicate order/order-item IDs keeping first; retain positive qty/unit price, non-null item discount, nonnegative recomputed line total, valid nonnegative order discount and positive source subtotal; allocate order discount in proportion to each line total; static item cost','discount_allocation':'net item revenue = recomputed item line total - order discount * item line total / source order subtotal','processed_order_item_rows':valid_rows,'duplicate_order_item_ids_skipped':duplicates,'chunks':chunks,'menu_items':len(rows),'elapsed_seconds':round(time.perf_counter()-began,3),'output':'results/python/gap1/menu_profitability.csv','limitations':'Independent source-CSV cleaning may differ on duplicate winner and quality-repair details from canonical Spark v4; compare rows and report actual differences; no label/target or model loaded from Spark.'}
    (OUT/'pipeline.json').write_text(json.dumps(payload,indent=2),encoding='utf-8'); print(json.dumps(payload,indent=2))
if __name__=='__main__':main()
