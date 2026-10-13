"""Language-model scoring: per-token statistics for zero-shot AI-text detection.

Two small models read the text: a *base* model (S) and its *instruct* (chat-tuned)
sibling (R). For every token x_t, given the prefix, we record

    ll_s   = log p_S(x_t)                 ll_r = log p_R(x_t)
    mu_ss  = E_{p_S}[log p_S]  (-entropy)  mu_rr = E_{p_R}[log p_R]
    mu_rs  = E_{p_R}[log p_S]  (-cross-entropy, how a chat model "expects" S to score)
    and the matching variances.

These are the ingredients of the best published zero-shot detectors:

    Fast-DetectGPT (Bao et al., ICLR 2024):  (sum ll - sum mu) / sqrt(sum var)
    Binoculars     (Hans et al., ICML 2024):  sum(-ll_s) / sum(-mu_rs)

Machine text sits in the model's high-probability "valley": its tokens are consistently
more likely than what the model would itself sample. Human writing makes more surprising
choices. The detector combines several such ratios with a calibrated classifier.
"""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass

import numpy as np

try:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    HAS_TORCH = True
except Exception:  # pragma: no cover - optional dependency
    HAS_TORCH = False


SCORE_MODEL = os.environ.get("DETECTOR_SCORE_MODEL", "Qwen/Qwen2.5-0.5B")
REF_MODEL = os.environ.get("DETECTOR_REF_MODEL", "Qwen/Qwen2.5-0.5B-Instruct")
WINDOW = int(os.environ.get("DETECTOR_WINDOW", "1024"))
CONTEXT = 128  # tokens of overlap carried into each new window
CHUNK = 128    # rows per vocab-wide moment computation

FIELDS = ("ll_s", "ll_r", "mu_ss", "var_ss", "mu_rr", "var_rr", "mu_rs", "var_rs")


@dataclass
class TokenStats:
    offsets: np.ndarray        # (n, 2) char spans in the original text
    a: dict[str, np.ndarray]   # FIELDS -> (n,)

    def __len__(self):
        return len(self.offsets)


def _moments(p, lp):
    plp = p * lp
    mu = plp.sum(-1)
    var = ((plp * lp).sum(-1) - mu.square()).clamp_min(1e-6)
    return mu, var


class LMScorer:
    def __init__(self, score_model: str = SCORE_MODEL, ref_model: str = REF_MODEL):
        if not HAS_TORCH:
            raise RuntimeError("torch/transformers not installed")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
        self.tok = AutoTokenizer.from_pretrained(score_model)
        self.score = self._load(score_model, dtype)
        self.ref = self._load(ref_model, dtype)
        self.name = f"{score_model.split('/')[-1]} + {ref_model.split('/')[-1]}"
        self._lock = threading.Lock()

    def _load(self, name, dtype):
        m = AutoModelForCausalLM.from_pretrained(name, dtype=dtype).to(self.device)
        m.eval()
        return m

    @torch.inference_mode()
    def stats(self, text: str) -> TokenStats:
        enc = self.tok(text, return_offsets_mapping=True, add_special_tokens=False)
        ids = enc["input_ids"]
        offsets = np.array(enc["offset_mapping"], dtype=np.int64).reshape(-1, 2)
        n = len(ids)
        out = {f: np.zeros(n, np.float32) for f in FIELDS}

        # Slide over long inputs; each window scores tokens [start, end) with up to
        # CONTEXT tokens of preceding text as conditioning.
        start = 1
        with self._lock:
            while start < n:
                end = min(n, start + WINDOW - CONTEXT)
                ctx = max(0, start - CONTEXT)
                x = torch.tensor([ids[ctx:end]], device=self.device)
                logit_s = self.score(x).logits[0, :-1]
                logit_r = self.ref(x).logits[0, :-1]
                tgt = x[0, 1:, None]
                k = start - ctx - 1  # first predicted position we keep
                # Vocab-wide moments in row chunks: keeps fp32 temporaries small and fast.
                parts = {f: [] for f in FIELDS}
                for r in range(k, len(tgt), CHUNK):
                    lp_s = torch.log_softmax(logit_s[r:r + CHUNK].float(), -1)
                    lp_r = torch.log_softmax(logit_r[r:r + CHUNK].float(), -1)
                    p_s, p_r = lp_s.exp(), lp_r.exp()
                    t = tgt[r:r + CHUNK]
                    parts["ll_s"].append(lp_s.gather(-1, t)[:, 0])
                    parts["ll_r"].append(lp_r.gather(-1, t)[:, 0])
                    for (mu, var), (p, lp) in zip((("mu_ss", "var_ss"), ("mu_rr", "var_rr"), ("mu_rs", "var_rs")),
                                                  ((p_s, lp_s), (p_r, lp_r), (p_r, lp_s))):
                        m, v = _moments(p, lp)
                        parts[mu].append(m)
                        parts[var].append(v)
                for f in FIELDS:
                    out[f][start:end] = torch.cat(parts[f]).cpu().numpy()
                start = end
        # The first token has no prefix to be scored against; drop it.
        return TokenStats(offsets[1:], {f: v[1:] for f, v in out.items()})


def span_features(s: TokenStats, idx=slice(None)) -> np.ndarray:
    """Length-normalised detector statistics over a span of tokens."""
    a = {f: v[idx] for f, v in s.a.items()}
    n = max(len(a["ll_s"]), 1)
    rt = np.sqrt(n)

    def fd(ll, mu, var):  # Fast-DetectGPT z-score, divided by sqrt(n) -> per-token effect size
        return (ll.sum() - mu.sum()) / np.sqrt(var.sum()) / rt

    return np.array([
        fd(a["ll_s"], a["mu_rs"], a["var_rs"]),       # FD, base scorer / chat sampler
        fd(a["ll_r"], a["mu_rr"], a["var_rr"]),       # FD, chat model alone
        fd(a["ll_s"], a["mu_ss"], a["var_ss"]),       # FD, base model alone
        np.log(a["ll_s"].sum() / a["mu_rs"].sum()),   # log Binoculars
        a["ll_s"].mean(),                             # log-perplexity (negated)
        (a["ll_r"] - a["ll_s"]).mean(),               # chat-tuning preference for this text
    ], dtype=np.float64)


FEATURE_NAMES = ["fd_pair", "fd_chat", "fd_base", "log_binoculars", "neg_log_ppl", "chat_pref"]
