@REM mlflow run . -P data_path="csvs/SBIN.NS.csv" -P forecast_days=30
python train.py --data_path "csvs/SBIN.NS.csv" --forecast_days 30
