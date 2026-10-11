# Verity: AI text detector

Verity is a small local web app. It estimates how likely a text is to be AI-generated, gives a calibrated
probability, and highlights each sentence as human-like or AI-like. You can paste text or upload TXT, MD,
PDF, DOC, DOCX, ODT, RTF or HTML files.

```
pip install -r requirements.txt
python app.py          # → http://127.0.0.1:8000
```

The first run downloads two ~1 GB models: `Qwen2.5-0.5B` and `Qwen2.5-0.5B-Instruct`. A GPU is used if
present, and the CPU works too. Without `torch`, the app still runs, but it falls back to a much weaker
stylometry-only detector.

## How AI detectors work

A language model assigns a probability to every possible next token. AI models write by choosing
high-probability tokens, so their text is unusually predictable to another model. Humans make more
surprising choices.

| Signal | What it measures |
|---|---|
| **Perplexity** | How surprised a model is by the text on average. Low perplexity suggests AI. |
| **Fast-DetectGPT** (Bao et al., ICLR 2024) | `(log p(text) − E[log p]) / std`. It compares each actual token with what the model *would* sample. A z-score is robust across topics. |
| **Binoculars** (Hans et al., ICML 2024) | Base-model perplexity divided by the cross-entropy between the base model and its chat-tuned twin. It corrects for prompts that are naturally predictable. |
| **Stylometry** | Sentence-length variation ("burstiness"), vocabulary diversity, over-used chatbot phrases, contractions and transitions. Weak alone; useful in combination. |

Verity runs both models over the text in one pass. It computes these statistics per token, then:

1. **Document score.** A logistic-regression ensemble of the LM statistics plus stylometry, with temperature
   scaling so the percentages are calibrated.
2. **Sentence highlights.** A span model trained on random 12–96-token windows, so it learns how
   certainty grows with length. Its output is averaged with the document model applied to the
   surrounding paragraph. Neighbouring sentences lend a little evidence to short ones.
3. **Mixed detection.** If at least 20% of the text is confidently AI and at least 20% is confidently
   human, the verdict is *Mixed*.

## Accuracy (honest numbers)

These figures come from `calibrate.py`, which trains on two writing domains and tests on the unseen
third (news, creative writing, medical Q&A). The data is 2,700 texts, with the AI side written by
GPT-3.5, GPT-4 and Phi-3-mini:

| Model | AUROC | Accuracy at 50% |
|---|---|---|
| Document (LM + stylometry) | **0.86** | 76% |
| Sentence spans, 48+ tokens | 0.84 | n/a |
| Sentence spans, 12 tokens | 0.72 | n/a |
| Stylometry only (no-torch fallback) | 0.83 | 76% |

**Calibration.** When the document score is 80–100%, the text was AI 94% of the time. When it is
0–20%, it was AI 10% of the time.

**Harder spot checks, outside the training data:**

* 12 samples written in a plain style by a current frontier model: 50% flagged at the 50% line.
* 39 human-written CPython module docstrings (formal technical prose): 26% wrongly flagged at 50%,
  and 3% at 85%.

**No AI detector is proof.** Expect errors from:

* very short texts (under ~100 words)
* paraphrased or heavily edited AI text
* formulaic human writing (technical docs, legal or scientific text, non-native English)
* newer models whose style differs from the training data

Never use a single score as the sole basis for an accusation.

## Recalibrating for your use case

The best way to improve accuracy is to add labelled examples from your own domain and from the models
you care about. Each example is a JSON file of paired texts:

```json
{"original": ["human text 1", "..."], "sampled": ["AI text 1", "..."]}
```

Put the files in folders, then run:

```
python calibrate.py path/to/folder [more/folders ...]
```

The file name prefix up to the first `_` is treated as the domain for held-out evaluation. The script
rewrites `detector/calibration.json`. The benchmark it ships with is
[fast-detect-gpt/exp_gpt3to4/data](https://github.com/baoguangsheng/fast-detect-gpt/tree/main/exp_gpt3to4/data).

## Configuration

| Env var | Default | |
|---|---|---|
| `PORT` / `HOST` | `8000` / `127.0.0.1` | |
| `DETECTOR_SCORE_MODEL` | `Qwen/Qwen2.5-0.5B` | Base model. If you change it, recalibrate. |
| `DETECTOR_REF_MODEL` | `Qwen/Qwen2.5-0.5B-Instruct` | Chat-tuned sibling. Must share the tokenizer. |
| `DETECTOR_DISABLE_LM` | unset | Set to `1` to force stylometry-only mode. |
| `DETECTOR_MAX_CHARS` | `200000` | Longer input is truncated. |

Legacy `.doc` files are converted with LibreOffice or `antiword` when either is installed. Otherwise a
best-effort binary text scan is used. Scanned PDFs need OCR first.

## Layout

```
app.py               Flask server (/, /api/info, /api/analyze)
static/index.html    the whole UI: vanilla JS/CSS, no build step, no external requests
detector/lm.py       per-token LM statistics (Fast-DetectGPT / Binoculars ingredients)
detector/style.py    stylometric features and UI explanations
detector/model.py    ensemble, sentence highlighting, verdicts
detector/extract.py  TXT/PDF/DOC/DOCX/ODT/RTF/HTML → text
calibrate.py         fits detector/calibration.json from labelled data
```
