"""Export small versioned Spark v4-gap menu table for independent comparison."""
import argparse,csv,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import spark
ROOT=Path(__file__).resolve().parents[2]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--version',default='v5');version=ap.parse_args().version
    s=spark('DineIQ-Gap1-Menu-Export'); s.sparkContext.setLogLevel('ERROR')
    try:
        df=s.read.parquet(f'hdfs://localhost:9000/dineq/results/gap1/{version}/menu_profitability').orderBy('menu_item_id')
        rows=[r.asDict(recursive=True) for r in df.collect()]
        target=ROOT/'results'/'analytics'/'gap1'/version;target.mkdir(parents=True,exist_ok=True)
        path=target/'spark_menu_profitability.csv'
        with path.open('w',newline='',encoding='utf-8') as f:
            w=csv.DictWriter(f,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
        print(json.dumps({'path':str(path),'rows':len(rows),'columns':list(rows[0])}))
    finally:s.stop()
if __name__=='__main__':main()
