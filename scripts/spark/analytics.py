"""Reusable Spark SQL and analytical outputs over cleaned HDFS Parquet."""
from __future__ import annotations
import argparse,json,time
from pyspark.sql import functions as F
from pyspark import StorageLevel
from common import LOCAL_EVIDENCE,PROCESSED,HDFS,save_json,spark

def main():
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument("--version",default="v3",help="processed/output version to read and write")
    version=parser.parse_args().version
    if not version.startswith("v") or not version[1:].isdigit(): raise SystemExit("--version must be v followed by a number")
    sp=spark("DineIQ-SQL-Analytics"); started=time.perf_counter(); root=f"{HDFS}/dineq/results/{version}"
    try:
        names=["orders","order_items","menu_items","menu_categories","restaurants","customers","promotions","ratings","wastage","pricing_history","inventory"]
        for name in names: sp.read.parquet(f"{PROCESSED}/{version}/{name}").createOrReplaceTempView(name)
        queries={
          "menu_item_performance":"""SELECT m.menu_item_id,m.item_name,c.category_name,COUNT(DISTINCT o.order_id) order_count,SUM(i.quantity) units_sold,ROUND(SUM(i.line_total),2) gross_sales,ROUND(AVG(i.unit_price),2) avg_unit_price FROM order_items i JOIN orders o ON i.order_id=o.order_id JOIN menu_items m ON i.menu_item_id=m.menu_item_id JOIN menu_categories c ON m.category_id=c.category_id WHERE o.order_status='Completed' GROUP BY m.menu_item_id,m.item_name,c.category_name""",
          "category_performance":"""SELECT c.category_name,COUNT(DISTINCT o.order_id) order_count,SUM(i.quantity) units_sold,ROUND(SUM(i.line_total),2) gross_sales,ROUND(AVG(i.line_total),2) avg_line_value FROM order_items i JOIN orders o ON i.order_id=o.order_id JOIN menu_items m ON i.menu_item_id=m.menu_item_id JOIN menu_categories c ON m.category_id=c.category_id WHERE o.order_status='Completed' GROUP BY c.category_name""",
          "restaurant_performance":"""SELECT r.restaurant_id,r.restaurant_name,r.city,COUNT(DISTINCT o.order_id) order_count,ROUND(SUM(o.final_amount),2) revenue,ROUND(AVG(o.final_amount),2) avg_order_value FROM orders o JOIN restaurants r ON o.restaurant_id=r.restaurant_id WHERE o.order_status='Completed' GROUP BY r.restaurant_id,r.restaurant_name,r.city""",
          "channel_performance":"""SELECT ordering_channel,COUNT(*) orders,ROUND(AVG(final_amount),2) avg_order_value,ROUND(SUM(final_amount),2) completed_revenue FROM orders WHERE order_status='Completed' GROUP BY ordering_channel""",
          "promotion_effectiveness":"""SELECT p.promotion_id,p.promotion_name,COUNT(o.order_id) used_orders,ROUND(AVG(o.subtotal),2) avg_subtotal,ROUND(AVG(o.discount_amount),2) avg_discount,ROUND(SUM(o.final_amount),2) final_revenue FROM promotions p LEFT JOIN orders o ON p.promotion_id=o.promotion_id AND o.order_status='Completed' GROUP BY p.promotion_id,p.promotion_name""",
          "monthly_demand":"""SELECT order_month,COUNT(*) total_orders,SUM(CASE WHEN order_status='Completed' THEN 1 ELSE 0 END) completed_orders,ROUND(SUM(CASE WHEN order_status='Completed' THEN final_amount ELSE 0 END),2) completed_revenue FROM orders GROUP BY order_month ORDER BY order_month""",
          "weekday_peak_hour":"""SELECT dayofweek(order_datetime) weekday,hour(order_datetime) hour_of_day,COUNT(*) orders,ROUND(AVG(final_amount),2) avg_order_value FROM orders WHERE order_status='Completed' GROUP BY dayofweek(order_datetime),hour(order_datetime)""",
          "customer_segment_behavior":"""SELECT c.customer_segment,COUNT(DISTINCT c.customer_id) customers,COUNT(o.order_id) total_orders,ROUND(AVG(o.final_amount),2) avg_order_value,ROUND(SUM(o.final_amount),2) revenue FROM customers c LEFT JOIN orders o ON c.customer_id=o.customer_id AND o.order_status='Completed' GROUP BY c.customer_segment""",
          "restaurant_ratings":"""SELECT restaurant_id,COUNT(*) rating_count,ROUND(AVG(rating),3) avg_rating,ROUND(AVG(food_rating),3) avg_food_rating,ROUND(AVG(service_rating),3) avg_service_rating FROM ratings GROUP BY restaurant_id""",
          "wastage_by_reason":"""SELECT reason,COUNT(*) records,ROUND(SUM(quantity_wasted),2) quantity_wasted,ROUND(SUM(wastage_cost),2) wastage_cost FROM wastage WHERE quantity_wasted>=0 GROUP BY reason""",
          "pricing_changes":"""SELECT change_reason,COUNT(*) changes,ROUND(AVG(new_price-old_price),2) avg_price_change,ROUND(AVG((new_price-old_price)/NULLIF(old_price,0)*100),2) avg_percent_change FROM pricing_history GROUP BY change_reason""",
          "inventory_status":"""SELECT stock_status,COUNT(*) observations,ROUND(AVG(closing_stock),2) avg_closing_stock FROM inventory GROUP BY stock_status"""
        }
        result={"source":f"{PROCESSED}/{version}","output_root":root,"outputs":{},"sql":queries,"elapsed_seconds":None}
        for name,sql in queries.items():
            df=sp.sql(sql).persist(StorageLevel.MEMORY_AND_DISK); n=df.count(); path=f"{root}/{name}"
            df.write.mode("overwrite").parquet(path)
            preview=[json.loads(s) for s in df.limit(10).toJSON().collect()]
            result["outputs"][name]={"rows":n,"path":path,"schema":df.schema.jsonValue(),"preview":preview}
            print(f"ANALYTIC {name}: {n} rows",flush=True)
            df.unpersist()
        result["elapsed_seconds"]=round(time.perf_counter()-started,3)
        save_json(LOCAL_EVIDENCE/"analytics.json",result)
        sp.createDataFrame([(str(LOCAL_EVIDENCE/"analytics.json"),)],"local_evidence string").write.mode("overwrite").json(f"{root}/_run_evidence")
        print(f"Analytics evidence: {LOCAL_EVIDENCE/'analytics.json'}; elapsed {result['elapsed_seconds']}s",flush=True)
    finally: sp.stop()

if __name__=="__main__": main()
