"""Independent pandas/scikit-learn hourly demand forecast; reads frozen CSV directly."""
from __future__ import annotations
import argparse,json,sys,time
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder,StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor,HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error,mean_squared_error,r2_score
import joblib

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"scripts"/"ml"))
from demand_common import *

def make_dataset(path, weekday="monday-zero"):
    orders=pd.read_csv(path,usecols=["order_id","restaurant_id","order_datetime"],dtype={"order_id":"string","restaurant_id":"string"},parse_dates=["order_datetime"])
    orders=orders.drop_duplicates("order_id",keep="first")
    orders=orders.dropna(subset=["restaurant_id","order_datetime"])
    orders["hour_start"]=orders.order_datetime.dt.floor("h")
    count=orders.groupby(["restaurant_id","hour_start"],observed=True).size().rename(TARGET)
    restaurants=sorted(orders.restaurant_id.unique())
    hours=pd.date_range(START,END,freq="h")
    full=pd.MultiIndex.from_product([restaurants,hours],names=["restaurant_id","hour_start"])
    frame=count.reindex(full,fill_value=0).rename(TARGET).reset_index()
    frame[TARGET]=frame[TARGET].astype("float64")
    grouped=frame.groupby("restaurant_id",sort=False)[TARGET]
    for lag in (1,24,168): frame[f"lag_{lag}h"]=grouped.shift(lag)
    frame["hour_of_day"]=frame.hour_start.dt.hour.astype("float64")
    frame["day_of_week"]=frame.hour_start.dt.dayofweek.astype("float64")
    if weekday == "sunday-zero":
        frame["day_of_week"] = (frame["day_of_week"] + 1) % 7
    elif weekday != "monday-zero":
        raise ValueError("Unsupported weekday convention")
    frame["month"]=frame.hour_start.dt.month.astype("float64")
    frame=frame.loc[frame.lag_168h.notna()].copy()
    train=frame.hour_start < "2026-04-01"
    val=(frame.hour_start >= "2026-04-01")&(frame.hour_start < "2026-06-01")
    test=frame.hour_start >= "2026-06-01"
    return frame,train,val,test

def build_pipeline(estimator):
    numeric=["hour_of_day","day_of_week","month","lag_1h","lag_24h","lag_168h"]
    prep=ColumnTransformer([("restaurant",OneHotEncoder(handle_unknown="ignore",sparse_output=False),["restaurant_id"]),
      ("numeric",make_pipeline(SimpleImputer(strategy="median"),StandardScaler()),numeric)],remainder="drop")
    return make_pipeline(prep,estimator)

def score(model,x,y):
    pred=model.predict(x)
    return {"rmse":float(mean_squared_error(y,pred)**0.5),"mae":float(mean_absolute_error(y,pred)),"r2":float(r2_score(y,pred))}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', default='results/ml/python')
    parser.add_argument('--weekday', choices=['monday-zero','sunday-zero'], default='monday-zero')
    args=parser.parse_args()
    out=ROOT/args.output_dir
    if (out/'pipeline.json').exists():
        raise SystemExit('Output evidence already exists; select a fresh --output-dir')
    began=time.perf_counter(); frame,tr,va,te=make_dataset(ROOT/"data"/"generated"/"orders.csv",args.weekday)
    xcols=FEATURES; x=frame[xcols]; y=frame[TARGET]
    estimators=[("ridge",Ridge(alpha=1.0)),("random_forest",RandomForestRegressor(n_estimators=40,max_depth=12,min_samples_leaf=3,max_features=0.8,n_jobs=4,random_state=SEED)),
      ("hist_gradient_boosting",HistGradientBoostingRegressor(max_iter=100,max_leaf_nodes=31,l2_regularization=1.0,learning_rate=0.08,random_state=SEED))]
    results={}; fitted={}
    for name,est in estimators:
        model=build_pipeline(est); model.fit(x.loc[tr],y.loc[tr]); results[name]={"validation":score(model,x.loc[va],y.loc[va]),"hyperparameters":est.get_params()}; fitted[name]=model
        print("VALIDATION",name,results[name]["validation"],flush=True)
    selected=min(results,key=lambda n:results[n]["validation"]["mae"])
    alltrain=tr|va; est=dict(estimators)[selected]; final=build_pipeline(est).fit(x.loc[alltrain],y.loc[alltrain])
    test_metrics=score(final,x.loc[te],y.loc[te]); pred=final.predict(x.loc[te])
    indexes=np.flatnonzero(te.to_numpy())[:25]
    samples=[{"restaurant_id":str(frame.iloc[i].restaurant_id),"hour_start":str(frame.iloc[i].hour_start),"actual":float(y.iloc[i]),"prediction":float(pred[j])} for j,i in enumerate(indexes)]
    # Prediction ordering matches test frame exactly; collect first 25 by timestamp/restaurant deterministically.
    testframe=frame.loc[te].sort_values(["hour_start","restaurant_id"]); testpred=final.predict(testframe[xcols])
    samples=[{"restaurant_id":str(r.restaurant_id),"hour_start":str(r.hour_start),"actual":float(r.order_count),"prediction":float(p)} for r,p in zip(testframe.head(25).itertuples(),testpred[:25])]
    out.mkdir(parents=True,exist_ok=True); model_path=out/"selected_model.joblib"; joblib.dump(final,model_path)
    reload=joblib.load(model_path); reload_predictions=reload.predict(testframe.head(8)[xcols])
    result={"problem":"hourly restaurant demand regression","target":TARGET_DEFINITION,"prediction_point":PREDICTION_POINT,"features":FEATURES,"leakage_exclusions":LEAKAGE_EXCLUSIONS,
      "source":"data/generated/orders.csv (frozen source, deduplicated and aggregated independently with pandas)","panel_rows":329400,"usable_rows":len(frame),"split":{"train":int(tr.sum()),"validation":int(va.sum()),"test":int(te.sum()),"train_range":"2025-03-08 00:00 through 2026-03-31 23:00","validation_range":"2026-04-01 through 2026-05-31","test_range":"2026-06-01 through 2026-08-31"},
      "seed":SEED,"preprocessing":"pandas hourly aggregation and complete grid, groupwise 1h/24h/168h lags, median imputation, standardized numeric features, restaurant one-hot encoding","models":results,"selected_model":selected,"test_metrics":test_metrics,"sample_predictions":samples,"model_path":str(model_path),"python_version":__import__("platform").python_version(),"sklearn_version":sklearn.__version__,"pandas_version":pd.__version__,"numpy_version":np.__version__,"joblib_version":joblib.__version__,"timestamp_utc":datetime.now(timezone.utc).isoformat(),"elapsed_seconds":round(time.perf_counter()-began,3),"reload_smoke_test":{"rows_with_prediction":len(reload_predictions),"passed":len(reload_predictions)==8}}
    result['weekday_convention']=args.weekday
    (out/"pipeline.json").write_text(json.dumps(result,indent=2,default=str),encoding="utf-8")
    print("TEST_METRICS",test_metrics,"SELECTED",selected,"ELAPSED",result["elapsed_seconds"],"RELOAD",len(reload_predictions),flush=True)
if __name__=="__main__": main()
