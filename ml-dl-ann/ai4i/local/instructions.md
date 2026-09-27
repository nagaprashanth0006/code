We are building a 60-minute technical KT/demo that teaches the end-to-end process of training and deploying a classical ML model.

The objective is NOT simply to obtain a high-performing model. The audience should understand the reasoning and engineering involved in:

raw data → exploration → feature decisions → problem formulation → preprocessing → model selection → training → evaluation → packaging → real-time inference.

## Core scenario

Use the UCI AI4I 2020 Predictive Maintenance dataset as the underlying physical/problem basis.

The problem is binary classification:

> Given the currently available operating conditions of a machine, predict whether the machine is in a failure condition.

The original useful AI4I variables include concepts such as:

- Product/machine type
- Air temperature
- Process temperature
- Rotational speed / RPM
- Torque
- Tool wear
- Machine failure target
- Failure-type indicators such as TWF, HDF, PWF, OSF and RNF

The failure-type columns MUST NOT be model inputs when predicting `Machine failure`, because they effectively reveal the target and would constitute leakage.

## Important modification: create an "AI4I+" raw dataset

The original AI4I dataset is too clean for the teaching objective.

Create a reproducible preprocessing/data-generation step that augments AI4I with realistic additional columns so the initial dataset feels like raw industrial telemetry.

Include a sensible mixture of:

- genuinely useful signals
- correlated/redundant variables
- categorical/contextual variables
- identifiers
- missing values
- occasional sensor outliers
- irrelevant/noise variables
- deliberately leaky/post-event variables

Examples may include:

- machine_id
- batch_id
- timestamp
- shift
- machine_age
- maintenance interval
- vibration
- spindle load
- power consumption
- ambient humidity
- coolant flow
- auxiliary sensor values
- post-failure alarm
- emergency stop
- failure code

Do NOT make the synthetic relationships arbitrary. Useful generated features should have plausible relationships to the underlying AI4I variables.

Use a fixed random seed so the dataset and demo are reproducible.

## KT structure

Target approximately:

### Part 1 — Data exploration and problem definition (~15–18 min)

The notebook should walk through:

1. Load raw AI4I+ dataset.
2. Understand what one row represents.
3. Dataset size and datatypes.
4. Missing values.
5. Target distribution / class imbalance.
6. IDs and columns that should not be predictive features.
7. Suspicious correlations and leakage.
8. Redundant/noisy features.
9. Basic physically meaningful feature relationships.
10. Decide which features are legitimate at inference time.
11. Clearly formulate:
   - X = valid input features
   - y = Machine failure
   - supervised binary classification.

The purpose of EDA is decision-making, not producing dozens of decorative graphs.

Where useful, deliberately demonstrate why a highly correlated feature can still be invalid because it is only known after failure.

Mention PCA and evaluate whether it is justified. The expected conclusion is probably that PCA is unnecessary because the final feature dimensionality is modest and physical interpretability is valuable. Do not use PCA just because it exists.

## Part 2 — Model training and evaluation (~15–18 min)

Do NOT perform algorithm roulette.

Derive algorithm choice from characteristics of the problem:

- tabular data
- moderate dataset size
- nonlinear relationships
- feature interactions
- imbalanced target
- interpretability useful

Use:

1. Dummy classifier as baseline.
2. Small Decision Tree for intuition/interpretability.
3. Random Forest as the primary model.

Demonstrate:

- train/validation/test thinking, or an appropriately clean train/test workflow
- stratification because of class imbalance
- preprocessing pipeline
- categorical encoding
- missing-value handling
- avoiding data leakage
- overfitting vs generalization
- comparison with dummy baseline
- confusion matrix
- precision
- recall
- F1
- PR-AUC if useful
- ROC-AUC optionally
- predicted probabilities
- feature importance where appropriate
- why accuracy alone is misleading
- effect of classification threshold
- operational cost of false positives vs false negatives

The notebook should make clear that:

training data + known answers → learned model

while:

new data + learned model → prediction.

Save the ENTIRE preprocessing + model pipeline, not only the RandomForestClassifier.

Prefer joblib unless there is a reason otherwise.

Example artifact:

`artifacts/machine_failure_pipeline.joblib`

## Part 3 — Kafka real-time inference (~15–18 min)

Create a small realistic streaming demo.

Architecture:

