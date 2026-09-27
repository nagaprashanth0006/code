# %% [markdown]
# # AI4I: from raw telemetry to a validated model
# 
# This reference complements `main.ipynb`. Read each question, run the cells in order,
# and explain the decision before moving on. Kafka is intentionally deferred.
# 
# **Problem:** given currently available operating conditions, classify whether the
# observation corresponds to a machine failure condition. This is supervised binary
# classification, not a prediction of failure in the next few minutes.
# 
# **Source:** [UCI AI4I 2020](https://archive.ics.uci.edu/dataset/601/ai4i+2020+predictive+maintenance+dataset),
# [DOI](https://doi.org/10.24432/C5HS5C), CC BY 4.0. The source dataset is itself synthetic.
# Our AI4I+ extension is also simulated; neither establishes real-world sensor validity.
# 
# Route: source data → reproducible telemetry augmentation → feature decisions → split
# → preprocessing → dummy/tree/forest → validation threshold → final test → saved pipeline.
# 
# Run from the project root or `src/`. Input: `data/ai4i2020.csv`.
# Generated files: `data/processed/ai4i_plus.csv` and files under `artifacts/`.
# Rerunning regenerates those derived files. The original CSV is never modified.
# 
# %% [markdown]
# ## 1. Environment and reproducibility
# 
# Select a Python 3.10+ notebook kernel. If dependencies are missing, uncomment and run
# the installation cell, then restart the kernel. A seed controls simulation, splits,
# and estimators; package versions also influence reproducibility.
# 
# %%
# %pip install "numpy>=1.26,<3" "pandas>=2.2,<3" "scikit-learn>=1.5,<1.8" "matplotlib>=3.8,<4" "joblib>=1.3,<2"

# %%
from pathlib import Path
import json
import platform
import warnings

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import sklearn
import joblib
from IPython.display import display
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.model_selection import train_test_split
from sklearn.dummy import DummyClassifier
from sklearn.tree import DecisionTreeClassifier, plot_tree
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    average_precision_score, roc_auc_score, confusion_matrix,
    ConfusionMatrixDisplay, PrecisionRecallDisplay,
)
from sklearn.inspection import permutation_importance

SEED = 42
PROJECT_ROOT = next(
    (p for p in [Path.cwd(), *Path.cwd().parents]
     if (p / "data" / "ai4i2020.csv").exists()), None
)
if PROJECT_ROOT is None:
    raise FileNotFoundError("Run from the project root or src; expected data/ai4i2020.csv")
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
ARTIFACT_DIR = PROJECT_ROOT / "artifacts"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
VERSIONS = {"python": platform.python_version(), "numpy": np.__version__,
            "pandas": pd.__version__, "sklearn": sklearn.__version__,
            "joblib": joblib.__version__}
print("Project:", PROJECT_ROOT)
print(VERSIONS)

# %% [markdown]
# ## 2. What does one observation represent?
# 
# Each row pairs operating conditions with a recorded outcome. `Machine failure` is
# the answer, not an input. `UDI` and `Product ID` identify records/products; they do
# not establish longitudinal histories for individual machines.
# 
# The five failure-mode indicators describe outcomes and must also be excluded.
# `Type` is a product quality variant (L/M/H), not a failure label.
# 
# %%
source = pd.read_csv(PROJECT_ROOT / "data" / "ai4i2020.csv")
display(source.head())
source.info()
display(source["Machine failure"].value_counts().sort_index().to_frame("count"))
assert source["Machine failure"].isin([0, 1]).all()
print(f"Failure prevalence: {source['Machine failure'].mean():.2%}")
print(f"Always predicting no failure gives {1-source['Machine failure'].mean():.2%} accuracy.")

