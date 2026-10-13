"""Resume fit scoring: role x seniority matrix, country fit, optional job-description match."""
from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import threading
import time

import numpy as np

from . import layout
from .knowledge import COUNTRIES, FAMILIES, LEVEL_IDS, LEVELS, ROLES, SKILLS
from .parse import Profile, normalize, parse

log = logging.getLogger(__name__)
# Role fit = weighted mix of these; the cell score = role fit x seniority gate x experience factor.
WEIGHTS = {"skills": 0.55, "semantic": 0.20, "title": 0.12, "ats": 0.13}
SENIORITY_FLOOR = 0.4  # gate = FLOOR + (1 - FLOOR) * seniority fit
MIN_YEARS = 5
EMBED_MODEL = os.environ.get("RESUME_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")


# ---------------------------------------------------------------- skill matching

def _alias_regex(aliases):
    ci = [a for a in aliases if not a.startswith("=")]
    cs = [a[1:] for a in aliases if a.startswith("=")]
    b = r"(?<![A-Za-z0-9])(?:{})(?![A-Za-z0-9])"
    out = []
    if ci:
        out.append(re.compile(b.format("|".join(re.escape(a) for a in sorted(ci, key=len, reverse=True))), re.I))
    if cs:
        out.append(re.compile(b.format("|".join(re.escape(a) for a in cs))))
    return out


SKILL_RX = {sid: _alias_regex(s["aliases"]) for sid, s in SKILLS.items()}


def find_skills(text: str) -> dict[str, list[int]]:
    """skill id -> character positions of each mention."""
    hits = {}
    for sid, rxs in SKILL_RX.items():
        pos = sorted({m.start() for rx in rxs for m in rx.finditer(text)})
        if pos:
            hits[sid] = pos
    return hits


def _evidence(p: Profile, sid: str, positions: list[int]) -> tuple[float, str]:
    """How convincing the mentions of a skill are: used in a recent job > older job >
    projects/summary > only listed in a skills section."""
    best, where = 0.0, ""
    for pos in positions:
        j = p.job_at(pos)
        sec = p.section_at(pos)
        if j is not None:
            age = p.jobs[j].years_since_end
            v = 1.0 if age <= 3 else 0.85 if age <= 6 else 0.7
            w = f"{p.jobs[j].title or 'role'} ({p.jobs[j].start[0]}–{'now' if p.jobs[j].current else p.jobs[j].end[0]})"
        elif sec in ("projects", "summary", "awards", "publications"):
            v, w = 0.8, sec
        elif sec in ("certifications", "education") and sid.startswith("cert_"):
            v, w = 1.0, "certifications"
        elif sec in ("skills", "certifications", "education"):
            v, w = 0.7, f"{sec} list"
        else:
            v, w = 0.75, "mentioned"
        if v > best:
            best, where = v, w
    return best, where


def _group_label(ids):
    labels = [SKILLS[i]["label"] for i in ids[:3]]
    return " / ".join(labels)


# ---------------------------------------------------------------- embeddings

class Embedder:
    def __init__(self):
        self.ok = False
        self._lock = threading.Lock()
        try:
            import torch
            from transformers import AutoModel, AutoTokenizer
            self.torch = torch
            self.tok = AutoTokenizer.from_pretrained(EMBED_MODEL)
            self.model = AutoModel.from_pretrained(EMBED_MODEL).eval()
            self.ok = True
        except Exception as e:  # pragma: no cover
            log.warning("Embedding model unavailable (%s); semantic similarity disabled", e)

    def __call__(self, texts: list[str]) -> np.ndarray:
        with self._lock, self.torch.inference_mode():
            enc = self.tok(texts, padding=True, truncation=True, max_length=256, return_tensors="pt")
            out = self.model(**enc).last_hidden_state
            mask = enc["attention_mask"].unsqueeze(-1).float()
            v = (out * mask).sum(1) / mask.sum(1).clamp_min(1e-9)
            v = self.torch.nn.functional.normalize(v, dim=-1)
        return v.numpy()


_embedder = None
_role_vecs = None
_load_lock = threading.Lock()


