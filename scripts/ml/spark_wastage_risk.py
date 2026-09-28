"""Time-safe weekly high-wastage risk prediction using canonical v4 inputs."""
from __future__ import annotations
import json,os,sys,time
from datetime import datetime,timezone
from pathlib import Path
from pyspark.sql import functions as F,Window
from pyspark.ml import Pipeline
from pyspark.ml.feature import StringIndexer,OneHotEncoder,VectorAssembler
from pyspark.ml.classification import LogisticRegression,RandomForestClassifier,GBTClassifier
from pyspark.ml.evaluation import BinaryClassificationEvaluator
from pyspark.ml.functions import vector_to_array,array_to_vector
ROOT=Path(__file__).resolve().parents[2]
os.environ['HADOOP_USER_NAME']='hadoop';os.environ['PYSPARK_PYTHON']=sys.executable
os.environ.setdefault('JAVA_TOOL_OPTIONS','-XX:ActiveProcessorCount=2 -XX:CICompilerCount=2')
sys.path.insert(0,str(ROOT/'scripts'/'spark'))
from common import spark,save_json,HDFS,PROCESSED

CUT_TRAIN='2026-04-01'; CUT_TEST='2026-06-01'; SEED=42
NUMERIC=['waste_qty_lag_1w','waste_cost_lag_1w','waste_cost_mean_prev4w','waste_cost_mean_prev12w','demand_units_lag_1w','demand_mean_prev4w','demand_mean_prev12w','target_month','target_weekofyear']
FEATURES=['restaurant_id','category_id']+NUMERIC
LEAKAGE=['current/target-week wastage records','future wastage cost or quantity','same-week demand/inventory/production/stock updates','synthetic customers.is_churned','wastage reason observed after the prediction point']

def confusion_and_metrics(frame,threshold):
    scored=frame.withColumn('predicted',(F.col('probability_positive')>=F.lit(float(threshold))).cast('int'))
    c=scored.agg(F.sum(F.when((F.col('label')==1)&(F.col('predicted')==1),1).otherwise(0)).alias('tp'),F.sum(F.when((F.col('label')==0)&(F.col('predicted')==1),1).otherwise(0)).alias('fp'),F.sum(F.when((F.col('label')==1)&(F.col('predicted')==0),1).otherwise(0)).alias('fn'),F.sum(F.when((F.col('label')==0)&(F.col('predicted')==0),1).otherwise(0)).alias('tn')).first().asDict()
    tp,fp,fn,tn=[int(c[x] or 0) for x in ('tp','fp','fn','tn')]
    precision=tp/(tp+fp) if tp+fp else 0.;recall=tp/(tp+fn) if tp+fn else 0.;f1=2*precision*recall/(precision+recall) if precision+recall else 0.;total=tp+fp+fn+tn
    auc=BinaryClassificationEvaluator(labelCol='label',rawPredictionCol='rawPrediction',metricName='areaUnderROC').evaluate(scored)
    pr=BinaryClassificationEvaluator(labelCol='label',rawPredictionCol='rawPrediction',metricName='areaUnderPR').evaluate(scored)
    return {'accuracy':(tp+tn)/total if total else 0.,'precision':precision,'recall':recall,'f1':f1,'roc_auc':float(auc),'pr_auc':float(pr),'confusion_matrix':{'tn':tn,'fp':fp,'fn':fn,'tp':tp}}

def score_validation(frame):
    best={'threshold':.5,'f1':-1.}
    for threshold in [i/100 for i in range(5,96,5)]:
        pred=frame.withColumn('predicted',(F.col('probability_positive')>=threshold).cast('int'))
        c=pred.agg(F.sum(F.when((F.col('label')==1)&(F.col('predicted')==1),1).otherwise(0)).alias('tp'),F.sum(F.when((F.col('label')==0)&(F.col('predicted')==1),1).otherwise(0)).alias('fp'),F.sum(F.when((F.col('label')==1)&(F.col('predicted')==0),1).otherwise(0)).alias('fn')).first()
        tp,fp,fn=[int(c[x] or 0) for x in ('tp','fp','fn')];p=tp/(tp+fp) if tp+fp else 0.;r=tp/(tp+fn) if tp+fn else 0.;f=2*p*r/(p+r) if p+r else 0.
        if (f,r,p)> (best['f1'],best.get('recall',-1),best.get('precision',-1)):best={'threshold':threshold,'f1':f,'recall':r,'precision':p}
    return best

