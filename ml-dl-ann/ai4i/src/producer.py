"""Replay held-out AI4I+ observations through Kafka; labels are evaluation-only."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import uuid

import numpy as np
import pandas as pd
from confluent_kafka import Producer
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]


def load_records(data_path, metadata):
    raw = pd.read_csv(data_path)
    target = metadata["target"]
    required = metadata["features"] + [target]
    missing = set(required) - set(raw.columns)
    if missing:
        raise ValueError(f"Dataset missing columns: {sorted(missing)}")
    if not raw[target].isin([0, 1]).all():
        raise ValueError("Target must contain only 0 and 1")
    # Exactly the split used in reference.ipynb. Keep CSV row order unchanged.
    _, holdout = train_test_split(raw, test_size=.4, stratify=raw[target],
                                 random_state=metadata["seed"])
    _, test = train_test_split(holdout, test_size=.5, stratify=holdout[target],
                              random_state=metadata["seed"])
    return test


def make_event(row, metadata, run_id, sequence):
    features = {name: None if pd.isna(row[name]) else row[name]
                for name in metadata["features"]}
    return {
        "event_id": f"{run_id}:{sequence}", "run_id": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "machine_id": str(row.get("machine_id", "unknown")),
        "source_row": int(row.name), "features": features,
        "actual": int(row[metadata["target"]]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bootstrap-servers", default="localhost:9092")
    parser.add_argument("--topic", default="machine.telemetry")
    parser.add_argument("--data", type=Path, default=ROOT / "data/processed/ai4i_plus.csv")
    parser.add_argument("--metadata", type=Path, default=ROOT / "artifacts/machine_failure_metadata.json")
    parser.add_argument("--rate", type=float, default=5, help="Messages per second (best effort)")
    parser.add_argument("--count", type=int, default=0, help="0 streams forever")
    parser.add_argument("--seed", type=int, default=42, help="Replay ordering only; split seed comes from metadata")
    parser.add_argument("--log-every", type=int, default=100)
    args = parser.parse_args()
    if not np.isfinite(args.rate) or args.rate <= 0 or args.count < 0 or args.log_every < 1:
        parser.error("rate must be positive and finite; count >= 0; log-every >= 1")
    if not args.data.exists() or not args.metadata.exists():
        parser.error("Run src/reference.ipynb through model export first (AI4I+ CSV and metadata required).")
    metadata = json.loads(args.metadata.read_text())
    records = load_records(args.data, metadata)
    rng = np.random.default_rng(args.seed)
    producer = Producer({"bootstrap.servers": args.bootstrap_servers,
                         "enable.idempotence": True, "delivery.timeout.ms": 15000})
    producer.list_topics(args.topic, timeout=10)  # Fail early if the broker is unavailable.
    run_id = uuid.uuid4().hex[:12]
    delivery_errors = []

    def delivered(error, message):
        if error:
            delivery_errors.append(str(error))

    sent = 0
    print(f"Run={run_id} | {len(records)} test rows | {args.rate:g} msg/s | Ctrl+C stops", flush=True)
    try:
        while args.count == 0 or sent < args.count:
            for position in rng.permutation(len(records)):
                start = time.monotonic()
                row = records.iloc[position]
                event = make_event(row, metadata, run_id, sent + 1)
                payload = json.dumps(event, allow_nan=False).encode()
                while True:
                    try:
                        producer.produce(args.topic, key=event["machine_id"], value=payload,
                                         on_delivery=delivered)
                        break
                    except BufferError:
                        producer.poll(.1)
                        if delivery_errors:
                            raise RuntimeError(delivery_errors[0])
                sent += 1
                producer.poll(0)
                if delivery_errors:
                    raise RuntimeError(delivery_errors[0])
                if sent == 1 or sent % args.log_every == 0:
                    print(f"Queued {sent} | latest actual={event['actual']}", flush=True)
                if args.count and sent >= args.count:
                    break
                # No catch-up bursts when serialization or broker backpressure is slow.
                time.sleep(max(0, 1 / args.rate - (time.monotonic() - start)))
    except KeyboardInterrupt:
        print("Stopping producer...", flush=True)
    finally:
        pending = producer.flush(20)
        print(f"Queued={sent}, undelivered={pending}, delivery_errors={len(delivery_errors)}", flush=True)
        if pending or delivery_errors:
            raise SystemExit("Some records were not delivered; check the broker.")


if __name__ == "__main__":
    main()