def embedder():
    """Load once. A request that arrives while the startup thread is still loading waits for that load
    instead of starting a second one."""
    global _embedder, _role_vecs
    if _embedder is None:
        with _load_lock:
            if _embedder is None:
                e = Embedder()
                if e.ok:
                    _role_vecs = e([r["description"] for r in ROLES.values()])
                _embedder = e
    return _embedder


def is_ready() -> bool:
    return _embedder is not None


def _chunks(text: str, size=120):
    words = text.split()
    return [" ".join(words[i:i + size]) for i in range(0, max(len(words), 1), size)][:40] or [text]


def _semantic(text: str) -> dict[str, float] | None:
    e = embedder()
    if not e.ok:
        return None
    vecs = e(_chunks(text))
    sims = vecs @ _role_vecs.T  # chunks x roles
    cos = {rid: float(np.sort(sims[:, k])[::-1][:3].mean()) for k, rid in enumerate(ROLES)}
    lo, hi = min(cos.values()), max(cos.values())
    # MiniLM cosine for resume-vs-role text runs ~0.2 (unrelated) to ~0.7 (same role). Blend an
    # absolute scale with the resume's own ranking so closely related roles still separate.
    # The ranking bonus only applies when the resume resembles at least one role; otherwise a
    # non-tech resume would still get full "relative" credit for its least-bad role.
    w_rel = 0.4 * min(1.0, max(0.0, (hi - 0.25) / 0.20))
    return {rid: (1 - w_rel) * min(1.0, max(0.0, (c - 0.25) / 0.40)) + w_rel * ((c - lo) / (hi - lo) if hi > lo else 0.5)
            for rid, c in cos.items()}


# ---------------------------------------------------------------- per-part scores

def _skills_for_role(p: Profile, hits, rid):
    role = ROLES[rid]
    num = den = 0.0
    matched, missing, groups = [], [], []
    for g in role["skills"]:
        best, where, sid_best = 0.0, "", None
        for sid in g["ids"]:
            if sid in hits:
                v, w = _evidence(p, sid, hits[sid])
                if v > best:
                    best, where, sid_best = v, w, sid
        num += g["w"] * best
        den += g["w"]
        groups.append({"label": SKILLS[sid_best]["label"] if sid_best else _group_label(g["ids"]), "w": g["w"],
                       "credit": best, "where": where})
        if best:
            matched.append({"skill": SKILLS[sid_best]["label"], "weight": g["w"], "credit": round(best, 2), "where": where})
        else:
            missing.append({"skill": _group_label(g["ids"]), "weight": g["w"]})
    coverage = num / den
    missing.sort(key=lambda m: -m["weight"])
    matched.sort(key=lambda m: (-m["weight"], -m["credit"]))
    return min(1.0, coverage / 0.7), coverage, matched, missing, groups


SKILL_SATURATION = 0.7  # covering 70% of a role's weighted template already counts as a full skills score


def _title_for_role(p: Profile, rid):
    titles = [(j.title or j.header) for j in p.jobs[:4]]
    weights = [1.0, 0.85, 0.7, 0.6]
    cands = list(zip(titles, weights))
    if p.headline:
        cands.append((p.headline, 0.9))
    best, why = 0.0, ""
    for t, w in cands:
        tl = t.lower()
        for phrase, strength in ROLES[rid]["titles"].items():
            if re.search(rf"(?<![a-z]){re.escape(phrase)}(?![a-z])", tl) and strength * w > best:
                best, why = strength * w, t
    return best, why