def main():
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('--version',default='v2');version=ap.parse_args().version
    if not version.startswith('v') or not version[1:].isdigit(): raise SystemExit('--version must be vN')
    began=time.perf_counter();sp=spark('DineIQ-SparkMLlib-WastageRisk',master='local[2]',shuffle_partitions=4);sp.sparkContext.setLogLevel('WARN')
    try:
        base=f'{HDFS}/dineq'; processed=f'{PROCESSED}/v4'
        orders=sp.read.parquet(processed+'/orders').where(F.col('order_status')=='Completed').select('order_id','order_datetime','restaurant_id')
        lines=sp.read.parquet(processed+'/order_items').where((F.col('quantity')>0)&F.col('menu_item_id').isNotNull()).select('order_id','menu_item_id','quantity')
        menu=sp.read.parquet(processed+'/menu_items').select('menu_item_id','category_id')
        rests=sp.read.parquet(processed+'/restaurants').select('restaurant_id').distinct()
        weeks=sp.sql("SELECT explode(sequence(to_date('2025-02-24'),to_date('2026-08-31'),interval 7 days)) week_start")
        demand=(lines.join(orders,'order_id').join(menu,'menu_item_id').withColumn('week_start',F.to_date(F.date_trunc('week','order_datetime')))
          .groupBy('restaurant_id','menu_item_id','category_id','week_start').agg(F.sum('quantity').cast('double').alias('demand_units')))
        waste=sp.read.parquet(processed+'/wastage').where((F.col('quantity_wasted')>=0)&(F.col('wastage_cost')>=0))
        waste=(waste.withColumn('week_start',F.to_date(F.date_trunc('week','wastage_date'))).groupBy('restaurant_id','menu_item_id','week_start')
          .agg(F.sum('quantity_wasted').cast('double').alias('waste_qty'),F.sum('wastage_cost').cast('double').alias('waste_cost')))
        combos=rests.crossJoin(menu).crossJoin(weeks)
        panel=(combos.join(demand,['restaurant_id','menu_item_id','category_id','week_start'],'left').join(waste,['restaurant_id','menu_item_id','week_start'],'left')
          .fillna({'demand_units':0.,'waste_qty':0.,'waste_cost':0.}))
        win=Window.partitionBy('restaurant_id','menu_item_id').orderBy('week_start')
        past4=win.rowsBetween(-4,-1);past12=win.rowsBetween(-12,-1)
        panel=(panel.withColumn('waste_qty_lag_1w',F.lag('waste_qty',1).over(win)).withColumn('waste_cost_lag_1w',F.lag('waste_cost',1).over(win))
          .withColumn('waste_cost_mean_prev4w',F.avg('waste_cost').over(past4)).withColumn('waste_cost_mean_prev12w',F.avg('waste_cost').over(past12))
          .withColumn('demand_units_lag_1w',F.lag('demand_units',1).over(win)).withColumn('demand_mean_prev4w',F.avg('demand_units').over(past4)).withColumn('demand_mean_prev12w',F.avg('demand_units').over(past12))
          .withColumn('target_week',F.date_add('week_start',7)).withColumn('target_month',F.month('target_week').cast('double')).withColumn('target_weekofyear',F.weekofyear('target_week').cast('double'))
          .withColumn('future_waste_cost',F.lead('waste_cost',1).over(win)).where(F.col('future_waste_cost').isNotNull())
          .where(F.col('waste_cost_mean_prev12w').isNotNull()).cache())
        q=panel.where(F.col('target_week')<F.lit(CUT_TRAIN).cast('date')).where(F.col('future_waste_cost')>0).approxQuantile('future_waste_cost',[.75],.01)
        if not q or q[0]<=0: raise RuntimeError('No positive training future-wastage support for a high-risk threshold.')
        target_cut=float(q[0])
        data=panel.withColumn('label',(F.col('future_waste_cost')>=target_cut).cast('int')).withColumn('observation_weight',F.lit(1.0))
        train=data.where(F.col('target_week')<F.lit(CUT_TRAIN).cast('date')).cache()
        val=data.where((F.col('target_week')>=F.lit(CUT_TRAIN).cast('date'))&(F.col('target_week')<F.lit(CUT_TEST).cast('date'))).cache()
        test=data.where(F.col('target_week')>=F.lit(CUT_TEST).cast('date')).cache()
        train_n,val_n,test_n=train.count(),val.count(),test.count()
        dist={name:{str(r['label']):r['count'] for r in frame.groupBy('label').count().collect()} for name,frame in (('train',train),('validation',val),('test',test))}
        positives=sum(int(x.get('1',0)) for x in dist.values())
        if any('1' not in d or '0' not in d for d in dist.values()): raise RuntimeError(f'Both classes must occur in every time split; observed {dist}')
        rate=int(dist['train']['1'])/train_n; wpos=(1-rate)/rate
        train=train.withColumn('observation_weight',F.when(F.col('label')==1,F.lit(wpos)).otherwise(F.lit(1.0)))
        indexers=[StringIndexer(inputCol='restaurant_id',outputCol='restaurant_index',handleInvalid='keep'),StringIndexer(inputCol='category_id',outputCol='category_index',handleInvalid='keep')]
        encoder=OneHotEncoder(inputCols=['restaurant_index','category_index'],outputCols=['restaurant_vec','category_vec'],handleInvalid='keep')
        assembler=VectorAssembler(inputCols=['restaurant_vec','category_vec']+NUMERIC,outputCol='features',handleInvalid='error')
        models=[('logistic_regression',LogisticRegression(featuresCol='features',labelCol='label',weightCol='observation_weight',maxIter=30,regParam=.05,elasticNetParam=0.0)),
          ('random_forest',RandomForestClassifier(featuresCol='features',labelCol='label',weightCol='observation_weight',numTrees=15,maxDepth=6,featureSubsetStrategy='sqrt',seed=SEED)),
          ('gradient_boosted_trees',GBTClassifier(featuresCol='features',labelCol='label',weightCol='observation_weight',maxIter=10,maxDepth=2,stepSize=.1,subsamplingRate=.8,seed=SEED))]
        comparison={};fitted={}
        for name,est in models:
            pipe=Pipeline(stages=indexers+[encoder,assembler,est]);model=pipe.fit(train);vp=model.transform(val).withColumn('probability_positive',vector_to_array('probability')[1]).cache()
            threshold=score_validation(vp);comparison[name]={'validation_pr_auc':float(BinaryClassificationEvaluator(labelCol='label',rawPredictionCol='rawPrediction',metricName='areaUnderPR').evaluate(vp)),'validation_roc_auc':float(BinaryClassificationEvaluator(labelCol='label',rawPredictionCol='rawPrediction',metricName='areaUnderROC').evaluate(vp)),'validation_threshold_selected_by_f1':threshold,'hyperparameters':{p.name:v for p,v in est.extractParamMap().items()}}
            fitted[name]=model;vp.unpersist();print('VALIDATION',name,comparison[name],flush=True)
        selected=max(comparison,key=lambda n:(comparison[n]['validation_pr_auc'],comparison[n]['validation_threshold_selected_by_f1']['f1']))
        chosen=dict(models)[selected];weighted_val=val.withColumn('observation_weight',F.when(F.col('label')==1,F.lit(wpos)).otherwise(F.lit(1.0)))
        final=Pipeline(stages=indexers+[encoder,assembler,chosen]).fit(train.unionByName(weighted_val));threshold=comparison[selected]['validation_threshold_selected_by_f1']['threshold']
        raw=final.transform(test).withColumn('probability_positive',vector_to_array('probability')[1]).cache()
        test_metrics=confusion_and_metrics(raw,threshold)
        baseline=(test.withColumn('probability_positive',F.lit(0.0)).withColumn('rawPrediction',array_to_vector(F.array(F.lit(1.0),F.lit(0.0)))))
        baseline_metrics=confusion_and_metrics(baseline,.5)
        result_version=f'v{int(version[1:])+7}'
        model_root=f'{base}/models/gap1/{version}/wastage_risk';feature_root=f'{base}/features/gap1/{version}/wastage_risk';result_root=f'{base}/results/gap1/{result_version}/wastage_risk'
        final.write().save(model_root)
        data.select('restaurant_id','menu_item_id','category_id','week_start','target_week','label',*NUMERIC).write.mode('errorifexists').parquet(feature_root)
        raw.select('restaurant_id','menu_item_id','category_id','week_start','target_week','label','probability_positive','prediction').write.mode('errorifexists').parquet(f'{result_root}/test_predictions')
        from pyspark.ml import PipelineModel
        loaded=PipelineModel.load(model_root);smoke=loaded.transform(test.limit(16)).where(F.col('probability').isNotNull()).count()
        selected_meta={'problem':'weekly high-wastage risk classification','target_definition':f'1 when item/location total wastage cost in the next Monday-start week is >= training-only p75 ({target_cut}) of positive training weeks; otherwise 0','prediction_point':'At the start of each prediction week, prior completed weeks only; target week calendar is known.','target_week_definition':'Prediction row at week_start t predicts wastage aggregated during target_week=t+7 days.','features':FEATURES,'feature_semantics':{'waste lags':'prior observed weekly waste quantities/costs; zero-filled missing weeks','demand lags':'prior completed-order item quantities; zero-filled missing weeks','calendar':'target-week month and ISO week number','categorical':'restaurant and menu category'},'leakage_exclusions':LEAKAGE,'source':f'{PROCESSED}/v4/{"wastage,orders,order_items,menu_items,restaurants"}','panel_rows':data.count(),'split':{'train':train_n,'validation':val_n,'test':test_n,'boundary_by_target_week':{'train':f'<{CUT_TRAIN}','validation':f'[{CUT_TRAIN},{CUT_TEST})','test':f'>={CUT_TEST}'},'class_distribution':dist},'seed':SEED,'threshold_selection':'Validation F1 over probability cutoffs 0.05..0.95; model selection by validation PR-AUC, then validation F1; test not used for selection.','models':comparison,'selected_model':selected,'selected_threshold':threshold,'test_metrics':test_metrics,'majority_baseline_test_metrics':baseline_metrics,'model_path':model_root,'feature_path':feature_root,'test_prediction_path':f'{result_root}/test_predictions','reload_smoke':{'rows_with_probability':smoke,'expected':16,'passed':smoke==16},'versions':{'spark':sp.version},'timestamp_utc':datetime.now(timezone.utc).isoformat(),'elapsed_seconds':round(time.perf_counter()-began,3),'limitations':'Generated synthetic data; weekly risk classification identifies association/predicted risk, not causal drivers. Burden thresholds refer to cost source units without currency definition.'}
        local=ROOT/'results'/'analytics'/'gap1'/f'wastage_risk_{version}';local.mkdir(parents=True,exist_ok=True)
        selected_meta['test_sample_predictions']=[r.asDict(recursive=True) for r in raw.orderBy('target_week','restaurant_id','menu_item_id').limit(100).collect()]
        save_json(local/'pipeline.json',selected_meta);sp.createDataFrame([(json.dumps(selected_meta,default=str),)],['evidence_json']).write.mode('errorifexists').text(f'{result_root}/pipeline_evidence');print(json.dumps({'selected_model':selected,'test_metrics':test_metrics,'baseline':baseline_metrics,'split':selected_meta['split'],'target_cut':target_cut,'model_path':model_root,'reload_smoke':selected_meta['reload_smoke'],'elapsed_seconds':selected_meta['elapsed_seconds'],'evidence':str(local/'pipeline.json')},indent=2,default=str))
        raw.unpersist();panel.unpersist();train.unpersist();val.unpersist();test.unpersist()
    finally:sp.stop()
if __name__=='__main__':main()
