"""The detector: turns LM statistics + stylometry into calibrated probabilities."""
from __future__ import annotations

import json
import logging
import math
import os
import re

import numpy as np

from . import style
from .lm import HAS_TORCH, span_features

log = logging.getLogger(__name__)

DOC_LM = [0, 1, 4]   # fd_pair, fd_chat, neg_log_ppl
SPAN_LM = [0, 1, 4]
MAX_CHARS = int(os.environ.get("DETECTOR_MAX_CHARS", "200000"))
MIN_WORDS = 50


def span_design(f: np.ndarray, n: int) -> np.ndarray:
    """Features for a span of n tokens. Evidence accumulates with length, so the classifier
    gets both the per-token statistics and their sqrt(n)-scaled versions."""
    f = f[SPAN_LM]
    r = math.sqrt(n) / 8.0
    return np.concatenate([f, f * r, [r]])


def _sigmoid(z):
    return 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, z))))


def _linear(m, x):
    return float(np.dot(m["coef"], x) + m["intercept"])


def verdict(p: float) -> str:
    if p >= 0.85:
        return "Very likely AI-generated"
    if p >= 0.65:
        return "Likely AI-generated"
    if p > 0.35:
        return "Uncertain"
    if p > 0.15:
        return "Likely human-written"
    return "Very likely human-written"


class Detector:
    def __init__(self):
        path = os.path.join(os.path.dirname(__file__), "calibration.json")
        self.cal = json.load(open(path, encoding="utf-8"))
        self.scorer = None
        self.error = None
        if HAS_TORCH and os.environ.get("DETECTOR_DISABLE_LM") != "1":
            try:
                from .lm import LMScorer
                self.scorer = LMScorer()
            except Exception as e:  # pragma: no cover
                self.error = str(e)
                log.exception("LM engine unavailable, falling back to stylometry")

    @property
    def engine(self):
        if self.scorer:
            return {"name": "Fast-DetectGPT + Binoculars ensemble", "models": self.scorer.name,
                    "device": self.scorer.device, "auroc": self.cal["doc"]["auroc"]}
        return {"name": "Stylometry (fallback, lower accuracy)", "models": None, "device": "cpu",
                "auroc": self.cal["style"]["auroc"], "error": self.error}

    @staticmethod
    def _blocks(text, sents, counts, lo=40, hi=200):
        """Group sentence indices into paragraph-sized blocks of roughly lo..hi tokens."""
        blocks, cur, n = [], [], 0
        for i, (a, b) in enumerate(sents):
            new_para = cur and "\n\n" in text[sents[i - 1][1]:a]
            if cur and ((new_para and n >= lo) or n + counts[i] > hi):
                blocks.append(cur)
                cur, n = [], 0
            cur.append(i)
            n += counts[i]
        if cur:
            if blocks and n < lo:
                blocks[-1].extend(cur)
            else:
                blocks.append(cur)
        return blocks

    def analyze(self, text: str) -> dict:
        text = re.sub(r"\r\n?", "\n", text)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        warnings = []
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS]
            warnings.append(f"Only the first {MAX_CHARS:,} characters were analysed.")
        words = len(style.WORD.findall(text))
        if words < MIN_WORDS:
            warnings.append(f"Only {words} words — short texts give unreliable results. 150+ words is best.")

        sents = style.split_sentences(text)
        s_feat = np.array(style.style_features(text))
        sc = self.cal["style"]
        s_z = (s_feat - np.array(sc["mean"])) / np.array(sc["std"])

        sentences = []
        ppl = None
        if self.scorer:
            st = self.scorer.stats(text)
            n_tok = len(st)
            ppl = float(math.exp(-st.a["ll_s"].mean())) if n_tok else None
            doc = self.cal["doc"]
            f = span_features(st)[DOC_LM]
            f_z = (f - np.array(doc["lm_mean"])) / np.array(doc["lm_std"])
            p_doc = _sigmoid(_linear(doc, np.concatenate([f_z, s_z]))) if n_tok >= 4 else 0.5

            # Assign each token to the sentence containing its last character.
            ends = st.offsets[:, 1] - 1
            starts = np.array([a for a, _ in sents])
            sid = np.searchsorted(starts, ends, side="right") - 1
            tok_idx = [np.where((sid == i) & (ends < b))[0] for i, (a, b) in enumerate(sents)]

            # Sentence evidence: LM statistics over the sentence's own tokens.
            logits = [_linear(self.cal["span"], span_design(span_features(st, ix), len(ix))) if len(ix) >= 3 else None
                      for ix in tok_idx]
            counts = [len(ix) for ix in tok_idx]

            # Passage evidence: the full document model (LM + style) on the surrounding
            # paragraph-sized block. Sentences are too short for style cues to mean much,
            # but a block is long enough, and AI/human text tends to come in whole passages.
            block_logit = [0.0] * len(sents)
            for blk in self._blocks(text, sents, counts):
                ix = np.concatenate([tok_idx[i] for i in blk])
                if len(ix) < 8:
                    continue
                btxt = text[sents[blk[0]][0]:sents[blk[-1]][1]]
                bz = (np.array(style.style_features(btxt)) - np.array(sc["mean"])) / np.array(sc["std"])
                bf = (span_features(st, ix)[DOC_LM] - np.array(doc["lm_mean"])) / np.array(doc["lm_std"])
                bl = _linear(doc, np.concatenate([bf, bz]))
                for i in blk:
                    block_logit[i] = bl

            for i, (a, b) in enumerate(sents):
                # Borrow strength from neighbours: short sentences are noisy on their own.
                num = den = 0.0
                for j, w in ((i - 1, 0.5), (i, 1.0), (i + 1, 0.5)):
                    if 0 <= j < len(sents) and logits[j] is not None:
                        num += w * counts[j] * logits[j]
                        den += w * counts[j]
                if not den:
                    sentences.append({"start": a, "end": b, "prob": None, "tokens": counts[i]})
                    continue
                p = _sigmoid(0.5 * (num / den) + 0.5 * block_logit[i])
                sentences.append({"start": a, "end": b, "prob": p, "tokens": counts[i]})
        else:
            n_tok = None
            p_doc = _sigmoid(_linear(sc, s_z))
            base = math.log(p_doc / (1 - p_doc))
            for a, b in sents:
                hits = len(style.phrase_hits(text[a:b]))
                sentences.append({"start": a, "end": b, "prob": _sigmoid(base + 0.8 * hits), "tokens": None})
            warnings.append("Language-model engine not available — using stylometry only (much less accurate).")

        # How much of the text looks AI-written, weighted by length.
        scored = [(s["prob"], s["end"] - s["start"]) for s in sentences if s["prob"] is not None]
        tot = sum(w for _, w in scored) or 1
        ai_share = sum(w for p, w in scored if p >= 0.65) / tot
        human_share = sum(w for p, w in scored if p <= 0.35) / tot
        label = verdict(p_doc)
        if ai_share >= 0.2 and human_share >= 0.2 and len(scored) >= 4:
            label = "Mixed — parts look AI-generated"

        return {
            "text": text,
            "prob_ai": p_doc,
            "verdict": label,
            "ai_share": ai_share,
            "human_share": human_share,
            "sentences": sentences,
            "signals": style.describe(text),
            "phrases": style.phrase_hits(text),
            "stats": {"words": words, "sentences": len(sents), "tokens": n_tok, "perplexity": ppl},
            "engine": self.engine,
            "warnings": warnings,
        }
