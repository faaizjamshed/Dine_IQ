"""Persist final Spark ML evidence JSON into the requested HDFS result hierarchy."""
from pathlib import Path
import os,sys
ROOT=Path(__file__).resolve().parents[2]
os.environ["PYSPARK_PYTHON"]=sys.executable
sys.path.insert(0,str(ROOT/"scripts"/"spark"))
from common import spark

def main():
    payload=(ROOT/"results/ml/spark/pipeline.json").read_text(encoding="utf-8")
    sp=spark("DineIQ-ML-Evidence-Publish"); sp.sparkContext.setLogLevel("ERROR")
    try:
        dest="hdfs://localhost:9000/dineq/results/ml/v1/pipeline_evidence_final"
        uri=sp._jvm.java.net.URI(dest)
        fs=sp._jvm.org.apache.hadoop.fs.FileSystem.get(uri,sp._jsc.hadoopConfiguration())
        path=sp._jvm.org.apache.hadoop.fs.Path(dest)
        if fs.exists(path): raise RuntimeError(f"Refusing to overwrite existing HDFS evidence: {dest}")
        sp.sparkContext.parallelize([payload],1).saveAsTextFile(dest)
        print(f"Persisted Spark ML evidence to {dest}",flush=True)
    finally: sp.stop()
if __name__=="__main__": main()