# %% [markdown]
# ## 3. How can we create realistic teaching data without inventing evidence?
# 
# AI4I+ retains the original target. Generated signals use operating variables, never
# the target, except for columns explicitly marked **post-event leakage**.
# 
# - Mechanical power = torque × angular speed; spindle load tracks torque.
# - Vibration increases with torque, wear, and departure from nominal RPM.
# - Coolant flow is a fictional controller response to process temperature.
# - Humidity, machine age, and auxiliary readings are simulated context/noise.
# - Machine/batch IDs and timestamps are artificial and do not turn rows into histories.
# 
# These are illustrative assumptions, not calibrated engineering equations. Signals
# derived from existing sensors may be redundant, and need not improve prediction.
# Missing readings and sensor spikes are injected independently of the target, after
# signal generation. The target remains the original operating-state label.
# 
# %%
RENAME = {
    "UDI": "udi", "Product ID": "product_id", "Type": "type",
    "Air temperature [K]": "air_temperature",
    "Process temperature [K]": "process_temperature",
    "Rotational speed [rpm]": "rpm", "Torque [Nm]": "torque",
    "Tool wear [min]": "tool_wear", "Machine failure": "machine_failure",
}

def build_ai4i_plus(original, seed=SEED):
    rng = np.random.default_rng(seed)
    raw = original.rename(columns=RENAME).copy(deep=True)
    n = len(raw)
    raw["machine_id"] = rng.choice([f"M-{i:03d}" for i in range(1, 51)], n)
    raw["batch_id"] = [f"B-{i // 100:04d}" for i in range(n)]
    raw["timestamp"] = pd.date_range("2025-01-01", periods=n, freq="min", tz="UTC")
    raw["shift"] = np.where(raw["timestamp"].dt.hour.between(6, 17), "day", "night")
    raw["machine_age_years"] = rng.uniform(0.5, 15, n)
    raw["maintenance_interval_hours"] = rng.choice([250, 500, 750], n)
    raw["power_consumption_kw"] = (
        raw["torque"] * raw["rpm"] * (2 * np.pi / 60) / 1000
        + rng.normal(0, 0.08, n)
    ).clip(lower=0)
    raw["spindle_load_pct"] = (raw["torque"] / 80 * 100 + rng.normal(0, 2, n)).clip(0, 120)
    raw["vibration_rms"] = (
        0.6 + 0.018 * raw["torque"] + 0.004 * raw["tool_wear"]
        + 0.0006 * (raw["rpm"] - 1500).abs() + rng.normal(0, 0.15, n)
    ).clip(lower=0)
    raw["ambient_humidity"] = rng.uniform(25, 80, n)
    raw["coolant_flow"] = (7 + 0.25 * (raw["process_temperature"] - 310)
                           + rng.normal(0, 0.4, n)).clip(lower=0)
    raw["aux_sensor_noise"] = rng.normal(0, 1, n)
    # Deliberately invalid inputs: recorded after the outcome.
    raw["post_failure_alarm"] = raw["machine_failure"]
    raw["emergency_stop"] = raw["machine_failure"] * rng.binomial(1, 0.9, n)
    modes = ["TWF", "HDF", "PWF", "OSF", "RNF"]
    raw["failure_code"] = raw[modes].apply(
        lambda row: "+".join(row.index[row.eq(1)]) or "NONE", axis=1
    )
    for name in ["air_temperature", "process_temperature", "rpm", "torque",
                 "tool_wear", "vibration_rms", "coolant_flow", "ambient_humidity"]:
        raw.loc[rng.random(n) < 0.02, name] = np.nan
    raw.loc[rng.random(n) < 0.01, "type"] = np.nan
    for name in ["rpm", "vibration_rms"]:
        spikes = rng.choice(n, size=max(1, n // 200), replace=False)
        raw.loc[spikes, name] *= 4
    return raw

raw = build_ai4i_plus(source)
pd.testing.assert_frame_equal(raw, build_ai4i_plus(source))
raw.to_csv(PROCESSED_DIR / "ai4i_plus.csv", index=False)
print("AI4I+ shape:", raw.shape)
display(raw.head())

# %% [markdown]
# ## 4. Which observations should drive our decisions?
# 
# First create a stratified 60/20/20 train/validation/test split. Stratification keeps
# rare failures represented. Explore relationships on training data; use validation
# for model and threshold choices; open the test set only after freezing decisions.
# 
# This random split estimates performance on similar simulated observations. It does
# not measure transfer to new machines, future periods, or a real factory. A real
# deployment could require machine-grouped or chronological evaluation. Artificial
# machine IDs and timestamps cannot establish that evidence here.
# 
# %%
train_raw, holdout_raw = train_test_split(
    raw, test_size=0.4, stratify=raw["machine_failure"], random_state=SEED
)
val_raw, test_raw = train_test_split(
    holdout_raw, test_size=0.5, stratify=holdout_raw["machine_failure"], random_state=SEED
)
assert set(train_raw.index).isdisjoint(val_raw.index)
assert set(train_raw.index).isdisjoint(test_raw.index)
assert set(val_raw.index).isdisjoint(test_raw.index)
display(pd.DataFrame({
    "rows": [len(train_raw), len(val_raw), len(test_raw)],
    "failures": [part["machine_failure"].sum() for part in [train_raw, val_raw, test_raw]],
}, index=["train", "validation", "test"]))

missing = train_raw.isna().mean().mul(100).sort_values(ascending=False)
display(missing[missing > 0].to_frame("missing_percent"))
display(train_raw.describe().T)

# %%
fig, axes = plt.subplots(1, 3, figsize=(15, 4))
train_raw["machine_failure"].value_counts().sort_index().plot.bar(ax=axes[0])
axes[0].set(title="Training target imbalance", xlabel="Failure label", ylabel="Rows")
axes[1].scatter(train_raw["air_temperature"], train_raw["process_temperature"], s=5, alpha=.25)
axes[1].set(xlabel="Air temperature (K)", ylabel="Process temperature (K)", title="Related temperatures")
axes[2].scatter(train_raw["torque"], train_raw["power_consumption_kw"], s=5, alpha=.25)
axes[2].set(xlabel="Torque (Nm)", ylabel="Generated power (kW)", title="Power also depends on RPM")
plt.tight_layout()
plt.show()

correlations = train_raw.select_dtypes(include="number").corr()["machine_failure"].drop("machine_failure")
display(correlations.reindex(correlations.abs().sort_values(ascending=False).index).to_frame("target_correlation"))

# %% [markdown]
# An alarm can correlate perfectly with failure because we generated it **from** the
# answer. That makes it invalid for this prediction task. Correlation cannot tell us
# when information becomes available. Conversely, a low linear correlation does not
# rule out a nonlinear relationship or feature interaction.
# 
# Sensor spikes motivate validation at inference time. We retain training outliers
# here to show imperfect telemetry; these values are not evidence of new physics.
# 
# %% [markdown]
# ## 5. What is the input contract?
# 
# Keep original operating inputs and one illustrative vibration signal. In this demo
# we assume each is available at prediction time. The other generated columns remain
# in the raw dataset so exclusion is an explicit decision.
# 
# PCA is unnecessary for seven inputs: dimensionality is modest, units and physical
# interpretability matter, and trees do not require orthogonal features. PCA would
# also require scaling and fitting exclusively on training data.
# 
# %%
NUMERIC = ["air_temperature", "process_temperature", "rpm", "torque", "tool_wear", "vibration_rms"]
CATEGORICAL = ["type"]
FEATURES = NUMERIC + CATEGORICAL
TARGET = "machine_failure"
LEAKY = ["TWF", "HDF", "PWF", "OSF", "RNF", "post_failure_alarm", "emergency_stop", "failure_code"]
IDENTIFIERS = ["udi", "product_id", "machine_id", "batch_id", "timestamp"]
REDUNDANT = ["power_consumption_kw", "spindle_load_pct", "coolant_flow"]

def feature_decision(name):
    if name == TARGET:
        return "Target", "Known answer used for supervised learning"
    if name in FEATURES:
        return "Keep", "Operating input assumed available at inference"
    if name in LEAKY:
        return "Exclude", "Outcome indicator / post-event information"
    if name in IDENTIFIERS:
        return "Exclude", "Identifier or artificial ordering; not operating evidence"
    if name in REDUNDANT:
        return "Exclude", "Synthetic proxy of retained sensors; keep demo interpretable"
    return "Exclude", "Simulated context/noise with no justified additional mechanism"

decisions = pd.DataFrame(
    [(name, *feature_decision(name)) for name in raw.columns],
    columns=["column", "decision", "reason"]
)
display(decisions)
assert not set(FEATURES).intersection(LEAKY + [TARGET])
X_train, y_train = train_raw[FEATURES], train_raw[TARGET]
X_val, y_val = val_raw[FEATURES], val_raw[TARGET]

# %% [markdown]
# ## 6. What does preprocessing learn?
# 
# Numeric missing values use training medians. Missing categories use the most
# frequent training category; one-hot encoding converts categories to numeric
# indicators. Unknown categories are accepted by the encoder as all-zero indicators,
# but the application should still flag them.
# 
# All transformations live inside a pipeline. Calling `fit` learns preprocessing
# statistics and the classifier from training data only. Calling `predict_proba`
# reuses those statistics. Tree models do not need standard scaling.
# 
# %%
numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median"))])
category_pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="most_frequent")),
    ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
])
preprocessor = ColumnTransformer([
    ("numeric", numeric_pipeline, NUMERIC),
    ("category", category_pipeline, CATEGORICAL),
], remainder="drop")

