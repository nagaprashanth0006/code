"""Load the saved pipeline, infer Kafka records, and report cumulative live metrics."""
import argparse
from collections import Counter
import json
from pathlib import Path
import time
import warnings

from confluent_kafka import Consumer, KafkaException
import joblib
import numpy as np
import pandas as pd
from sklearn.exceptions import InconsistentVersionWarning

ROOT = Path(__file__).resolve().parents[1]


def predict_event(event, model, metadata, threshold):
    if not isinstance(event, dict) or not isinstance(event.get("features"), dict):
        raise ValueError("Expected an object containing a features object")
    raw = event["features"]
    values, notices = {}, []
    for name in metadata["numeric_features"]:
        value = raw.get(name)
        if value is None:
            values[name] = np.nan
            notices.append(f"{name} missing/imputed")
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value):
                raise ValueError(f"{name} must be a finite number or null")
            values[name] = value
    if all(pd.isna(values[name]) for name in metadata["numeric_features"]):
        raise ValueError("All numeric sensors are missing")
    categories = model.named_steps["preprocessing"].named_transformers_["category"].named_steps["encoder"].categories_
    for name, known in zip(metadata["categorical_features"], categories):
        value = raw.get(name)
        if value is None:
            values[name] = np.nan
            notices.append(f"{name} missing/imputed")
        elif not isinstance(value, str):
            raise ValueError(f"{name} must be a string or null")
        else:
            values[name] = value
            if value not in known:
                notices.append(f"{name} unknown category")
    # Only the allowlisted features enter the model. Labels and IDs never do.
    frame = pd.DataFrame([values], columns=metadata["features"])
    probability = float(model.predict_proba(frame)[0, list(model.classes_).index(1)])
    actual = event.get("actual")
    if actual is not None and (type(actual) is not int or actual not in (0, 1)):
        raise ValueError("actual must be integer 0/1 or absent")
    return probability, int(probability >= threshold), actual, notices


def metrics_text(counts):
    tp, tn, fp, fn = (counts[k] for k in ["tp", "tn", "fp", "fn"])
    n = tp + tn + fp + fn
    def ratio(a, b):
        return f"{a / b:.3f}" if b else "n/a"
    return (f"labeled={n} accuracy={ratio(tp+tn, n)} precision={ratio(tp, tp+fp)} "
            f"recall={ratio(tp, tp+fn)} F1={ratio(2*tp, 2*tp+fp+fn)} "
            f"TP={tp} TN={tn} FP={fp} FN={fn} "
            f"unlabeled={counts['unlabeled']} skipped={counts['skipped']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bootstrap-servers", default="localhost:9092")
    parser.add_argument("--topic", default="machine.telemetry")
    parser.add_argument("--group-id", default="ai4i-live")
    parser.add_argument("--offset", choices=["earliest", "latest"], default="earliest",
                        help="Used only if this group has no committed offset")
    parser.add_argument("--model", type=Path, default=ROOT / "artifacts/machine_failure_pipeline.joblib")
    parser.add_argument("--metadata", type=Path, default=ROOT / "artifacts/machine_failure_metadata.json")
    parser.add_argument("--threshold", type=float, help="Default: saved validation-selected threshold")
    parser.add_argument("--metrics-every", type=int, default=20)
    parser.add_argument("--print-every", type=int, default=1)
    parser.add_argument("--max-messages", type=int, default=0, help="0 consumes forever; includes skipped records")
    parser.add_argument("--idle-timeout", type=float, default=0, help="Exit after N seconds without messages; 0 disables")
    args = parser.parse_args()
    if min(args.metrics_every, args.print_every) < 1 or args.max_messages < 0 or not np.isfinite(args.idle_timeout) or args.idle_timeout < 0:
        parser.error("Intervals must be positive; max-messages and idle-timeout must be >= 0")
    if not args.model.exists() or not args.metadata.exists():
        parser.error("Run src/reference.ipynb through model export first.")
    metadata = json.loads(args.metadata.read_text())
    threshold = metadata["threshold"] if args.threshold is None else args.threshold
    if not np.isfinite(threshold) or not 0 <= threshold <= 1:
        parser.error("threshold must be between 0 and 1")
    # Load only trusted artifacts and use the same sklearn version as training.
    with warnings.catch_warnings():
        warnings.simplefilter("error", InconsistentVersionWarning)
        model = joblib.load(args.model)
    if list(model.feature_names_in_) != metadata["features"]:
        raise ValueError("Model and metadata feature schemas do not match")
    # Small single-record inference is faster without spawning forest worker threads.
    model.named_steps["model"].n_jobs = 1
    consumer = Consumer({"bootstrap.servers": args.bootstrap_servers,
                         "group.id": args.group_id, "auto.offset.reset": args.offset,
                         "enable.auto.commit": False})
    counts = Counter()
    received = 0
    last_message = time.monotonic()
    try:
        consumer.list_topics(args.topic, timeout=10)
        consumer.subscribe([args.topic])
        print(f"Listening: {args.topic} | group={args.group_id} | threshold={threshold:.2f} | Ctrl+C stops", flush=True)
        while not args.max_messages or received < args.max_messages:
            message = consumer.poll(1)
            if message is None:
                if args.idle_timeout and time.monotonic() - last_message >= args.idle_timeout:
                    print("Idle timeout reached.", flush=True)
                    break
                continue
            if message.error():
                raise KafkaException(message.error())
            last_message = time.monotonic()
            received += 1
            try:
                event = json.loads(message.value())
                probability, prediction, actual, notices = predict_event(event, model, metadata, threshold)
            except (ValueError, TypeError, UnicodeDecodeError) as exc:
                counts["skipped"] += 1
                print(f"SKIP offset={message.offset()}: {exc}", flush=True)
            else:
                if actual is None:
                    counts["unlabeled"] += 1
                else:
                    counts[{(1, 1): "tp", (0, 0): "tn", (0, 1): "fp", (1, 0): "fn"}[(actual, prediction)]] += 1
                if received % args.print_every == 0:
                    print(f"{event.get('machine_id', '?')} | p_failure={probability:.3f} | "
                          f"{'FAILURE' if prediction else 'NORMAL'} | actual={actual} | "
                          f"{' ; '.join(notices)}", flush=True)
            # Demo policy: also commit malformed messages after visibly skipping them.
            consumer.commit(message=message, asynchronous=False)
            if received % args.metrics_every == 0:
                print("METRICS | " + metrics_text(counts), flush=True)
    except KeyboardInterrupt:
        print("Stopping consumer...", flush=True)
    finally:
        consumer.close()
        print("FINAL | " + metrics_text(counts), flush=True)


if __name__ == "__main__":
    main()