synthetic machine producer
→ Kafka topic `machine.telemetry`
→ ML inference consumer
→ preprocessing + trained model
→ probability + prediction
→ optionally Kafka topic `machine.predictions`

The producer should continuously generate synthetic telemetry events using the same RAW schema expected by the inference pipeline.

Example input concept:

{
  "machine_id": "M-017",
  "timestamp": "...",
  "type": "L",
  "air_temperature": 301.2,
  "process_temperature": 309.4,
  "rpm": 1321,
  "torque": 58.7,
  "tool_wear": 211,
  "vibration_rms": 4.3,
  "ambient_humidity": 63,
  "coolant_flow": 7.2,
  "shift": "night"
}

The demo should produce a visible terminal stream such as:

M-017 | p_failure=0.04 | NORMAL
M-018 | p_failure=0.11 | NORMAL
M-019 | p_failure=0.68 | FAILURE
M-020 | p_failure=0.91 | FAILURE

The producer should support several operating modes:

- mostly healthy
- borderline
- failure-prone
- mixed/random

Prefer a CLI flag for this.

Also include a few optional malformed/real-world events for demonstrating production concerns, such as:

- missing required sensor value
- unknown categorical value
- extreme/out-of-range reading

The consumer should handle these safely and visibly rather than crashing.

## Kafka setup

Keep infrastructure lightweight.

Provide Docker Compose for Kafka if practical.

Do not introduce unnecessary enterprise infrastructure.

The user should ideally be able to run:

1. start Kafka
2. train/export model
3. start inference consumer
4. start telemetry producer

with a small number of commands.

## Preferred project layout

Something approximately like:

ml-ai4i-kt/
├── README.md
├── requirements.txt or pyproject.toml
├── data/
│   ├── raw/
│   └── processed/
├── notebooks/
│   └── 01_ai4i_end_to_end_kt.ipynb
├── src/
│   ├── data/
│   │   └── build_ai4i_plus.py
│   ├── training/
│   │   └── train.py
│   ├── inference/
│   │   └── predict.py
│   └── streaming/
│       ├── producer.py
│       └── consumer.py
├── artifacts/
│   └── machine_failure_pipeline.joblib
├── docker-compose.yml
└── tests/

Adapt the structure if a cleaner design emerges.

## Notebook design philosophy

The notebook is the primary KT storytelling surface.

It should be readable enough that I can present directly from it.

Each section should answer a question, for example:

- What exactly is in our data?
- What is one observation?
- What are we trying to predict?
- Which information would actually exist when prediction occurs?
- Are any columns cheating?
- Is the target balanced?
- Do we need dimensionality reduction?
- What baseline must our model beat?
- Why choose this algorithm?
- Did it learn or memorize?
- What kinds of errors does it make?
- How does this become a real inference system?

Keep explanations concise and technical rather than tutorial-like walls of text.

## Important conceptual constraints

Do NOT describe the AI4I task as predicting a failure 10/15 minutes into the future unless we explicitly create and justify a temporal target. AI4I itself is not a proper future-failure time-series dataset.

For this KT the safe wording is:

> Predict whether the current machine operating state corresponds to a failure condition.

The synthetic Kafka stream represents continuously arriving machine observations. It does not magically turn the historical AI4I dataset into a true forecasting dataset.

Also preserve the distinction between:

- ML model
- preprocessing pipeline
- decision threshold
- streaming/application architecture

These are related but not the same thing.

## Teaching message

The entire repository should reinforce:

> The hard part of ML is not calling `.fit()`. It is deciding what the model is allowed to learn, determining whether it learned something that generalizes, and making sure the same assumptions hold when unseen data arrives.

## Deliverables

Produce:

1. Reproducible AI4I+ dataset creation script.
2. Presentation-quality Jupyter notebook.
3. Training script.
4. Saved sklearn pipeline.
5. Kafka producer.
6. Kafka inference consumer.
7. Docker Compose Kafka environment.
8. README with exact commands for running the complete demo.
9. Minimal tests for preprocessing/schema/inference.
10. Requirements/pyproject with pinned or reasonably constrained dependencies.

Before finalizing, run the complete workflow locally where possible and fix errors rather than only generating code.

Optimize for clarity, reproducibility, and a live 60-minute KT — not for production-scale architecture or maximum model performance.