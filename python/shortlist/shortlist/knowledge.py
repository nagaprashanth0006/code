"""Loads the editable keyword templates in shortlist/kb/*.json."""
import json
import os

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kb")


def _load(name):
    with open(os.path.join(_DIR, name), encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


SKILLS = _load("skills.json")
ROLES = _load("roles.json")
LEVELS = _load("levels.json")
COUNTRIES = _load("countries.json")
LEVEL_IDS = [k for k in LEVELS if k != "title_words"]

# Role families (e.g. "IT / Infrastructure & AI", later "Engineering", ...) in the order they first appear.
FAMILIES = {}
for _rid, _r in ROLES.items():
    FAMILIES.setdefault(_r.get("family", "Other"), []).append(_rid)