def _seniority(p: Profile, years: float, lid: str, hits):
    lv = LEVELS[lid]
    a, b = lv["years"]
    if years < a:
        ys = max(0.0, 1 - (a - years) / 4)
    elif years > b:
        ys = max(0.5, 1 - (years - b) / 10)
    else:
        ys = 1.0
    exp_text = (p.section_text("experience") or p.text).lower() + "\n" + p.section_text("summary").lower()
    found, total, absent = [], 0.0, []
    for phrase, w in lv["signals"].items():
        if re.search(rf"(?<![a-z]){re.escape(phrase)}(?![a-z])", exp_text):
            found.append(phrase)
            total += w
        else:
            absent.append((w, phrase))
    for sid in lv["skills"]:
        if sid in hits:
            found.append(SKILLS[sid]["label"])
            total += 1.5
        else:
            absent.append((1.5, SKILLS[sid]["label"]))
    sig = min(1.0, total / lv["target"])
    # Don't suggest variants of what's already there ("mentoring" when the resume says "mentored")
    stems = {w[:5] for f in found for w in f.lower().split() if len(w) >= 5}
    absent = [(w, ph) for w, ph in absent if not any(x[:5] in stems for x in ph.lower().split() if len(x) >= 5)]
    if p.title_rank is None:
        ts = 0.5
    else:
        d = abs(lv["rank"] - max(p.title_rank, 0))
        ts = [1.0, 0.65, 0.3, 0.1, 0.05][min(d, 4)]
    score = 0.45 * ys + 0.35 * sig + 0.20 * ts
    absent.sort(key=lambda x: -x[0])
    return score, {"years": round(ys, 2), "signals": round(sig, 2), "title": round(ts, 2), "found": found[:12],
                   "band": [a, b], "_raw": {"ys": ys, "total": total, "target": lv["target"], "ts": ts, "absent": absent}}


def _seniority_score(ys, total, target, ts):
    return 0.45 * ys + 0.35 * min(1.0, total / target) + 0.20 * ts


def _exp_factor(years: float) -> float:
    # Below 5 years there is too little scope to judge senior infra/AI roles: 4y -> 0.88, 2y -> 0.64, 0 -> 0.4
    return 1.0 if years >= MIN_YEARS else 0.4 + 0.12 * max(0.0, years)


# ---------------------------------------------------------------- country fit

def _country(p: Profile, cid: str, ats: dict):
    c = COUNTRIES[cid]
    notes = []
    members = {k for k, v in COUNTRIES.items() if v["eu"] and k != "eu"}
    in_country = cid in p.locations or (cid == "eu" and any(l in members or l == "eu" for l in p.locations))
    same_region = any(COUNTRIES[l]["region"] == c["region"] for l in p.locations)

    # Eligibility
    if cid in p.auth:
        elig = 1.0
        notes.append("Work authorisation stated: " + ", ".join(p.auth[cid][:3]) + ".")
    elif in_country:
        elig = 0.85
        notes.append(f"Based in {c['label']}: likely eligible, but say so explicitly (citizenship, PR or permit).")
    elif same_region and c["eu"] and any(COUNTRIES[l]["eu"] for l in p.locations):
        elig = 0.6
        notes.append("Based elsewhere in the EU: if you're an EU citizen, state it; you won't need a permit.")
    else:
        elig = 0.4
        notes.append(f"No right to work in {c['label']} stated. If you have it, add it near the top; if not, expect to need sponsorship.")

    # Location
    if in_country:
        loc = 1.0
    elif not p.locations:
        loc = 0.5
        notes.append("No location found on the resume; add city and country.")
    elif same_region:
        loc = 0.65
    else:
        loc = 0.35
        if "relocat" not in " ".join(p.generic_auth):
            notes.append("You're based abroad: mention willingness to relocate (or remote preference).")

    # Degree: the EU Blue Card and most skilled-worker routes in these markets expect one
    if c["eu"] and cid != "russia":
        if p.degree_level is not None and p.degree_level >= 2:
            notes.append("Degree found on the resume, which the EU Blue Card requires (along with a salary threshold).")
        else:
            notes.append("No bachelor's degree found: the EU Blue Card needs one (or, in some countries, recognised "
                         "professional experience). List it clearly if you have it.")

    # Language (the resume's own language counts as English when English isn't listed)
    langs = {k.lower(): v for k, v in p.effective_languages().items()}
    imm = [l.lower() for l in c["immigration_language"]]
    imm_ok = not imm or any(langs.get(l, 0) >= 0.5 for l in imm)
    local = [l.lower() for l in c["local_languages"]]
    prof = max((langs.get(l, 0) for l in local), default=1.0)
    base = {"high": 0.85, "medium": 0.7, "low": 0.5}[c["english_work"]]
    lang = (base + (1 - base) * prof) * (1.0 if imm_ok else 0.6)
    if not imm_ok:
        notes.append("Immigration route needs proof of " + " or ".join(c["immigration_language"]) + "; list it with a level.")
    if local and prof < 0.5 and "english" not in local:
        notes.append(f"{' / '.join(c['local_languages'])} not listed — optional for many tech roles, but a plus"
                     + (" and expected by most local employers." if c["english_work"] == "low" else "."))

    # Conventions
    conv = 1.0
    personal = set(p.personal) | ({"photo"} if ats.get("photo") else set())
    if c["personal_data"] == "discouraged" and personal & {"dob", "marital", "photo", "gender"}:
        conv -= 0.4
        notes.append("Remove " + ", ".join(sorted(personal & {"dob", "marital", "photo", "gender"})).replace("dob", "date of birth")
                     + f": discouraged in {c['label']}.")
    if ats.get("pages", 1) > c["pages"][1]:
        conv -= 0.2
        notes.append(f"Trim to {c['pages'][1]} page{'s' if c['pages'][1] > 1 else ''}; typical for {c['label']}.")
    if c["eu"] and "languages" not in p.sections:
        conv -= 0.15
        notes.append("Add a Languages section with CEFR levels (e.g. English C1, German B1).")
    conv = max(0.0, conv)

    score = 0.40 * elig + 0.20 * loc + 0.25 * lang + 0.15 * conv
    return {"id": cid, "label": c["label"], "score": round(score, 3),
            "parts": {"eligibility": round(elig, 2), "location": round(loc, 2), "language": round(lang, 2),
                      "conventions": round(conv, 2)},
            "notes": notes, "guidance": c["notes"]}