def make_pipeline(classifier):
    return Pipeline([("preprocessing", clone(preprocessor)), ("model", classifier)])

# %% [markdown]
# ## 7. Why these algorithms?
# 
# - **Dummy:** establishes what ignoring sensors achieves.
# - **Small decision tree:** exposes thresholds and interactions in readable rules.
# - **Random Forest:** averages diverse trees to model nonlinear tabular relationships
#   while reducing the instability of a single tree.
# 
# A deliberately deep tree is included only to illustrate fitting versus generalizing.
# Class weights increase the training penalty associated with rare failures; they do
# not guarantee recall or calibrated probabilities. Hyperparameters below are modest
# teaching defaults, not the result of an exhaustive search.
# 
# %%
models = {
    "Dummy": make_pipeline(DummyClassifier(strategy="most_frequent")),
    "Small tree": make_pipeline(DecisionTreeClassifier(
        max_depth=4, min_samples_leaf=20, class_weight="balanced", random_state=SEED)),
    "Deep tree (diagnostic)": make_pipeline(DecisionTreeClassifier(random_state=SEED)),
    "Random Forest": make_pipeline(RandomForestClassifier(
        n_estimators=250, max_depth=12, min_samples_leaf=2,
        class_weight="balanced_subsample", n_jobs=-1, random_state=SEED)),
}

