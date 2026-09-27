# Local Kafka inference demo

Run all commands from `/Users/prashanth/Desktop/own_repos/ai4i-dev`.
No Docker, Podman, ZooKeeper, or background system service is required.
Kafka is a Java process; the installed Java 17 satisfies Kafka 4.2's requirement.

In each terminal that runs Kafka commands, set the installed Homebrew Java path:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
```

Flow: producer → `machine.telemetry` → consumer → saved pipeline → prediction + metrics.

**This workspace is already prepared:** Kafka 4.2.0 was downloaded, SHA-512 checked,
extracted, and initialized; `machine.telemetry` was created. Skip section 2 here.
The broker was stopped after verification. Model/data artifacts are also present.
Your existing notebook environment already has the Kafka client and matching ML
packages, so you can skip section 1 and activate it in the producer/consumer terminals:

```sh
source /Users/prashanth/Desktop/Dev/python/aidev/bin/activate
```

Verification used your current project model/data and existing Python environment:
2,000 records delivered, 0 delivery errors, 0 skipped, accuracy 0.931, precision 0.316,
recall 0.882, F1 0.465; TP=60, TN=1802, FP=130, FN=8 at threshold 0.13. These exactly
match offline evaluation. Separate `machine.telemetry.verify` and
`machine.telemetry.currentverify` topics contain verification data; the normal demo
topic remains empty. Four additional checks covered metric calculations, missing
inputs, unknown categories, invalid readings, and exclusion of leaky extra fields.

## 1. Python environment and model (one time)

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r local/requirements-streaming.txt
python -m ipykernel install --user --name ai4i-kt --display-name 'AI4I KT'
```

Select **AI4I KT** as the kernel for `src/reference.ipynb` and run all cells.
This creates:

- `data/processed/ai4i_plus.csv`
- `artifacts/machine_failure_pipeline.joblib`
- `artifacts/machine_failure_metadata.json`

Saved notebook outputs alone do not create these files. Train and consume with the
same environment. The requirements use sklearn 1.9.0, matching your current saved
model. Retrain if your existing artifact uses a different sklearn
version, or use that exact training version for the consumer. Only load trusted joblib files.

## 2. Download native Kafka (one time)

```sh
mkdir -p local/.runtime
curl -fL https://archive.apache.org/dist/kafka/4.2.0/kafka_2.13-4.2.0.tgz -o local/.runtime/kafka_2.13-4.2.0.tgz
curl -fL https://archive.apache.org/dist/kafka/4.2.0/kafka_2.13-4.2.0.tgz.sha512 -o local/.runtime/kafka_2.13-4.2.0.tgz.sha512
```

Compare `shasum -a 512 local/.runtime/kafka_2.13-4.2.0.tgz` with the downloaded
`.sha512` file before extracting. Then:

```sh
tar -xzf local/.runtime/kafka_2.13-4.2.0.tgz -C local/.runtime
AI4I_CLUSTER_ID="$(local/.runtime/kafka_2.13-4.2.0/bin/kafka-storage.sh random-uuid)"
local/.runtime/kafka_2.13-4.2.0/bin/kafka-storage.sh format --standalone -t "$AI4I_CLUSTER_ID" -c local/kafka.properties
```