# ---------------------------------------------------------------- job description

JD_REQ = re.compile(r"require|must|essential|qualification|what you('ll)? (need|bring)|you have|minimum", re.I)
JD_NICE = re.compile(r"nice to have|preferred|bonus|plus|desirable|advantage|ideally", re.I)


_STOP = set("""a about above across after again against all also an and any are as at be because been before being
below between both but by can could did do does doing down during each either etc few for from further get had has
have having he her here how i if in into is it its just like may me more most must my no nor not now of off on once
only or other our out over own per same she should so some such than that the their them then there these they this
those through to too under until up upon us use used using very via was we well were what when where which while who
whom why will with within would you your yours ability able experience experienced years year strong excellent good
great knowledge understanding skills skill work working team teams role position job description responsibilities
requirements required preferred plus bonus nice qualifications candidate candidates company client clients business
including include includes new etc environment environments solutions solution support develop development design
designing build building maintain manage management ensure provide provided across multiple various key level senior
junior lead looking join opportunity remote hybrid onsite location duration contract full time term long hands related
field degree bachelor bachelors master masters equivalent communication verbal written problem solving least minimum
ideal ideally successful history plan planning ownership best practices tools technologies technology systems system
data services service platform platforms application applications project projects process processes quality high
large scale global world us usa inc llc ltd day days week weeks month months hour hours salary benefits pay equal
employer opportunity status race gender veteran disability""".split())
_US_STATES = set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split())
_MONTHS = {"January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December"}
# Tool-shaped tokens only: dotted/symbol names (Node.js, C#, C++, CI/CD, ASP.NET), acronyms (SQL, SSIS,
# ETL, AWS), and names with digits (HTML5, EC2, ES6). Plain words and hyphenated adjectives are left to the
# skill catalogue and the semantic comparison.
_TECHY = re.compile(r"(?<![\w.#+/-])(?:\.?[A-Za-z][A-Za-z0-9]*(?:[./][A-Za-z0-9]+|[#+]+)+|[A-Z][A-Z0-9]{1,5}s?|[A-Za-z]{1,5}[0-9]+[A-Za-z0-9]*)(?![\w#+/-])")
_ACRO_STOP = {"EEO", "ADA", "USA", "US", "UK", "EU", "OR", "AND", "THE", "TO", "IN", "OF", "FOR", "A", "I", "IT", "HR",
              "PTO", "CEO", "CTO", "VP", "LLC", "INC", "LTD", "NA", "TBD", "ASAP", "FAQ", "W2", "C2C", "H1B", "GC", "EST",
              "PST", "CST", "IST", "SPOC", "JD", "YOE", "WFH", "N/A", "E.G", "I.E", "ETC", "PLUS", "NEW", "SR", "JR"}