def failure_probability(pipeline, X):
    class_index = list(pipeline.classes_).index(1)
    return pipeline.predict_proba(X)[:, class_index]

def evaluate(y_true, probabilities, threshold=0.5):
    predicted = (probabilities >= threshold).astype(int)
    return {
        "accuracy": accuracy_score(y_true, predicted),
        "precision": precision_score(y_true, predicted, zero_division=0),
        "recall": recall_score(y_true, predicted, zero_division=0),
        "f1": f1_score(y_true, predicted, zero_division=0),
        "average_precision": average_precision_score(y_true, probabilities),
        "roc_auc": roc_auc_score(y_true, probabilities),
    }

rows = []
for name, pipeline in models.items():
    pipeline.fit(X_train, y_train)
    for split, X, y in [("train", X_train, y_train), ("validation", X_val, y_val)]:
        rows.append({"model": name, "split": split, **evaluate(y, failure_probability(pipeline, X))})
comparison = pd.DataFrame(rows).set_index(["model", "split"])
display(comparison.round(4))

# %% [markdown]
# Read the train–validation gap. Near-perfect training metrics with weaker validation
# metrics suggest overfitting. Compare recall and precision, not just accuracy.
# 
# Precision asks: of the alerts, how many were failures? Recall asks: of the failures,
# how many did we detect? F1 balances these two. Average precision (AP) summarizes the
# precision–recall curve and is useful for this imbalanced task; it is not the same
# numerical calculation as trapezoidal PR-AUC. An uninformative constant score has AP
# equal to prevalence. ROC-AUC summarizes ranking but can obscure operational alert volume.
# 
# %%
small_tree = models["Small tree"]
names = small_tree.named_steps["preprocessing"].get_feature_names_out()
plt.figure(figsize=(20, 9))
plot_tree(small_tree.named_steps["model"], feature_names=names,
          class_names=["normal", "failure"], filled=True, max_depth=2, fontsize=8)
