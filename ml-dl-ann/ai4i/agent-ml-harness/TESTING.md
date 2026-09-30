# Local verification

Checked on 2026-09-29 on the local Apple Silicon Mac with 24 GB memory.

- Ollama 0.34.4, `qwen3.5:9b`, model ID `6488c96fa5fa`.
- Ollama reported 100% GPU use and an 8,192-token context.
- Isolated Python 3.13 environment with the versions in `requirements.txt`.
- Saved ML model ID: `733f720298b4bcfc` (first 16 characters of SHA-256).
- Saved alert cutoff: 0.13.

## Results

`python -m unittest discover -s tests -v`: **17 tests passed**.

`python -m pip check`: no broken requirements.

`python smoke_test.py`: all five live scenarios passed the workflow and raw-result checks:

| Scenario | Result |
|---|---|
| Single observation | Tool called; NORMAL, score 0.00011954165376277581 |
| Compare two observations | Both scored; sample-b score 0.5741018193295159, FAILURE |
| Missing torque | Tool called; missing value filled and flagged |
| Invalid RPM string | Tool error; no ML result |
| No observations | Asked for a readings file; no ML result |

Each successful live result exactly matched a separate direct inference call.

The full scenarios were run twice during development. Reviewing the explanations caught misleading phrases about a “safety cutoff” and “imminent failure”. The prompt was tightened. After the final wording change, `python demo.py single` passed with:

> sample-a is classified as NORMAL. Its model score is 0.00012, below the alert cutoff of 0.13. There are no input warnings.

The full-precision result appeared separately, unchanged. This checks examples, not every possible LLM answer. The explanation remains generated text; use the original tool result as the source of truth.

## Repeat the checks

From this folder, with Ollama running:

```sh
source .venv/bin/activate
python app.py --check
python -m unittest discover -s tests -v
python smoke_test.py
python demo.py single
```