def _jd_sections(jd: str):
    """Weight for each character: 3 inside 'requirements', 1 inside 'nice to have', else 2."""
    marks, mode, pos = [], 2, 0
    for ln in jd.split("\n"):
        if JD_NICE.search(ln) and len(ln.split()) < 12:
            mode = 1
        elif JD_REQ.search(ln) and len(ln.split()) < 12:
            mode = 3
        marks.append((pos, mode))
        pos += len(ln) + 1
    return lambda at: next((m for o, m in reversed(marks) if o <= at), 2)


def _jd_keywords(jd: str, catalog_aliases: set[str], limit=25):
    """ATS-style literal keywords not already covered by the skill catalogue, ranked by frequency
    and section weight. Terms that appear in the posting's own URLs/emails (the company) are dropped."""
    wt = _jd_sections(jd)
    domains = " ".join(re.findall(r"(?:https?://|www\.)\S+|\S+@\S+", jd)).lower()
    jd_clean = re.sub(r"(?:https?://|www\.)\S+|\S+@\S+", " ", jd)
    # Postings pasted from web pages often lose line breaks: "equipment.Conduct", "domain.2", "RHEL.Experience"
    jd_clean = re.sub(r"([A-Za-z0-9)])([.:;])([A-Z][a-z]|\d)", r"\1\2 \3", jd_clean)
    cand = {}
    for m in _TECHY.finditer(jd_clean):
        k = m.group(0).rstrip(".,;:/")
        low = k.lower()
        if (len(k) < 2 or k.upper() in _ACRO_STOP or k in _US_STATES or low in catalog_aliases
                or low.rstrip("s") in catalog_aliases or (len(low) > 3 and low in domains) or re.fullmatch(r"[\d.]+", k)):
            continue
        c = cand.setdefault(low, [k, 0.0])
        c[1] += wt(m.start())
    ranked = sorted(cand.values(), key=lambda x: -x[1])[:limit]
    return [(k, min(3, max(1, round(s)))) for k, s in ranked]


_ALL_ALIASES = {a.lstrip("=").lower() for s in SKILLS.values() for a in s["aliases"]}


def _jd(p: Profile, hits, jd: str):
    wt = _jd_sections(jd)
    weight = {sid: wt(ps[0]) for sid, ps in find_skills(jd).items()}
    num = den = 0.0
    matched, missing = [], []
    for sid, w in sorted(weight.items(), key=lambda x: -x[1]):
        v = _evidence(p, sid, hits[sid])[0] if sid in hits else 0.0
        num += w * v
        den += w
        (matched if v else missing).append({"skill": SKILLS[sid]["label"], "weight": w})
    # Generic keywords beyond the catalogue (an ATS search matches literal terms)
    low = p.text.lower()
    for k, w in _jd_keywords(jd, _ALL_ALIASES):
        ok = re.search(r"(?<![a-z0-9])" + re.escape(k.lower()).replace(r"\ ", r"\s+") + r"(?![a-z0-9])", low)
        num += w * 0.6 * (1.0 if ok else 0.0)
        den += w * 0.6
        (matched if ok else missing).append({"skill": k, "weight": w, "keyword": True})
    if not den:
        return None
    skills = num / den
    sem = None
    e = embedder()
    if e.ok:
        r = e(_chunks(p.text))
        j = e(_chunks(jd, 80))
        # how well each part of the posting is covered by the resume
        sem = float((j @ r.T).max(1).mean())
        sem = min(1.0, max(0.0, (sem - 0.25) / 0.40))
    yrs = [int(m) for m in re.findall(r"(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years|yrs)", jd, re.I) if 1 <= int(m) <= 25]
    need = min(yrs) if yrs else None
    score = 0.6 * skills + 0.4 * (sem if sem is not None else skills)
    if need and p.years < need:
        score *= max(0.6, 1 - (need - p.years) * 0.08)
    matched.sort(key=lambda m: -m["weight"])
    missing.sort(key=lambda m: -m["weight"])
    return {"score": round(score, 3), "skills": round(skills, 3), "semantic": None if sem is None else round(sem, 3),
            "years_required": need, "matched": matched, "missing": missing}