plt.title("First levels of the small tree (display truncated; model depth is 4)")
plt.show()

fig, ax = plt.subplots(figsize=(7, 5))
for name in ["Dummy", "Small tree", "Random Forest"]:
    PrecisionRecallDisplay.from_predictions(
        y_val, failure_probability(models[name], X_val), name=name, ax=ax
    )
ax.axhline(y_val.mean(), color="gray", linestyle="--", label="Validation prevalence")
ax.set_title("Validation precision–recall curves")
ax.legend()
plt.show()

# %% [markdown]
# ## 8. Which inputs does the forest rely on?
# 
# Permutation importance shuffles one validation input and measures the drop in AP.
# It measures reliance by this model on this dataset, not causality. Correlated inputs
# can substitute for each other, making their individual importance look smaller.
# Negative values can arise from noise. This cell is explanatory; it does not trigger
# another feature search.
# 
# %%
primary = models["Random Forest"]
importance = permutation_importance(
    primary, X_val, y_val, scoring="average_precision", n_repeats=5,
    random_state=SEED, n_jobs=1
)
importance_table = pd.DataFrame({
    "feature": FEATURES, "mean_AP_drop": importance.importances_mean,
    "std_AP_drop": importance.importances_std,
}).sort_values("mean_AP_drop", ascending=False)
display(importance_table)

# %% [markdown]
# ## 9. Which probability should trigger an alert?
# 
# The forest produces a score; the application converts it into a decision using a
# threshold. Lower thresholds usually increase recall and false alarms.
# 
# For this exercise, assume a missed failure costs **10 units** and a false alert costs
# **1 unit**. These are hypothetical teaching costs, not a business recommendation.
# Choose the threshold minimizing validation cost on a predefined grid. Resolve ties
# by choosing the lower threshold. Do not use the test set for this choice.
# 
# `predict_proba` is not automatically a calibrated risk estimate, particularly with
# class weighting. We compare empirical validation errors rather than deriving a
# threshold from an assumption of perfectly calibrated probabilities.
# 
# %%
FN_COST, FP_COST = 10, 1
val_probabilities = failure_probability(primary, X_val)
threshold_rows = []
for threshold in np.linspace(0.01, 0.99, 99):
    predictions = (val_probabilities >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_val, predictions, labels=[0, 1]).ravel()
    threshold_rows.append({
        "threshold": float(threshold), "false_positives": int(fp), "false_negatives": int(fn),
        "cost": int(FP_COST * fp + FN_COST * fn),
        "precision": precision_score(y_val, predictions, zero_division=0),
        "recall": recall_score(y_val, predictions, zero_division=0),
    })
threshold_table = pd.DataFrame(threshold_rows)
selected = threshold_table.sort_values(["cost", "threshold"]).iloc[0]
THRESHOLD = float(selected["threshold"])
display(threshold_table.sort_values(["cost", "threshold"]).head(10))
print(f"Frozen threshold: {THRESHOLD:.2f}")

fig, axes = plt.subplots(1, 2, figsize=(12, 4))
threshold_table.plot(x="threshold", y=["precision", "recall"], ax=axes[0])
threshold_table.plot(x="threshold", y="cost", ax=axes[1])
for ax in axes:
    ax.axvline(THRESHOLD, color="black", linestyle="--")
plt.tight_layout()
plt.show()

