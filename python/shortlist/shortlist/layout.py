"""ATS readability checks: things that make resume parsers drop or scramble content.

Most layout facts come from the extractor (shortlist.extract.Document.diagnostics): PDF columns from
PyMuPDF block positions, letter-spaced text that pypdf-style parsers produce, DOCX tables/text boxes,
contact details in headers. The pypdf layout heuristic below is only used when no Document is given.
"""
from __future__ import annotations

import io
import os
import re
from collections import Counter

from .parse import Profile

_EN_STOP = {"the", "and", "of", "to", "in", "for", "with", "a", "on", "as", "at", "by", "from", "an", "is", "was", "using"}
_NON_DATE = re.compile(r"^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$|^(present|current|now|to)$", re.I)
_ODD_GLYPHS = re.compile(r"[\ue000-\uf8ff\ufffd]|\(cid:\d+\)")  # private-use icon glyphs, replacement chars, (cid:NN)
_LIGATURES = re.compile(r"[\ufb00-\ufb06]")  # ff, fi, fl ... ligatures


def _two_column_pdf_pypdf(data: bytes) -> bool:
    """Fallback: a real second column starts at the same horizontal position on many rows of
    pypdf's layout-mode text; right-aligned dates start at varying positions."""
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(data))
        for page in reader.pages[:4]:
            rows = [r for r in page.extract_text(extraction_mode="layout").splitlines() if r.strip()]
            starts = Counter()
            for r in rows:
                for m in list(re.finditer(r"\S+(?:\s{1,2}\S+)*", r))[1:]:
                    words = [w for w in re.findall(r"[A-Za-z]{3,}", m.group(0)) if not _NON_DATE.match(w)]
                    if m.start() >= 25 and words:
                        starts[m.start() // 3] += 1
            if rows and starts:
                best = max(starts[b - 1] + starts[b] + starts[b + 1] for b in list(starts))
                if best >= 8 and best / len(rows) >= 0.2:
                    return True
    except Exception:
        pass
    return False


def check(filename: str | None, data: bytes | None, p: Profile, doc=None) -> dict:
    ext = os.path.splitext((filename or "").lower())[1] or ".txt"
    diag = doc.diagnostics if doc is not None else {}
    checks = []

    def add(cid, label, status, detail, weight):
        checks.append({"id": cid, "label": label, "status": status, "detail": detail, "weight": weight})

    photo = bool(diag.get("photo"))
    if ext == ".pdf" and (data or diag):
        cols = diag.get("column_pages", 0) > 0 if "column_pages" in diag else _two_column_pdf_pypdf(data)
        add("columns", "Single-column layout", "fail" if cols else "pass",
            "Text sits in side-by-side columns; many parsers read straight across and mix the two." if cols
            else "Reads top to bottom in one column.", 20)
        if diag.get("letter_spaced_elsewhere"):
            add("spacing", "Text extracts as words", "fail",
                "Some common PDF parsers read this file as spaced-out letters (“E x p e r i e n c e”), so keyword "
                "search finds nothing. Re-export from Word/Docs with “Save as PDF” (not print-to-PDF), and avoid "
                "letter-spacing on text.", 20)
    elif ext in (".docx", ".docm", ".dotx") and diag:
        add("columns", "Single-column layout", "fail" if diag.get("columns") else "pass",
            "Word section columns detected; parsers may interleave them." if diag.get("columns") else "No section columns.", 20)
        t = diag.get("tables", 0)
        add("tables", "No layout tables", "warn" if t else "pass",
            f"{t} table(s) holding text; some parsers skip or flatten tables." if t else "No tables.", 10)
        add("textboxes", "No text boxes", "fail" if diag.get("textboxes") else "pass",
            "Text boxes are often skipped entirely by parsers." if diag.get("textboxes") else "No text boxes.", 15)
        add("header", "Contact details in the body", "warn" if diag.get("header_contact") else "pass",
            "Email/phone sits in the page header or footer, which many ATS ignore." if diag.get("header_contact")
            else "Contact details are in the main body.", 10)
        photo = photo or diag.get("images", 0) > 0
    if ext in (".doc", ".odt", ".rtf", ".ott", ".fodt"):
        add("format", "ATS-friendly file type", "warn",
            f"{ext[1:].upper()} is accepted by fewer ATS than PDF or DOCX; export to one of those.", 5)
    elif ext in (".pdf", ".docx"):
        add("format", "ATS-friendly file type", "pass", f"{ext[1:].upper()} is widely supported.", 5)

    text = p.text
    odd = len(_ODD_GLYPHS.findall(text))
    lig = len(_LIGATURES.findall(text))
    add("glyphs", "Clean text extraction", "fail" if odd > 10 else ("warn" if odd or lig > 3 else "pass"),
        (f"{odd} unreadable symbol(s): icon fonts or embedded glyphs that parsers can't decode." if odd
         else f"{lig} ligature character(s) (ﬁ, ﬂ) may break keyword matching." if lig > 3 else "Text extracts cleanly."), 10)

    words = re.findall(r"[a-z]+", text.lower())
    eng = sum(w in _EN_STOP for w in words) / max(len(words), 1)
    add("english", "English-language resume", "pass" if eng >= 0.04 or len(words) < 80 else "warn",
        "Written in English." if eng >= 0.04 or len(words) < 80 else
        "Mostly not English: the role templates are English, so skills and headings may be missed.", 5)

    heads = {s["type"]: s for s in p.section_info}
    for sec, w, label in (("experience", 15, "Experience"), ("skills", 8, "Skills"), ("education", 8, "Education")):
        info = heads.get(sec)
        if info and info["source"] == "heading":
            add(f"sec_{sec}", f"“{label}” section", "pass", f"Found under “{info['heading']}”.", w)
        elif info:
            add(f"sec_{sec}", f"“{label}” section", "warn",
                f"Found from its content, but the heading (“{info['heading'] or 'none'}”) isn't one most parsers "
                f"recognise; use “{label}”.", w)
        else:
            add(f"sec_{sec}", f"“{label}” section", "fail" if sec == "experience" else "warn",
                f"No {label.lower()} section found; parsers use standard headings to file content.", w)

    add("email", "Email address", "pass" if p.emails else "fail",
        p.emails[0] if p.emails else "No email found in the text layer.", 10)
    add("phone", "Phone number", "pass" if p.phones else "warn", p.phones[0] if p.phones else "No phone number found.", 4)
    add("dates", "Parseable job dates", "pass" if p.jobs else "fail",
        f"{len(p.jobs)} role(s) with date ranges." if p.jobs
        else "No date ranges like “Jan 2020 – Present” found; ATS can't compute your experience.", 15)
    pages = diag.get("pages") or max(1, round(p.words / 550 + 0.4))
    add("length", "Length", "pass" if 300 <= p.words <= 1500 else "warn",
        f"About {p.words} words (~{pages} page{'s' if pages > 1 else ''})."
        + ("" if p.words >= 300 else " Very short for 5+ years of experience.")
        + ("" if p.words <= 1500 else " Long; recruiters skim the first page."), 5)

    lost = sum(c["weight"] * (1 if c["status"] == "fail" else 0.5 if c["status"] == "warn" else 0) for c in checks)
    total = sum(c["weight"] for c in checks) or 1
    return {"score": max(0.0, 1 - lost / total), "checks": checks, "photo": photo, "pages": pages}
