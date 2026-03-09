import pandas as pd
from prophet import Prophet
import mlflow
import mlflow.prophet
from sklearn.metrics import mean_absolute_error, mean_squared_error
from math import sqrt
import argparse

def main(data_path, forecast_days=30):
    # Set tracking URI
    mlflow.set_tracking_uri("http://127.0.0.1:5000")

    # Read data
    df = pd.read_csv(data_path)
    df['ds'] = pd.to_datetime(df['Date']).dt.tz_localize(None)
    df['y'] = df['Close']
    df = df[['ds', 'y']]

    # Train/test split
    train = df.iloc[:-forecast_days]
    test = df.iloc[-forecast_days:]

    with mlflow.start_run():
        # Train Prophet model
        model = Prophet()
        model.fit(train)

        # Forecast on test set
        forecast = model.predict(test[['ds']])

        # Metrics
        y_true = test['y'].values
        y_pred = forecast['yhat'].values

        mae = mean_absolute_error(y_true, y_pred)
        rmse = sqrt(mean_squared_error(y_true, y_pred))

        print(f"MAE: {mae}, RMSE: {rmse}")

        # Log parameters and metrics
        mlflow.log_param("forecast_days", forecast_days)
        mlflow.log_metric("mae", mae)
        mlflow.log_metric("rmse", rmse)

        # Log model
        mlflow.prophet.log_model(model, artifact_path="model")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_path", required=True)
    parser.add_argument("--forecast_days", type=int, default=30)
    args = parser.parse_args()
    main(args.data_path, args.forecast_days)