# %% [markdown]
# ## 10. How does the frozen decision perform on untouched data?
# 
# Now open the test set. Keep the already fitted forest and selected threshold unchanged.
# We do **not** refit on train + validation here: that would change the model whose
# score distribution the threshold was selected against.
# 
# Report the result even if disappointing. Changing the model after seeing this result
# would make this test set part of development. Roughly 68 test failures also means
# recall is sensitive to a small number of errors; a single split is limited evidence.
# 
# %%
X_test, y_test = test_raw[FEATURES], test_raw[TARGET]
test_probabilities = failure_probability(primary, X_test)
test_predictions = (test_probabilities >= THRESHOLD).astype(int)
test_metrics = evaluate(y_test, test_probabilities, THRESHOLD)
display(pd.Series(test_metrics, name="Final test metrics").to_frame())
tn, fp, fn, tp = confusion_matrix(y_test, test_predictions, labels=[0, 1]).ravel()
print(f"TN={tn}, FP={fp}, FN={fn}, TP={tp}")
print(f"Test cost at declared costs: {FP_COST * fp + FN_COST * fn}")
ConfusionMatrixDisplay.from_predictions(
    y_test, test_predictions, labels=[0, 1], display_labels=["normal", "failure"], cmap="Blues"
)
plt.title(f"Final test: threshold={THRESHOLD:.2f}")
plt.show()

errors = X_test.copy()
errors["actual"] = y_test
errors["p_failure"] = test_probabilities
errors["prediction"] = test_predictions
display(errors.loc[errors["actual"] != errors["prediction"]].head(10))

# %% [markdown]
# ## 11. What must we save?
# 
# Save the **entire fitted pipeline**, including imputers, category vocabulary, and
# forest. Save the decision threshold and schema separately as application metadata.
# The classifier's default `.predict()` does not apply our custom threshold.
# 
# Joblib uses pickle semantics: load artifacts only from trusted sources. Keep package
# versions compatible; this format is not a universal cross-version model exchange.
# 
# %%
MODEL_PATH = ARTIFACT_DIR / "machine_failure_pipeline.joblib"
METADATA_PATH = ARTIFACT_DIR / "machine_failure_metadata.json"
joblib.dump(primary, MODEL_PATH)
metadata = {
    "target": TARGET, "features": FEATURES, "numeric_features": NUMERIC,
    "categorical_features": CATEGORICAL, "threshold": THRESHOLD,
    "seed": SEED, "versions": VERSIONS, "test_metrics": test_metrics,
    "false_negative_cost": FN_COST, "false_positive_cost": FP_COST,
    "scope": "Current-state classification on simulated AI4I+; not future forecasting",
}
METADATA_PATH.write_text(json.dumps(metadata, indent=2))
loaded = joblib.load(MODEL_PATH)
loaded_metadata = json.loads(METADATA_PATH.read_text())
np.testing.assert_allclose(failure_probability(loaded, X_test), test_probabilities)
print("Saved and verified:", MODEL_PATH.name, "and", METADATA_PATH.name)

# %% [markdown]
# ## 12. Can a new raw observation safely reach the model?
# 
# This is local inference only; Kafka comes later. Missing sensor values are imputed
# and visibly flagged. An unknown category is flagged but accepted. Non-numeric,
# infinite, or extreme readings are rejected. These broad sanity bounds are demo
# policies, not manufacturer-approved operating limits. A missing column is different
# from a present column containing a null; the adapter builds the complete schema.
# 
# Extra identifiers can accompany an event but are never passed as predictive inputs.
# Production monitoring would also track repeated missingness, drift, and alert outcomes.
# 
# %%
BOUNDS = {
    "air_temperature": (250, 400), "process_temperature": (250, 450),
    "rpm": (100, 5000), "torque": (0, 150), "tool_wear": (0, 400),
    "vibration_rms": (0, 20),
}

