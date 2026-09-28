"""Bounded arithmetic what-if scenarios; results are simulations, not forecasts."""
from __future__ import annotations
import math

def _nonnegative(name, value):
    x=float(value)
    if not math.isfinite(x) or x<0: raise ValueError(f'{name} must be a finite nonnegative number')
    return x

def simulate(payload: dict) -> dict:
    kind=payload.get('scenario')
    if kind=='price':
        price=_nonnegative('price',payload['price']); cost=_nonnegative('unit_cost',payload['unit_cost']); units=_nonnegative('units',payload['units'])
        change=float(payload['price_change_pct']); elasticity=float(payload.get('elasticity',0.0))
        if not math.isfinite(change) or not -0.9<=change<=2: raise ValueError('price_change_pct must be between -0.9 and 2')
        if not math.isfinite(elasticity) or not -10<=elasticity<=0: raise ValueError('elasticity must be between -10 and 0')
        # Arc-elasticity response is an explicit user-supplied assumption.
        new_price=price*(1+change); demand=max(0,units*(1+elasticity*change))
        return {'scenario':kind,'interpretation':'scenario arithmetic; elasticity is an assumption, not a causal estimate or validated forecast','baseline':{'revenue':price*units,'contribution':(price-cost)*units},'scenario':{'price':new_price,'units':demand,'revenue':new_price*demand,'contribution':(new_price-cost)*demand},'assumptions':{'price_change_pct':change,'elasticity':elasticity,'unit_cost_constant':True}}
    if kind=='promotion':
        revenue=_nonnegative('baseline_revenue',payload['baseline_revenue']); contribution=_nonnegative('baseline_contribution',payload['baseline_contribution']); freq=float(payload['frequency_change_pct']); discount=float(payload['discount_pct'])
        if not math.isfinite(freq) or not -1<=freq<=5: raise ValueError('frequency_change_pct must be between -1 and 5')
        if not math.isfinite(discount) or not 0<=discount<=.9: raise ValueError('discount_pct must be between 0 and 0.9')
        return {'scenario':kind,'interpretation':'proportional what-if arithmetic; no causal lift is inferred','baseline':{'revenue':revenue,'contribution':contribution},'scenario':{'revenue':revenue*(1+freq)*(1-discount),'contribution':contribution*(1+freq)-revenue*(1+freq)*discount},'assumptions':{'frequency_change_pct':freq,'discount_pct':discount,'cost_and_mix_constant':True}}
    if kind=='demand':
        demand=_nonnegative('baseline_demand',payload['baseline_demand']); margin=_nonnegative('contribution_per_unit',payload['contribution_per_unit']); change=float(payload['demand_change_pct'])
        if not math.isfinite(change) or not -1<=change<=5: raise ValueError('demand_change_pct must be between -1 and 5')
        new=demand*(1+change)
        return {'scenario':kind,'interpretation':'volume scenario; not a forecast','baseline':{'units':demand,'contribution':demand*margin},'scenario':{'units':new,'contribution':new*margin},'assumptions':{'demand_change_pct':change,'contribution_per_unit_constant':True}}
    if kind=='inventory':
        demand=_nonnegative('expected_demand_units',payload['expected_demand_units']); onhand=_nonnegative('on_hand_units',payload['on_hand_units']); waste=float(payload.get('wastage_rate',0))
        if not math.isfinite(waste) or not 0<=waste<=1: raise ValueError('wastage_rate must be between 0 and 1')
        target=demand*(1+waste)
        return {'scenario':kind,'interpretation':'stock-planning arithmetic using supplied demand and wastage assumptions; not a forecast','baseline':{'on_hand_units':onhand},'scenario':{'target_stock_units':target,'surplus_units':max(0,onhand-target),'shortfall_units':max(0,target-onhand)},'assumptions':{'expected_demand_units':demand,'wastage_rate':waste}}
    if kind=='preparation':
        prepared=_nonnegative('prepared_units',payload['prepared_units']); demand=_nonnegative('expected_demand_units',payload['expected_demand_units']); waste=float(payload['wastage_rate']); reduction=float(payload['preparation_reduction_pct'])
        if not math.isfinite(waste) or not 0<=waste<=1: raise ValueError('wastage_rate must be between 0 and 1')
        if not math.isfinite(reduction) or not 0<=reduction<=1: raise ValueError('preparation_reduction_pct must be between 0 and 1')
        new_prepared=prepared*(1-reduction)
        return {'scenario':kind,'interpretation':'preparation/waste arithmetic using supplied assumptions; demand is not forecast','baseline':{'prepared_units':prepared,'estimated_waste_units':prepared*waste},'scenario':{'prepared_units':new_prepared,'estimated_waste_units':new_prepared*waste,'available_units_after_waste':new_prepared*(1-waste),'shortfall_units':max(0,demand-new_prepared*(1-waste))},'assumptions':{'expected_demand_units':demand,'wastage_rate':waste,'preparation_reduction_pct':reduction}}
    if kind=='remove_item':
        rev=_nonnegative('item_revenue',payload['item_revenue']); margin=_nonnegative('item_contribution',payload['item_contribution'])
        return {'scenario':kind,'interpretation':'full-period removal arithmetic; assumes no substitution or demand transfer','baseline':{'revenue':rev,'contribution':margin},'scenario':{'revenue':0.0,'contribution':0.0},'assumptions':{'substitution':False}}
    raise ValueError('scenario must be price, promotion, demand, inventory, or remove_item')