# ---------------------------------------------------------------- how to improve

def _cell(parts, weights, factor):
    role_fit = sum(weights[k] * parts[k] for k in weights)
    return role_fit * (SENIORITY_FLOOR + (1 - SENIORITY_FLOOR) * parts["seniority"]) * factor


def _ats_score(checks, fixed):
    total = sum(c["weight"] for c in checks) or 1
    lost = sum(c["weight"] * (0 if c["id"] in fixed else 1 if c["status"] == "fail" else 0.5 if c["status"] == "warn" else 0)
               for c in checks)
    return max(0.0, 1 - lost / total)


def _target_title(rid, lid):
    base = next((t for t, s in ROLES[rid]["titles"].items() if s >= 1), ROLES[rid]["label"]).title()
    for raw, fixed in (("Sre", "SRE"), ("Mlops", "MLOps"), ("Aiops", "AIOps"), ("Devops", "DevOps"), ("Llmops", "LLMOps"),
                       ("Ai", "AI"), ("Ml", "ML"), ("Genai", "GenAI"), ("Llm", "LLM"), ("Qa", "QA"), ("Sdet", "SDET")):
        base = re.sub(rf"\b{raw}\b", fixed, base)
    if not re.search(r"Engineer|Architect", base):
        base += " Engineer"
    arch = re.sub(r"Engineer(ing)?$", "Architect", base)
    return {"engineer": base, "senior": "Senior " + base, "lead": "Lead " + base, "architect": arch,
            "sr_architect": "Principal " + arch}[lid]


def _improve(p, rid, lid, parts, groups, sraw, ats, weights, factor, years):
    """Simulates concrete edits and estimates how many points each adds to this role x level score.
    The meaning-based similarity part is held fixed, so gains are approximate."""
    den = sum(g["w"] for g in groups) or 1
    st0 = {"num": sum(g["w"] * g["credit"] for g in groups), "title": parts["title"], "fixed": frozenset(),
           "sig": sraw["total"]}

    def score(st):
        pp = dict(parts)
        pp["skills"] = min(1.0, st["num"] / den / SKILL_SATURATION)
        pp["title"] = st["title"]
        pp["ats"] = _ats_score(ats["checks"], st["fixed"])
        pp["seniority"] = _seniority_score(sraw["ys"], st["sig"], sraw["target"], sraw["ts"])
        return _cell(pp, weights, factor)

    base = score(st0)
    cands = []  # (kind, text, change-function)
    for g in sorted(groups, key=lambda g: -g["w"]):
        tier = {3: "Core", 2: "Important", 1: "Nice-to-have"}[g["w"]]
        if g["credit"] == 0:
            cands.append(("skill", f"{tier} skill missing: {g['label']}. If you have used it, add a bullet to a recent "
                                   "role showing what you did with it and the result.",
                          lambda st, g=g: {**st, "num": st["num"] + g["w"]}))
        elif g["credit"] < 0.9:
            cands.append(("evidence", f"{g['label']} only appears in your {g['where']}. Show it in a recent job bullet "
                                      "with an outcome so it counts fully.",
                          lambda st, g=g: {**st, "num": st["num"] + g["w"] * (1 - g["credit"])}))
    if parts["title"] < 0.85:
        t = _target_title(rid, lid)
        cands.append(("title", f"Add a headline under your name that matches the target, e.g. “{t}” "
                               "(only if it honestly describes your work).",
                      lambda st: {**st, "title": max(st["title"], 0.9)}))
    for c in ats["checks"]:
        if c["status"] != "pass":
            cands.append(("ats", f"ATS: {c['label']}: {c['detail']}", lambda st, c=c: {**st, "fixed": st["fixed"] | {c["id"]}}))
    if sraw["total"] < sraw["target"]:
        need, picks = sraw["target"] - sraw["total"], []
        used = set()
        for w, phrase in sraw["absent"]:
            if need <= 0 or len(picks) >= 4:
                break
            words = set(phrase.lower().split())
            if words & used:  # keep suggestions varied: not "tech lead", "technical lead", "team lead"
                continue
            picks.append(phrase)
            used |= words
            need -= w
        gain_sig = sraw["target"] - sraw["total"] - max(need, 0)
        if picks:
            label = LEVELS[lid]["label"]
            cands.append(("scope", f"Show {label}-level scope in your bullets, e.g. "
                                   + ", ".join(f"“{x}”" for x in picks) + ": who you led or influenced, what you "
                                   "decided, and the measurable outcome (only where it's accurate).",
                          lambda st, gs=gain_sig: {**st, "sig": st["sig"] + gs}))

    actions = []
    for kind, text, fn in cands:
        gain = score(fn(st0)) - base
        if gain >= 0.004:
            actions.append({"kind": kind, "text": text, "gain": round(gain, 3)})
    actions.sort(key=lambda a: -a["gain"])
    st_all = st0
    for _, _, fn in cands:
        st_all = fn(st_all)
    notes = []
    a, b = LEVELS[lid]["years"]
    if years < a:
        notes.append(f"{LEVELS[lid]['label']} roles typically ask for {a}+ years; the resume shows {years:g}. "
                     "Editing can't change that — make sure every role has dates, or target a lower level.")
    if factor < 1:
        notes.append(f"Under {MIN_YEARS} years of experience caps every score (×{factor:.2f}).")
    return {"potential": round(min(1.0, score(st_all)), 3), "actions": actions[:8], "notes": notes}