**Format once only.** On subsequent runs, skip download, extraction, and formatting.
Keep the data directory to preserve Kafka records and consumer offsets.
These commands follow the [Apache Kafka native quickstart](https://kafka.apache.org/42/getting-started/quickstart/).

## 3. Start Kafka — terminal 1

```sh
local/.runtime/kafka_2.13-4.2.0/bin/kafka-server-start.sh local/kafka.properties
```

Leave this terminal open. Kafka listens only on the local machine. If 9092/9093
are occupied, stop the other broker or change both listener settings in the config;
also pass the new broker port with `--bootstrap-servers` to both Python scripts.

## 4. Create the topic and start the consumer — terminal 2

After Kafka starts:

```sh
local/.runtime/kafka_2.13-4.2.0/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic machine.telemetry --partitions 1 --replication-factor 1
source /Users/prashanth/Desktop/Dev/python/aidev/bin/activate
python src/consumer.py --bootstrap-servers 127.0.0.1:9092 --metrics-every 20
```

## 5. Start the producer — terminal 3

```sh
source /Users/prashanth/Desktop/Dev/python/aidev/bin/activate
python src/producer.py --bootstrap-servers 127.0.0.1:9092 --rate 5
```

This sends five messages per second continuously. It shuffles the notebook's
2,000 test rows, sends each once, then repeats with a new ordering.

Finite demo at 20 messages/sec:

```sh
python src/producer.py --bootstrap-servers 127.0.0.1:9092 --rate 20 --count 2000
```

The consumer prints each probability, decision, and actual label, followed by
cumulative accuracy, precision, recall, F1, and TP/TN/FP/FN counts every 20 records.
It prints final metrics on shutdown. Undefined ratios display `n/a`.

## Stop and restart

Press **Ctrl+C** in this order: producer, consumer, Kafka. The producer flushes
pending sends; the consumer commits handled messages and closes. Start Kafka again
with step 3, then restart the scripts. No reformat is necessary.

The default consumer group `ai4i-live` resumes its committed offset. Metrics are
in-memory and start from zero each time the consumer starts. To replay retained
messages from the beginning, use a new group:

```sh
python src/consumer.py --bootstrap-servers 127.0.0.1:9092 --group-id ai4i-replay-2 --offset earliest --max-messages 2000 --idle-timeout 30
```

`--offset` only applies when the group has no saved offset. `--offset latest` with
a new group skips existing messages; start that consumer before the producer and
allow it to join the group. One consumer process is intended for this demo.

## Configuration

Both scripts: `--bootstrap-servers`, `--topic`, `--metadata`.
The examples use `127.0.0.1` to avoid an unnecessary IPv6 connection retry on macOS
when `localhost` resolves to `::1` before IPv4.

Producer: `--rate` (5), `--count` (0 = forever), `--seed` (42; shuffle only),
`--data`, `--log-every` (100).

Consumer: `--model`, `--threshold` (saved threshold), `--group-id` (`ai4i-live`),
`--offset` (`earliest`), `--metrics-every` (20), `--print-every` (1),
`--max-messages` (0 = forever), `--idle-timeout` (0 = disabled).
Use `--help` for details. For higher rates reduce terminal output, for example
`--print-every 100 --metrics-every 100`. Rates are best effort, not guaranteed throughput.

## What the live accuracy means

The producer replays labeled test observations rather than inventing arbitrary
sensors and pretending to know their outcomes. It reconstructs the notebook's
60/20/20 split using the metadata seed, so **use the exact generated CSV, unchanged
in row order, with its matching model and metadata**. It never samples training rows.

Each JSON message separates `features` from `actual`. Only allowlisted features
reach the model. The consumer uses `actual` solely for scoring. Missing numeric
values are imputed by the fitted pipeline; unknown categories are visibly flagged.
Non-numeric/non-finite values and invalid JSON are skipped and counted. Finite
sensor spikes are retained, as in notebook evaluation, without adding a different
range-filtering policy. Unlabeled messages still receive predictions but do not
enter accuracy metrics.

Real telemetry usually does not carry instant ground truth. Real production
accuracy requires joining later verified outcomes to predictions. Replaying the
same test rows repeatedly demonstrates streaming behavior; it does not provide
additional independent validation. Changing the threshold while watching these
test labels turns them into development data.

Delivery is a simple demo policy: commit each processed or visibly skipped message.
A crash between printing and committing can cause a replay. There is no persistent
metrics database or exactly-once scoring. Restarting with a new group also scores
old messages again. Accuracy alone is misleading for this imbalanced dataset;
watch recall and false alarms too.

Python client reference: [Confluent Python client](https://docs.confluent.io/kafka-clients/python/current/overview.html).
