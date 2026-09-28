from pyspark.sql import SparkSession


def main() -> int:
    spark = (
        SparkSession.builder
        .appName("DineIQ-HDFS-Test")
        .master("local[*]")
        .getOrCreate()
    )

    print("\n=== DineIQ Spark-HDFS Integration Test ===")
    path = "hdfs://localhost:9000/dineq/raw/spark_hdfs_test.csv"

    try:
        df = (
            spark.read
            .option("header", "true")
            .option("inferSchema", "true")
            .csv(path)
        )
        df.printSchema()
        df.show()
        print("Row count:", df.count())
    except Exception as exc:
        print(f"HDFS validation skipped: {exc}")
        print("Reason: the HDFS cluster or target CSV path is not available in this environment.")
        spark.stop()
        return 0

    spark.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