def predict_event(event, pipeline=loaded, config=loaded_metadata):
    values, notices = {}, []
    for name in config["numeric_features"]:
        value = event.get(name)
        if value is None or (isinstance(value, (int, float)) and np.isnan(value)):
            values[name] = np.nan
            notices.append(f"{name}: missing; imputed")
            continue
        if isinstance(value, bool):
            return {"status": "rejected", "reason": f"{name}: boolean is not a sensor reading"}
        try:
            value = float(value)
        except (TypeError, ValueError):
            return {"status": "rejected", "reason": f"{name}: expected numeric value"}
        low, high = BOUNDS[name]
        if not np.isfinite(value) or not low <= value <= high:
            return {"status": "rejected", "reason": f"{name}: outside demo bounds [{low}, {high}]"}
        values[name] = value
    category = event.get("type")
    if category is None or (isinstance(category, float) and np.isnan(category)):
        category = np.nan
        notices.append("type: missing; imputed")
    elif not isinstance(category, str):
        return {"status": "rejected", "reason": "type: expected a string"}
    elif category not in {"L", "M", "H"}:
        notices.append("type: unknown category; encoded as all zeros")
    values["type"] = category
    if all(pd.isna(values[name]) for name in config["numeric_features"]):
        return {"status": "rejected", "reason": "all numeric sensors are missing"}
    frame = pd.DataFrame([values], columns=config["features"])
    probability = float(failure_probability(pipeline, frame)[0])
    return {"status": "ok", "machine_id": event.get("machine_id"),
            "p_failure": probability, "prediction": int(probability >= config["threshold"]),
            "threshold": config["threshold"], "warnings": notices}

example = {
    "machine_id": "M-DEMO", "type": "L", "air_temperature": 300.0,
    "process_temperature": 310.0, "rpm": 1500, "torque": 40,
    "tool_wear": 100, "vibration_rms": 1.8,
}
display(predict_event(example))
display(predict_event({**example, "torque": None}))
display(predict_event({**example, "type": "UNKNOWN"}))
display(predict_event({**example, "rpm": 100_000}))

# %% [markdown]
# ## 13. What assumptions can we check automatically?
# 
# These small checks cover reproducible generation, split isolation, leakage exclusion,
# artifact parity, missing inputs, unknown categories, and invalid values. They do not
# prove real-world model quality. The earlier cells already check the first four.
# 
# %%
assert predict_event(example)["status"] == "ok"
missing_result = predict_event({k: v for k, v in example.items() if k != "torque"})
assert missing_result["status"] == "ok" and missing_result["warnings"]
assert predict_event({**example, "type": "UNKNOWN"})["warnings"]
assert predict_event({**example, "rpm": 100_000})["status"] == "rejected"
assert predict_event({**example, "torque": "broken"})["status"] == "rejected"
assert predict_event({**example, "torque": float("inf")})["status"] == "rejected"
assert predict_event({})["status"] == "rejected"
assert predict_event({**example, "post_failure_alarm": 1}) == predict_event(example)
medians = primary.named_steps["preprocessing"].named_transformers_["numeric"].named_steps["imputer"].statistics_
np.testing.assert_allclose(medians, X_train[NUMERIC].median().to_numpy())
assert 0 <= predict_event(example)["p_failure"] <= 1
print("All reference checks passed.")

# %% [markdown]
# ## 14. Explain it without reading the code
# 
# 1. Why can an always-normal model achieve high accuracy and still fail our purpose?
# 2. Why is the post-failure alarm invalid despite its correlation with the target?
# 3. What does the imputer learn, and why is fitting it before splitting a problem?
# 4. What did the small tree teach us? How does the forest differ?
# 5. How do precision, recall, and alert cost change when the threshold moves?
# 6. Why are the pipeline and the decision threshold separate artifacts?
# 7. Why does this experiment not prove future-failure or unseen-machine performance?
# 8. Which parts must stay identical when a Kafka event replaces a notebook dictionary?
# 
# **KT message:** calling `.fit()` is only one step. The main work is deciding what the
# model may learn, measuring whether it generalizes, and preserving those assumptions
# when new observations arrive.
# 
# Next, after studying this notebook: extract reusable data/training/inference functions,
# then connect the input adapter to Kafka. No broker is needed for this reference.
# 