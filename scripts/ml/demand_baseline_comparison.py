"""Score an existing demand model against a seasonal-naive baseline.

Uses the held-out test features from the persisted verified pipeline. No
model is retrained and no canonical evidence is overwritten.
"""
from __future__ import annotations
import argparse,csv,json,os,sys,time
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error,mean_squared_error,r2_score
import joblib

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'/'spark'))
from common import spark

def metrics(y,p):
    return {'rmse':float(mean_squared_error(y,p)**.5),'mae':float(mean_absolute_error(y,p)),'r2':float(r2_score(y,p))}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',default='results/ml/gap1',help='local evidence directory; choose a new directory to preserve previous evidence')
    parser.add_argument('--case-count',type=int,default=500)
    parser.add_argument('--sampling',choices=('first','evenly-spaced'),default='first')
    parser.add_argument('--python-model-dir', default='results/ml/python')
    args=parser.parse_args()
    if args.case_count<1: raise SystemExit('--case-count must be positive')
    began=time.perf_counter(); os.environ['HADOOP_USER_NAME']='hadoop'; os.environ['PYSPARK_PYTHON']=sys.executable
    sp=spark('DineIQ-Demand-Baseline-Evidence'); sp.sparkContext.setLogLevel('ERROR')
    try:
        base='hdfs://localhost:9000/dineq'; features=sp.read.parquet(base+'/features/v1/hourly_demand')
        test=features.where("hour_start >= timestamp('2026-06-01 00:00:00')").cache()
        from pyspark.ml import PipelineModel
        spark_model=PipelineModel.load(base+'/models/v1/selected_demand_model')
        scored=spark_model.transform(test).select('restaurant_id','hour_start','order_count','lag_168h','prediction')
        spark_rows=scored.orderBy('hour_start','restaurant_id').toPandas()
        y=spark_rows['order_count'].to_numpy(dtype=float); baseline=spark_rows['lag_168h'].to_numpy(dtype=float); spark_pred=spark_rows['prediction'].to_numpy(dtype=float)
        python_root=ROOT/args.python_model_dir
        p=json.loads((python_root/'pipeline.json').read_text(encoding='utf-8'))
        py_model=joblib.load(python_root/'selected_model.joblib')
        # Fetch canonical numeric lag/calendar features in the same key order.
        py_frame=(test.select('restaurant_id','hour_start','lag_1h','lag_24h','lag_168h','hour_of_day','month')
                  .orderBy('hour_start','restaurant_id').toPandas())
        py_frame['day_of_week']=pd.to_datetime(py_frame.hour_start).dt.dayofweek.astype(float)
        aligned=p.get('weekday_convention')=='sunday-zero'
        if aligned:
            py_frame['day_of_week']=(py_frame['day_of_week']+1)%7
            from python_demand import make_dataset
            independent,_,_,heldout=make_dataset(ROOT/'data/generated/orders.csv','sunday-zero')
            independent=independent.loc[heldout].sort_values(['hour_start','restaurant_id']).reset_index(drop=True)
            numeric=['lag_1h','lag_24h','lag_168h','hour_of_day','month','day_of_week']
            if not (independent.restaurant_id.tolist()==py_frame.restaurant_id.tolist()
                    and independent.hour_start.tolist()==py_frame.hour_start.tolist()
                    and np.array_equal(independent[numeric].to_numpy(),py_frame[numeric].to_numpy())
                    and np.array_equal(independent.order_count.to_numpy(),y)):
                raise ValueError('Independent Python/Spark held-out panels do not match')
            py_frame=independent
        py_frame['hour_of_day']=pd.to_datetime(py_frame.hour_start).dt.hour.astype(float)
        py_frame['month']=pd.to_datetime(py_frame.hour_start).dt.month.astype(float)
        py_pred=py_model.predict(py_frame[['restaurant_id','hour_of_day','day_of_week','month','lag_1h','lag_24h','lag_168h']])
        s=json.loads((ROOT/'results'/'ml'/'spark'/'pipeline.json').read_text(encoding='utf-8'))
        out=Path(args.output_dir); out=out if out.is_absolute() else ROOT/out; out.mkdir(parents=True,exist_ok=True)
        n=min(args.case_count,len(spark_rows))
        if args.sampling=='evenly-spaced':
            indices=np.linspace(0,len(spark_rows)-1,n,dtype=np.int64)
        else:
            indices=np.arange(n,dtype=np.int64)
        differences=spark_pred[indices]-py_pred[indices]
        absolute_differences=np.abs(differences)
        agreement_tolerances=(.5,1.0,2.0)
        agreement_rates={str(tolerance):float(np.mean(absolute_differences<=tolerance)*100) for tolerance in agreement_tolerances}
        keyed=[]
        for i in indices:
            row=spark_rows.iloc[int(i)]
            difference=float(spark_pred[i]-py_pred[i])
            keyed.append({'record_id':f'{row.restaurant_id}@{row.hour_start}','restaurant_id':str(row.restaurant_id),'hour_start':str(row.hour_start),'actual':float(y[i]),'spark_prediction':float(spark_pred[i]),'python_prediction':float(py_pred[i]),'spark_minus_python':difference,'absolute_difference':abs(difference),'agreement_tolerance_orders':1.0,'match_status':'WITHIN_ONE_ORDER' if abs(difference)<=1.0 else 'DIFFERS_BY_MORE_THAN_ONE_ORDER','spark_probability':None,'python_probability':None})
        worst=sorted(keyed,key=lambda case:case['absolute_difference'],reverse=True)[:10]
        payload={'target':s['target'],'prediction_point':s['prediction_point'],'baseline':'seasonal naive: same restaurant and hour-of-week at lag 168 hours','test_period':'2026-06-01 through 2026-08-31','test_rows':len(spark_rows),'split':'same chronological untouched Spark held-out test interval','baseline_metrics':metrics(y,baseline),'spark_selected_model':s['selected_model'],'spark_test_metrics_recomputed':metrics(y,spark_pred),'python_selected_model':p['selected_model'],'python_test_metrics_as_saved':p['test_metrics'],'python_test_metrics_on_common_feature_panel':metrics(y,py_pred),'feature_semantics_note':'Spark training day_of_week maps Sunday=0; Python training uses pandas Monday=0. Python inference here uses its native Monday=0 convention. Both models independently score the same underlying held-out records and target, so per-case outputs are comparable descriptively but not a controlled feature-equivalent model comparison.','spark_model_retrained':False,'python_model_retrained':False,'models_retrained':False,'predictions_generated_independently':True,'confidence_or_probability_supported':False,'confidence_note':'Both selected models are point regression estimators; the saved pipelines do not emit calibrated prediction probabilities or intervals.','case_sampling_method':args.sampling,'row_level_cases':keyed,'row_level_case_count':len(keyed),'agreement_definition':'A case is within tolerance when absolute Spark/Python order-count prediction difference is <= 1.0 order; the report also gives 0.5 and 2.0 order sensitivity rates. This is a descriptive consistency band, not a model-accuracy criterion.','agreement_rates_percent_by_tolerance_orders':agreement_rates,'overall_agreement_percentage':agreement_rates['1.0'],'overall_disagreement_percentage':100.0-agreement_rates['1.0'],'difference_summary_orders':{'mean_absolute':float(np.mean(absolute_differences)),'median_absolute':float(np.median(absolute_differences)),'p90_absolute':float(np.quantile(absolute_differences,.90)),'maximum_absolute':float(np.max(absolute_differences)),'mean_signed_spark_minus_python':float(np.mean(differences))},'major_disagreements':worst,'major_disagreement_explanation':'Differences cannot be attributed to model algorithm alone: Spark encodes Sunday=0 while Python uses Monday=0, and inference retains each saved model native training convention. Models were not retrained or cross-fed predictions.','mean_absolute_prediction_difference_sample':float(np.mean(absolute_differences)),'elapsed_seconds':round(time.perf_counter()-began,3)}
        if aligned:
            payload.update(feature_semantics_note='Both models use Sunday=0. Independently prepared pandas and Spark held-out keys, targets and every numeric feature match exactly over 55,200 rows. This separately retrained Python model does not replace the historical Monday=0 artifact.',
                           feature_equivalent=True, independent_panel_verified=True,
                           python_model_path=str(python_root.relative_to(ROOT)).replace('\\','/')+'/selected_model.joblib',
                           python_model_retrained=True, models_retrained='python_only_for_aligned_evidence',
                           major_disagreement_explanation='Common keys, targets and feature values are verified. Residual disagreement reflects separately trained estimators and preprocessing; tolerance agreement does not prove business impact.')
        (out/'demand_model_comparison.json').write_text(json.dumps(payload,indent=2),encoding='utf-8')
        with (out/'demand_model_comparison_cases.csv').open('w',newline='',encoding='utf-8') as f:
            w=csv.DictWriter(f,fieldnames=list(keyed[0])); w.writeheader(); w.writerows(keyed)
        (out/'demand_model_major_disagreements.csv').write_text('record_id,actual,spark_prediction,python_prediction,spark_minus_python,absolute_difference,match_status\n'+'\n'.join(','.join(str(case[key]) for key in ('record_id','actual','spark_prediction','python_prediction','spark_minus_python','absolute_difference','match_status')) for case in worst)+'\n',encoding='utf-8')
        print(json.dumps({'test_rows':len(spark_rows),'baseline':payload['baseline_metrics'],'spark':payload['spark_test_metrics_recomputed'],'python_common_panel':payload['python_test_metrics_on_common_feature_panel'],'cases':len(keyed),'agreement_rates_percent_by_tolerance_orders':agreement_rates,'output_dir':str(out),'elapsed_seconds':payload['elapsed_seconds']},indent=2))
        test.unpersist()
    finally: sp.stop()
if __name__=='__main__': main()