# ---------------------------------------------------------------- main entry

# Parsed resumes live in memory only, so the experience slider and dropdowns re-score instantly. Entries
# expire after CACHE_TTL seconds, at most CACHE_MAX are kept, and forget() drops one ("Clear") or all.
CACHE_TTL = 15 * 60
CACHE_MAX = 16
_cache: dict[str, tuple[float, tuple]] = {}
_cache_lock = threading.Lock()


def _prepare(key: str, text: str, styled: tuple, doc_date):
    now = time.time()
    with _cache_lock:
        for k in [k for k, (t, _) in _cache.items() if now - t > CACHE_TTL]:
            del _cache[k]
        hit = _cache.get(key)
        if hit:
            _cache[key] = (now, hit[1])
            return hit[1]
    p = parse(text, dict(styled), doc_date)
    value = (p, find_skills(p.text), _semantic(p.text))
    with _cache_lock:
        _cache[key] = (now, value)
        while len(_cache) > CACHE_MAX:
            del _cache[min(_cache, key=lambda k: _cache[k][0])]
    return value


def forget(key: str | None = None) -> int:
    with _cache_lock:
        if key is None:
            n = len(_cache)
            _cache.clear()
            return n
        return 1 if _cache.pop(key, None) else 0


def analyze(text: str, filename: str | None = None, data: bytes | None = None, years: float | None = None,
            jd: str | None = None, doc=None) -> dict:
    """doc: the extractor's Document (formatting hints, metadata dates, layout diagnostics), if any."""
    text = normalize(text)
    styled = tuple(sorted((doc.headings if doc else {}).items()))
    doc_date = (doc.modified or doc.created) if doc else None
    key = hashlib.sha1((text + repr(styled) + str(doc_date)).encode("utf-8", "ignore")).hexdigest()
    p, hits, sem = _prepare(key, text, styled, doc_date)
    ats = layout.check(filename, data, p, doc)
    y = float(years) if years is not None else p.years
    factor = _exp_factor(y)

    weights = dict(WEIGHTS)
    if sem is None:
        weights.pop("semantic")
        s = sum(weights.values())
        weights = {k: v / s for k, v in weights.items()}

    roles, groups = {}, {}
    for rid in ROLES:
        sk, cov, matched, missing, groups[rid] = _skills_for_role(p, hits, rid)
        ts, why = _title_for_role(p, rid)
        roles[rid] = {"label": ROLES[rid]["label"], "skills": round(sk, 3), "coverage": round(cov, 3),
                      "semantic": None if sem is None else round(sem[rid], 3), "title": round(ts, 3),
                      "title_evidence": why, "matched": matched, "missing": missing}
    levels, matrix, raw = {}, {}, {}
    for lid in LEVEL_IDS:
        sc, detail = _seniority(p, y, lid, hits)
        raw[lid] = detail.pop("_raw")
        levels[lid] = {"label": LEVELS[lid]["label"], "score": round(sc, 3), **detail}
    for rid, r in roles.items():
        row = {}
        for lid, lv in levels.items():
            parts = {"skills": r["skills"], "semantic": r["semantic"], "title": r["title"], "seniority": lv["score"],
                     "ats": round(ats["score"], 3)}
            role_fit = sum(weights[k] * parts[k] for k in weights)
            gate = SENIORITY_FLOOR + (1 - SENIORITY_FLOOR) * lv["score"]
            row[lid] = {"score": round(role_fit * gate * factor, 3), "role_fit": round(role_fit, 3),
                        "gate": round(gate, 3), "parts": parts,
                        "improve": _improve(p, rid, lid, parts, groups[rid], raw[lid], ats, weights, factor, y)}
        matrix[rid] = row

    countries = [_country(p, cid, ats) for cid in COUNTRIES]
    jd_res = _jd(p, hits, jd) if jd and jd.strip() else None

    return {
        "profile": {
            "years_derived": p.years, "years_used": y, "min_years": MIN_YEARS, "exp_factor": round(factor, 2),
            "years_source": p.years_source, "years_stated": p.years_stated, "years_dates": p.years_dates,
            "years_note": p.years_note, "as_of": f"{p.as_of[1]:02d}/{p.as_of[0]}", "as_of_source": p.as_of_source,
            "education": p.education, "degree_level": p.degree_level, "section_info": p.section_info,
            "languages_inferred_english": "English" not in p.languages,
            "headline": p.headline, "title_rank": p.title_rank,
            "title_level": None if p.title_rank is None else
            next((LEVELS[l]["label"] for l in LEVEL_IDS if LEVELS[l]["rank"] == max(p.title_rank, 0)), None),
            "jobs": [{"title": j.title, "company": j.company, "start": f"{j.start[1]:02d}/{j.start[0]}",
                      "end": "Present" if j.current else f"{j.end[1]:02d}/{j.end[0]}", "months": j.months} for j in p.jobs],
            "emails": p.emails, "phones": p.phones, "linkedin": p.linkedin, "github": p.github,
            "location": p.location_text, "locations": [COUNTRIES[l]["label"] for l in p.locations],
            "languages": p.languages, "auth": {COUNTRIES[k]["label"]: v for k, v in p.auth.items()},
            "generic_auth": p.generic_auth, "personal": p.personal, "sections": sorted(p.sections),
            "words": p.words, "bullets": p.bullets, "quantified": p.quantified,
            "skills_found": sorted({SKILLS[s]["label"] for s in hits}),
        },
        "weights": weights, "seniority_floor": SENIORITY_FLOOR,
        "ats": ats,
        "roles": roles,
        "levels": levels,
        "matrix": matrix,
        "role_order": list(ROLES),
        "families": FAMILIES,
        "doc_key": key,
        "level_order": LEVEL_IDS,
        "countries": countries,
        "jd": jd_res,
        "suggestions": _suggestions(p, roles, levels, ats, y),
    }


def _suggestions(p, roles, levels, ats, years):
    out = []
    if years < MIN_YEARS:
        out.append(f"The resume shows about {years:g} years of experience; these roles expect 5+, so all scores are reduced "
                   f"(×{_exp_factor(years):.2f}). If dates are missing for some roles, add them.")
    for c in ats["checks"]:
        if c["status"] == "fail":
            out.append(f"ATS: {c['label']}: {c['detail']}")
    if p.bullets >= 6 and p.quantified / max(p.bullets, 1) < 0.3:
        out.append(f"Only {p.quantified} of {p.bullets} experience bullets have numbers. Quantify impact "
                   "(latency −40%, 99.95% uptime, $120k/yr saved, 30 services migrated).")
    if not (p.generic_auth or p.auth):
        out.append("State your work authorisation / visa status and relocation preference near the top.")
    if not p.linkedin:
        out.append("Add a LinkedIn URL; recruiters cross-check it.")
    return out
