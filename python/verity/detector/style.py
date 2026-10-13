"""Stylometric signals: cheap, model-free hints about how a text was written.

They are weaker than the language-model statistics (and trivially fooled by editing),
so they serve as (a) human-readable explanations in the UI and (b) a fallback detector
when torch isn't installed.
"""
from __future__ import annotations

import re
import statistics

WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")
SENT_SPLIT = re.compile(r"(?<=[.!?…])[\"'”’)\]]*\s+(?=[\"'“‘(\[]?[A-Z0-9])|\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)])\s)")

# Phrases that chat-tuned models over-use relative to human writers.
AI_PHRASES = [
    "delve", "delves", "delving", "tapestry", "testament to", "it's important to note", "it is important to note",
    "it's worth noting", "it is worth noting", "in today's", "ever-evolving", "ever-changing", "landscape",
    "navigate the", "navigating the", "realm", "embark", "multifaceted", "pivotal", "crucial role",
    "plays a crucial", "plays a vital", "vital role", "foster", "fostering", "seamless", "seamlessly",
    "leverage", "leveraging", "robust", "holistic", "underscore", "underscores", "showcase", "showcasing",
    "intricate", "intricacies", "nuanced", "in conclusion", "in summary", "overall,", "ultimately,",
    "furthermore", "moreover", "additionally", "notably", "a myriad of", "myriad", "paramount",
    "elevate", "unlock", "unleash", "harness", "game-changer", "cutting-edge", "transformative",
    "resonate", "resonates", "commendable", "meticulous", "meticulously", "vibrant", "bustling",
    "not only", "but also", "whether you're", "let's dive", "dive into", "in the world of",
    "serves as a", "a rich", "rich tapestry", "stands as", "remains a", "a deeper understanding",
    "shed light", "sheds light", "key takeaways", "at the end of the day", "strike a balance",
]
TRANSITIONS = ("however", "furthermore", "moreover", "additionally", "in addition", "consequently",
               "therefore", "in conclusion", "overall", "ultimately", "firstly", "secondly", "lastly",
               "finally", "importantly", "notably", "similarly", "conversely")
CONTRACTION = re.compile(r"\b\w+['’](s|t|re|ve|ll|d|m)\b", re.I)
FIRST_PERSON = re.compile(r"\b(i|me|my|mine|we|us|our)\b", re.I)


def split_sentences(text: str) -> list[tuple[int, int]]:
    """Char spans of sentences (also splits paragraphs and list items)."""
    spans, start = [], 0
    for m in SENT_SPLIT.finditer(text):
        if text[start:m.start()].strip():
            spans.append((start, m.start()))
        start = m.end()
    if text[start:].strip():
        spans.append((start, len(text)))
    # Trim whitespace inside each span.
    out = []
    for a, b in spans:
        seg = text[a:b]
        a += len(seg) - len(seg.lstrip())
        b -= len(seg) - len(seg.rstrip())
        if b > a:
            out.append((a, b))
    return out


def phrase_hits(text: str) -> list[str]:
    low = text.lower().replace("’", "'")
    return [p for p in AI_PHRASES if re.search(r"(?<![a-z])" + re.escape(p) + r"(?![a-z])", low)]


def _mattr(words, w=50):
    if len(words) <= w:
        return len(set(words)) / max(len(words), 1)
    vals = [len(set(words[i:i + w])) / w for i in range(0, len(words) - w + 1, 5)]
    return sum(vals) / len(vals)


STYLE_NAMES = ["burstiness", "mean_sentence_len", "vocab_diversity", "ai_phrase_rate", "comma_rate",
               "contraction_rate", "first_person_rate", "transition_rate", "mean_word_len",
               "rare_punct_rate", "repeated_trigrams"]


def style_features(text: str) -> list[float]:
    words = [w.lower() for w in WORD.findall(text)]
    nw = max(len(words), 1)
    sents = [text[a:b] for a, b in split_sentences(text)]
    lens = [len(WORD.findall(s)) for s in sents if WORD.search(s)] or [nw]
    mean_len = statistics.fmean(lens)
    burst = statistics.pstdev(lens) / mean_len if len(lens) > 1 and mean_len else 0.0
    hits = sum(len(re.findall(r"(?<![a-z])" + re.escape(p) + r"(?![a-z])", text.lower().replace("’", "'")))
               for p in AI_PHRASES)
    starts = [s.strip().lower() for s in sents]
    trans = sum(1 for s in starts if s.startswith(TRANSITIONS))
    tri = list(zip(words, words[1:], words[2:]))
    rep = 1 - len(set(tri)) / len(tri) if tri else 0.0
    return [
        burst,
        mean_len,
        _mattr(words),
        100 * hits / nw,
        text.count(",") / nw,
        len(CONTRACTION.findall(text)) / nw,
        len(FIRST_PERSON.findall(text)) / nw,
        trans / max(len(sents), 1),
        sum(map(len, words)) / nw,
        sum(text.count(c) for c in ";:()!?—–") / nw,
        rep,
    ]


def describe(text: str) -> list[dict]:
    """Human-readable signals for the UI. `lean` is +1 if the value is typical of AI, -1 of human, 0 neutral."""
    f = dict(zip(STYLE_NAMES, style_features(text)))
    hits = phrase_hits(text)
    nw = len(WORD.findall(text))
    sig = []

    def add(name, value, lean, detail):
        sig.append({"name": name, "value": value, "lean": lean, "detail": detail})

    b = f["burstiness"]
    add("Sentence rhythm", f"{b:.2f} variation", 1 if b < 0.35 else (-1 if b > 0.55 else 0),
        "Humans mix short and long sentences; models tend toward an even, uniform cadence.")
    v = f["vocab_diversity"]
    add("Vocabulary diversity", f"{v:.0%}", 0 if nw < 80 else (1 if v < 0.68 else (-1 if v > 0.78 else 0)),
        "Share of distinct words in a sliding 50-word window.")
    add("Stock AI phrasing", f"{len(hits)} found" if hits else "none",
        1 if len(hits) >= 3 else (0 if hits else -1),
        ("Found: " + ", ".join(f"“{h}”" for h in hits[:8])) if hits else "No over-used chatbot phrases detected.")
    c = f["contraction_rate"] + f["first_person_rate"]
    add("Personal voice", f"{c * 100:.1f} per 100 words", -1 if c > 0.03 else (1 if c < 0.005 and nw > 120 else 0),
        "Contractions and first-person pronouns are more common in casual human writing.")
    t = f["transition_rate"]
    add("Formulaic transitions", f"{t:.0%} of sentences", 1 if t > 0.15 else (-1 if t < 0.04 else 0),
        "Openers like “Furthermore”, “Moreover”, “In conclusion”.")
    return sig
