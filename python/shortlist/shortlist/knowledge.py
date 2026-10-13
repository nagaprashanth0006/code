"""Loads the editable keyword templates in shortlist/kb/*.json and resolves per-family, per-tier settings."""
import json
import os
from functools import lru_cache

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kb")


def _load(name):
    with open(os.path.join(_DIR, name), encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


SKILLS = _load("skills.json")
ROLES = _load("roles.json")
LEVELS = _load("levels.json")
COUNTRIES = _load("countries.json")
FAMILY_INFO = _load("families.json")
LEVEL_IDS = [k for k in LEVELS if k != "title_words"]
RANK = {lid: LEVELS[lid]["rank"] for lid in LEVEL_IDS}

# family id -> role ids, in families.json order (roles keep their roles.json order within a family)
FAMILIES = {fid: [rid for rid, r in ROLES.items() if r["family"] == fid] for fid in FAMILY_INFO}
FAMILIES = {fid: rids for fid, rids in FAMILIES.items() if rids}


def _validate():
    """Fail at startup with a clear message rather than mid-request when a template has a typo."""
    errors = []
    for fid, f in FAMILY_INFO.items():
        for key in ("ladder", "titles", "years"):
            missing = [l for l in LEVEL_IDS if l not in f.get(key, {})]
            if missing:
                errors.append(f"families.json: {fid}.{key} is missing {missing}")
        for key in ("signals", "skills"):
            errors += [f"families.json: {fid}.{key} has unknown tier {l!r}" for l in f.get(key, {}) if l not in RANK]
        errors += [f"families.json: {fid}.skills uses unknown skill {s!r}"
                   for ids in f.get("skills", {}).values() for s in ids if s not in SKILLS]
    for lid in LEVEL_IDS:
        errors += [f"levels.json: {lid}.skills uses unknown skill {s!r}" for s in LEVELS[lid]["skills"] if s not in SKILLS]
    for rid, r in ROLES.items():
        if r.get("family") not in FAMILY_INFO:
            errors.append(f"roles.json: {rid} has unknown family {r.get('family')!r}")
        for g in r["skills"]:
            errors += [f"roles.json: {rid} uses unknown skill {s!r}" for s in g["ids"] if s not in SKILLS]
            if g["w"] not in (1, 2, 3):
                errors.append(f"roles.json: {rid} has weight {g['w']} (use 1, 2 or 3)")
            if g.get("from") is not None and g["from"] not in RANK:
                errors.append(f"roles.json: {rid} has unknown tier 'from': {g['from']!r}")
        for key in ("years", "title_by_level"):
            errors += [f"roles.json: {rid}.{key} has unknown tier {l!r}" for l in r.get(key, {}) if l not in RANK]
    if errors:
        raise ValueError("Invalid Shortlist templates:\n  " + "\n  ".join(errors))


_validate()


@lru_cache(maxsize=None)
def level_config(fid: str, lid: str) -> dict:
    """A position tier as it applies to one family: ladder label, typical years, scope signals (tier
    defaults + family extras), seniority-evidence skills and the title words that rank job titles."""
    f, lv = FAMILY_INFO[fid], LEVELS[lid]
    return {
        "label": f["ladder"][lid],
        "years": f["years"][lid],
        "signals": {**lv["signals"], **f.get("signals", {}).get(lid, {})},
        "skills": f.get("skills", {}).get(lid, lv["skills"]),
        "target": lv["target"],
        "rank": lv["rank"],
        "title_words": f.get("title_words", LEVELS["title_words"]),
    }


def role_band(rid: str, lid: str) -> list:
    """Typical years for this role at this tier: the role's own band, else its family's."""
    return ROLES[rid].get("years", {}).get(lid) or FAMILY_INFO[ROLES[rid]["family"]]["years"][lid]


@lru_cache(maxsize=None)
def role_groups(rid: str, lid: str) -> tuple:
    """The skill groups that count for this role at this tier. Groups marked 'from' a higher tier are
    left out; a group repeated 'from' a tier adds its weight to the earlier one (it matters more there).
    Returns (ids, weight, tier) tuples; tier is the core/important/nice band (1-3) for display."""
    merged = {}
    for g in ROLES[rid]["skills"]:
        if g.get("from") and RANK[g["from"]] > RANK[lid]:
            continue
        key = tuple(g["ids"])
        merged[key] = merged.get(key, 0) + g["w"]
    return tuple((key, w, min(w, 3)) for key, w in merged.items())
