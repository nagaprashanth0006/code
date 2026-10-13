"""Fit the detector's classifiers + probability calibration from labelled data.

Usage:
    python calibrate.py DATA_DIR [DATA_DIR ...]

Each DATA_DIR holds *.json files shaped like the Fast-DetectGPT benchmark
({"original": [human texts], "sampled": [AI texts]}), e.g.
https://github.com/baoguangsheng/fast-detect-gpt/tree/main/exp_gpt3to4/data
File names are expected to start with a domain name ("xsum_gpt-4.raw_data.json"), which is
used for leave-one-domain-out evaluation.

Writes detector/calibration.json. Add your own human/AI samples in the same format
(especially from the newest models, in your own domain) to make the probabilities fit
your use case.
"""
import glob
import json
import os
import pickle
import sys

import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from detector.lm import FEATURE_NAMES, LMScorer, span_features
from detector.model import DOC_LM, SPAN_LM, span_design
from detector.style import STYLE_NAMES, style_features

HERE = os.path.dirname(os.path.abspath(__file__))
SPAN_LENGTHS = (12, 24, 48, 96)  # token lengths used to teach the model how certainty grows with length
rng = np.random.default_rng(0)


def load(dirs, scorer_factory=None):
    """Returns texts, labels, domain groups and per-token LM stats (cached next to each file)."""
    texts, labels, groups, stats = [], [], [], []
    scorer = None
    for d in dirs:
        for f in sorted(glob.glob(os.path.join(d, "*.json"))):
            data = json.load(open(f, encoding="utf-8"))
            if not isinstance(data, dict) or "original" not in data:
                continue
            dom = os.path.basename(f).split(".")[0].split("_")[0]
            ts, ls = [], []
            for o, s in zip(data["original"], data["sampled"]):
                ts += [o, s]
                ls += [0, 1]
            if scorer_factory:
                cache = f + ".stats.pkl"
                if os.path.exists(cache) and os.path.getmtime(cache) > os.path.getmtime(f):
                    st = pickle.load(open(cache, "rb"))
                else:
                    scorer = scorer or scorer_factory()
                    st = [scorer.stats(t) for t in ts]
                    pickle.dump(st, open(cache, "wb"))
                stats += st
            texts += ts
            labels += ls
            groups += [dom] * len(ts)
    return texts, np.array(labels), np.array(groups), stats


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def fit_eval(name, X, y, g, C=1.0, report=None):
    """Leave-one-domain-out evaluation, temperature fitted on the held-out predictions,
    then a final fit on everything."""
    oof = np.zeros(len(y))
    for dom in sorted(set(g)):
        te = g == dom
        oof[te] = LogisticRegression(C=C, max_iter=5000).fit(X[~te], y[~te]).decision_function(X[te])

    def nll(t):
        p = 1 / (1 + np.exp(-oof / t))
        return -np.mean(y * np.log(p + 1e-9) + (1 - y) * np.log(1 - p + 1e-9))
    temp = float(minimize_scalar(nll, bounds=(0.3, 10), method="bounded").x)
    prob = 1 / (1 + np.exp(-oof / temp))
    m = report if report is not None else np.ones(len(y), bool)
    auc = roc_auc_score(y[m], prob[m])
    acc = ((prob[m] > 0.5) == y[m]).mean()
    print(f"\n[{name}] held-out-domain AUROC={auc:.3f}  accuracy={acc:.3f}  temperature={temp:.2f}")
    print("  reliability (predicted AI prob -> actual AI rate):")
    for lo in np.arange(0, 1, 0.2):
        b = m & (prob >= lo) & (prob < lo + 0.2 + 1e-9)
        if b.sum():
            print(f"    {lo:.1f}-{lo + 0.2:.1f}: n={b.sum():5d}  actual={y[b].mean():.2f}")
    clf = LogisticRegression(C=C, max_iter=5000).fit(X, y)
    return {"coef": (clf.coef_[0] / temp).tolist(), "intercept": float(clf.intercept_[0] / temp),
            "auroc": round(float(auc), 3), "accuracy": round(float(acc), 3)}, prob


def main():
    dirs = sys.argv[1:]
    if not dirs:
        sys.exit(__doc__)
    texts, labels, groups, stats = load(dirs, LMScorer)
    print(f"{len(texts)} texts, domains: {sorted(set(groups.tolist()))}")
    F = np.array([span_features(s) for s in stats])

    for i, nm in enumerate(FEATURE_NAMES):
        print(f"  single feature {nm:15s} AUROC {max(roc_auc_score(labels, F[:, i]), 1 - roc_auc_score(labels, F[:, i])):.3f}")

    # 1) Style-only (fallback when no torch).
    S = np.array([style_features(t) for t in texts])
    s_mean, s_std = S.mean(0), S.std(0) + 1e-9
    Sz = (S - s_mean) / s_std
    style, _ = fit_eval("stylometry only", Sz, labels, groups, C=0.5)
    style.update(features=STYLE_NAMES, mean=s_mean.tolist(), std=s_std.tolist())

    # 2) Document model: LM statistics + stylometry.
    Fd = F[:, DOC_LM]
    f_mean, f_std = Fd.mean(0), Fd.std(0) + 1e-9
    doc, _ = fit_eval("document (LM + stylometry)", np.hstack([(Fd - f_mean) / f_std, Sz]), labels, groups, C=0.5)
    doc.update(lm_features=[FEATURE_NAMES[i] for i in DOC_LM], lm_mean=f_mean.tolist(), lm_std=f_std.tolist())

    # 3) Span model (sentence highlighting): LM statistics with a length interaction, trained
    #    on random spans of each text so it learns how confidence grows with span length.
    X, y, g, L = [], [], [], []
    for s, lab, grp in zip(stats, labels, groups):
        n = len(s)
        for ln in SPAN_LENGTHS:
            if n <= ln + 1:
                continue
            for _ in range(2):
                a = int(rng.integers(0, n - ln))
                X.append(span_design(span_features(s, slice(a, a + ln)), ln)); y.append(lab); g.append(grp); L.append(ln)
    X, y, g, L = map(np.array, (X, y, g, L))
    span, prob = fit_eval("sentence spans (LM only)", X, y, g, C=1.0)
    for ln in SPAN_LENGTHS:
        m = L == ln
        print(f"    {ln:>3}-token spans AUROC {roc_auc_score(y[m], prob[m]):.3f}")

    out = {"style": style, "doc": doc, "span": span, "n_texts": len(texts),
           "domains": sorted(set(groups.tolist()))}
    path = os.path.join(HERE, "detector", "calibration.json")
    json.dump(out, open(path, "w"), indent=2)
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
