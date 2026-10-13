"""Resume parsing: sections, jobs with date ranges, experience, education, languages, contacts,
location and work-authorisation signals - roughly what an ATS parser extracts.

Sections are inferred, not looked up in a fixed list:
  1. heading shape  - short line, ALL CAPS / bold / heading style / larger font (from the extractor)
  2. heading words  - fuzzy match of the words against section roots ("EDUCATIONAL QUALIFICATION",
                      "Employment Details", "Education & Professional Development"...)
  3. block content  - what is under the heading: date ranges + titles -> experience, degrees ->
                      education, language names -> languages... This rescues unusual or missing headings.

Experience: the figure the resume states ("6 years of total work experience") is the authority; the
job dates are the fallback. "Present" is dated by the resume's as-of date (stated-years anchor or
document metadata), not by today, so older resumes aren't inflated.
"""
from __future__ import annotations

import datetime as dt
import difflib
import re
from dataclasses import dataclass, field

from .knowledge import COUNTRIES, LEVELS

# ------------------------------------------------------------------ section vocabulary
# type -> (strong roots, weak roots). A strong root alone names the section; weak roots only
# decide when nothing stronger is present ("Technical Experience" -> experience, not skills).
ROOTS = {
    "experience": (["experience", "experiences", "employment", "positions", "workplaces"],
                   ["work", "working", "career", "history", "background", "jobs"]),
    "education": (["education", "educational", "academic", "academics", "qualification", "qualifications",
                   "degree", "degrees", "schooling"], ["studies", "study"]),
    "skills": (["skills", "skill", "competencies", "competency", "expertise", "proficiencies", "technologies",
                "toolbox", "stack", "toolkit"], ["technical", "tools", "tech", "knowledge", "strengths", "abilities"]),
    "certifications": (["certifications", "certification", "certificates", "certificate", "licenses", "licences",
                        "accreditations", "credentials"], ["courses", "course", "training", "trainings"]),
    "languages": (["languages", "language"], []),
    "projects": (["projects", "project", "portfolio"], []),
    "summary": (["summary", "objective", "overview", "introduction", "synopsis", "about"], ["profile", "highlights"]),
    "personal": (["personal", "contact"], ["details", "information", "info"]),
    "awards": (["awards", "achievements", "achievement", "honors", "honours", "accomplishments", "recognition"], []),
    "publications": (["publications", "papers", "talks", "patents", "speaking"], []),
    "interests": (["interests", "hobbies", "activities", "volunteering", "volunteer"], []),
    "references": (["references", "referees"], []),
}
_ROOT_INDEX = [(r, t, 1.0) for t, (strong, _) in ROOTS.items() for r in strong] + \
              [(r, t, 0.5) for t, (_, weak) in ROOTS.items() for r in weak]
# Common multi-word headings whose meaning isn't simply their last noun.
EXACT = {
    "skills summary": "skills", "technical summary": "skills", "summary of skills": "skills",
    "experience summary": "experience", "project experience": "experience", "projects experience": "experience",
    "professional experience summary": "experience", "summary of qualifications": "summary",
    "career profile": "summary", "professional profile": "summary", "personal profile": "personal",
    "personal details": "personal", "personal information": "personal", "contact information": "personal",
    "education and certifications": "education", "education & certifications": "education",
    "education and training": "education", "courses and certifications": "certifications",
    "licenses and certifications": "certifications", "work experience": "experience",
    "key achievements": "awards", "open source": "projects", "open source contributions": "projects",
    "side projects": "projects", "personal projects": "projects", "personal project": "projects",
}
_SKILL_LANG = re.compile(r"\b(programming|scripting|development|computer|coding|query|markup|software)\b", re.I)

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
_MON = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
_DATE = (rf"(?:{_MON}\s*'?\s*(?:19|20)\d{{2}}|(?:0?[1-9]|1[0-2])\s*[/.]\s*(?:19|20)\d{{2}}"
         rf"|(?:19|20)\d{{2}}\s*[/.]\s*(?:0?[1-9]|1[0-2])(?!\d)|(?:19|20)\d{{2}})")
_CURRENT = r"(?:present|current|currently|now|today|ongoing|till\s*date|to\s*date|date)"
_END = rf"(?:{_DATE}|{_CURRENT})"
RANGE = re.compile(rf"(?P<s>{_DATE})\s*(?:–|—|-|−|~|to|until|till|through|thru)\s*(?P<e>{_END})", re.I)

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
LINKEDIN = re.compile(r"linkedin\.com/in/[\w-]+", re.I)
GITHUB = re.compile(r"github\.com/[\w-]+", re.I)
BULLET = re.compile(r"^\s*(?:[-•*▪●◦‣·–—>➢➤►✓✔]|\d+[.)])\s+")
TITLE_WORDS = re.compile(r"\b(engineer|engineering|developer|architect|sre|devops|lead|manager|scientist|consultant|analyst|"
                         r"administrator|admin|dba|specialist|head|director|programmer|intern|principal|staff|cto|vp|officer|"
                         r"owner|researcher|technologist|sdet|tester|qa|designer|technician|associate|executive|"
                         r"coordinator|trainee|expert|fellow|instructor|trainer|partner|founder|supervisor|assistant|"
                         r"clerk|representative|teacher|nurse|accountant|agent|operator|mechanic|foreman|superintendent|"
                         r"inspector|auditor|advisor|adviser|counselor|counsellor|receptionist|planner|buyer|"
                         r"president|chief|editor|writer|support)\b", re.I)
LABEL = re.compile(r"^\s*(?P<k>designation|role|position|job title|title|current employer|employer|company|organi[sz]ation|"
                   r"client|current client|work period|duration|period|tenure|dates?)\s*[:\-–]\s*(?P<v>.*)$", re.I)
_TITLE_LABELS = {"designation", "role", "position", "job title", "title"}
_ABBR_END = r"(?:Ltd|Inc|Co|Corp|Pvt|LLC|L\.L\.C|S\.A|B\.V|N\.V|GmbH|AG|Pte|Bhd|Sdn|PLC|LLP|Jr|Sr)\.$"
_PROSE_LABEL = r"(?i)^(key accomplishments?|accomplishments?|achievements?|highlights?|summary|description|" \
               r"project description|environment|technologies used|tools used|tech stack)\s*:"
_COMPANY_LABELS = {"current employer", "employer", "company", "organisation", "organization", "client", "current client"}

DEGREE = re.compile(r"\b(ph\.?\s?d|doctorate|master(?:'?s)?|bachelor(?:'?s)?|m\.?\s?tech|b\.?\s?tech|m\.?\s?sc|b\.?\s?sc|"
                    r"m\.?\s?b\.?\s?a|mba|mca|bca|b\.\s?e\.?|m\.\s?e\.?|b\.\s?com|m\.\s?com|associate degree|post[\s-]?graduate|"
                    r"pg diploma|diploma|certificate programme|certificate program|advanced certificate|"
                    r"intermediate|higher secondary|senior secondary|secondary school|high school|s\.?\s?s\.?\s?c|"
                    r"h\.?\s?s\.?\s?c|a-levels?|gcse|abitur|engineering degree)\b", re.I)
_DEGREE_SHORT = re.compile(r"\b(BE|ME|BS|MS|BA|MA|BEng|MEng|BSc|MSc|B\.E|M\.E|B\.S|M\.S)\b")
INSTITUTION = re.compile(r"\b(university|college|institute|institution|school|academy|polytechnic|iit|nit|iiit|jntu[a-z-]*|"
                         r"universit[äa]t|hochschule|ecole|école)\b", re.I)
_DEGREE_LEVEL = [(4, r"ph\.?\s?d|doctorate"), (3, r"master|m\.?\s?tech|m\.?\s?sc|mba|m\.?\s?b\.?\s?a|mca|m\.\s?e|m\.\s?com|"
                                               r"post[\s-]?graduate|\bms\b|\bma\b|meng"),
                 (2, r"bachelor|b\.?\s?tech|b\.?\s?sc|bca|b\.\s?e|b\.\s?com|engineering degree|\bbs\b|\bba\b|\bbe\b|beng"),
                 (1, r"diploma|associate degree|certificate"), (0, r".")]

LANGS = ["english", "german", "french", "spanish", "portuguese", "dutch", "danish", "finnish", "swedish", "norwegian",
         "russian", "japanese", "hindi", "malay", "bahasa melayu", "bahasa malaysia", "mandarin", "chinese", "cantonese",
         "tamil", "telugu", "kannada", "malayalam", "marathi", "bengali", "gujarati", "punjabi", "urdu", "odia", "oriya",
         "italian", "polish", "arabic", "korean", "ukrainian", "turkish", "greek", "czech", "romanian", "hungarian",
         "hebrew", "persian", "farsi", "vietnamese", "thai", "indonesian", "tagalog", "filipino", "deutsch", "nepali",
         "sinhala", "swahili"]
LANG_ALIAS = {"deutsch": "german", "bahasa melayu": "malay", "bahasa malaysia": "malay", "chinese": "mandarin",
              "filipino": "tagalog", "oriya": "odia", "farsi": "persian"}
LEVEL_TOKENS = [
    (1.0, r"native|mother tongue|first language|bilingual"),
    (0.9, r"fluent|fluency|c2|c1|full professional|proficient|advanced|jlpt\s*n1|n1"),
    (0.7, r"professional working|working proficiency|b2|upper[- ]intermediate|jlpt\s*n2|n2|good"),
    (0.5, r"b1|intermediate|conversational|jlpt\s*n3|n3|limited working"),
    (0.25, r"a2|a1|basic|elementary|beginner|jlpt\s*n[45]|n[45]|learning"),
]
LISTED = 0.6   # language listed without a level
LANG_LABEL = re.compile(r"^\s*(?:languages?(?:\s+(?:known|spoken))?|spoken languages|language skills|linguistic skills|"
                        r"languages proficiency)\s*[:–\-]\s*(?P<v>.+)$", re.I | re.M)
GENERIC_AUTH = ["authorized to work", "authorised to work", "work authorization", "work authorisation", "right to work",
                "no sponsorship", "without sponsorship", "does not require sponsorship", "visa sponsorship", "willing to relocate",
                "open to relocation", "relocation"]
PERSONAL = {
    "dob": re.compile(r"date of birth|\bd\.?o\.?b\b|born on|\bborn\s*:|geburtsdatum|\bage\s*:\s*\d{2}", re.I),
    "marital": re.compile(r"marital status|familienstand|\bmarried\b", re.I),
    "nationality": re.compile(r"nationality|citizenship\s*:", re.I),
    "gender": re.compile(r"\bgender\s*:|\bsex\s*:", re.I),
}
_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
              "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
              "eighteen": 18, "nineteen": 19, "twenty": 20, "twenty-five": 25, "thirty": 30}
_QUAL = r"(?:total|overall|professional|work|working|industry|industrial|it|relevant|hands[- ]on|rich|extensive|" \
        r"progressive|combined|cumulative|proven|solid|strong|diverse|full[- ]time)"
_NUM = r"(?P<n>\d{1,2}(?:\.\d{1,2})?|" + "|".join(sorted(_NUM_WORDS, key=len, reverse=True)) + r")"
_STATED = [
    re.compile(rf"(?:about|around|over|nearly|almost|approximately|approx\.?|more than|close to|~)?\s*\b{_NUM}\s*\+?\s*"
               rf"(?:\+\s*)?(?:years?|yrs?)\.?(?:'|’)?\s*(?:of\s+)?(?P<q>(?:{_QUAL}\s+){{0,3}})(?:work\s+)?(?:experience|exp)\b", re.I),
    re.compile(rf"experience\s+of\s+(?:about|around|over|nearly|almost|more than)?\s*{_NUM}\s*\+?\s*(?:years?|yrs?)", re.I),
    re.compile(r"(?P<w>over|more than|nearly|almost|about)?\s*(?P<d>a|one|two|three)\s+decades?\s+of\s+(?:\w+\s+){0,2}experience", re.I),
    # "14+ years in IT", "10 years in the software industry" - total tenure without the word "experience"
    re.compile(rf"\b{_NUM}\s*\+?\s*(?:years?|yrs?)\s+(?:in|of)\s+(?:the\s+)?(?P<q>it|i\.t\.|industry|software industry|"
               rf"tech industry|technology industry|information technology)\b", re.I),
    # "with over 8+ years specializing in ..." - unqualified; "with 5 years of Python" is excluded
    re.compile(rf"\bwith\s+(?:about|around|over|nearly|almost|more than)?\s*{_NUM}\s*\+?\s*(?:years?|yrs?)\b"
               rf"(?!\s+of\s+(?!(?:{_QUAL}\s+)*(?:experience|exp)\b))", re.I),
]


@dataclass
class Job:
    title: str
    company: str
    header: str
    start: tuple[int, int]
    end: tuple[int, int]
    current: bool
    span: tuple[int, int]          # char span of the whole entry (header + body)
    months: int = 0
    as_of: tuple[int, int] = (0, 0)

    @property
    def years_since_end(self):
        y, m = self.as_of if self.as_of[0] else (dt.date.today().year, dt.date.today().month)
        return max(0.0, ((y * 12 + m) - (self.end[0] * 12 + self.end[1])) / 12)


@dataclass
class Profile:
    text: str
    lines: list[str]
    line_starts: list[int]
    sections: dict[str, list[tuple[int, int]]] = field(default_factory=dict)   # name -> char spans
    section_info: list[dict] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    jobs: list[Job] = field(default_factory=list)
    years: float = 0.0              # the figure used for scoring
    years_dates: float = 0.0        # from job dates
    years_stated: float | None = None
    years_source: str = "dates"
    years_note: str = ""
    as_of: tuple[int, int] = (0, 0)
    as_of_source: str = "today"
    headline: str = ""
    emails: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    linkedin: str = ""
    github: str = ""
    locations: list[str] = field(default_factory=list)       # country ids
    location_text: str = ""
    languages: dict[str, float] = field(default_factory=dict)  # listed languages -> proficiency 0..1
    education: list[dict] = field(default_factory=list)
    degree_level: int | None = None
    auth: dict[str, list[str]] = field(default_factory=dict)   # country id -> phrases found
    generic_auth: list[str] = field(default_factory=list)
    personal: list[str] = field(default_factory=list)
    title_rank: int | None = None
    words: int = 0
    quantified: int = 0
    bullets: int = 0

    def section_at(self, pos: int) -> str | None:
        for name, spans in self.sections.items():
            for a, b in spans:
                if a <= pos < b:
                    return name
        return None

    def job_at(self, pos: int) -> int | None:
        for i, j in enumerate(self.jobs):
            if j.span[0] <= pos < j.span[1]:
                return i
        return None

    def section_text(self, name: str) -> str:
        return "\n".join(self.text[a:b] for a, b in self.sections.get(name, []))

    def effective_languages(self) -> dict[str, float]:
        """Listed languages, plus English inferred from the resume itself when it isn't listed."""
        out = dict(self.languages)
        out.setdefault("English", 0.7)
        return out


# ------------------------------------------------------------------ headings

def classify_heading(text: str) -> tuple[str | None, float]:
    """Which section does a heading name? Returns (type, confidence)."""
    exact = re.sub(r"\s+", " ", re.sub(r"[^a-z& ]", " ", text.lower())).strip()
    if exact in EXACT:
        return EXACT[exact], 0.95
    words = [w for w in re.findall(r"[a-zà-ÿ]+", text.lower()) if w not in ("and", "of", "the", "my", "key", "other", "on", "in", "for", "&")]
    if not words or len(words) > 6:
        return None, 0.0
    if any(w.startswith("language") for w in words) and _SKILL_LANG.search(text):
        return "skills", 0.9                      # "Programming languages" is a skills heading
    if words[0] == "key" or (words[-1].startswith("qualification") and words[0] in ("summary", "professional")):
        return "summary", 0.8
    best, weak_hits = {}, {}
    for pos, w in enumerate(words):
        for root, typ, strength in _ROOT_INDEX:
            if w == root or (len(w) >= 6 and len(root) >= 6 and difflib.SequenceMatcher(None, w, root).ratio() >= 0.85):
                if strength < 1:
                    weak_hits[typ] = weak_hits.get(typ, 0) + 1
                    if weak_hits[typ] >= 2:       # two weak words agree ("Work History") = a strong signal
                        strength = 1.0
                cur = best.get(typ)
                if cur is None or strength > cur[0]:
                    best[typ] = (strength, pos)
                break
    if not best:
        return None, 0.0
    if "personal" in best and best["personal"][0] == 1.0 and not any(
            t not in ("personal", "summary") and s == 1.0 for t, (s, _) in best.items()):
        return "personal", 0.9                    # "Personal Profile" is personal; "Personal Project" is a project
    # Strongest root wins; between equally strong roots the last noun is the head ("Personal Project"),
    # except that the big sections outrank modifiers like "credentials" ("Academic Credentials" = education).
    rank = {"experience": 3, "education": 3, "skills": 2}
    typ, (strength, _) = max(best.items(), key=lambda kv: (kv[1][0], rank.get(kv[0], 0) if kv[1][0] == 1 else 0, kv[1][1]))
    if typ == "experience" and strength < 1 and "skills" in best and best["skills"][0] == 1:
        typ, strength = "skills", 1.0
    return typ, (0.95 if strength == 1.0 else 0.6)


def heading_shape(line: str, styled: float = 0.0) -> float:
    """How much a line looks like a section heading (0..1), from its text and formatting."""
    raw = line.strip()
    if not raw or len(raw) > 60 or BULLET.match(line) or EMAIL.search(raw) or RANGE.search(raw):
        return 0.0
    words = raw.split()
    if len(words) > 7 or len(re.findall(r"\d", raw)) > 3:
        return 0.0
    first = next((c for c in raw if c.isalpha()), "")
    # Reject sentence ends and fragments like "training)." but keep "PROJECTS (SELECTED)"
    if not first or first.islower() or re.search(r"[.,;]\)?$", raw) or (raw.endswith(")") and raw.count("(") < raw.count(")")):
        return 0.0
    if LABEL.match(raw) and LABEL.match(raw).group("v").strip():   # "Designation: Engineer" is a field, not a heading
        return 0.0
    letters = [c for c in raw if c.isalpha()]
    s = 0.6 * styled
    if len(letters) >= 3 and all(c.isupper() for c in letters):
        s += 0.4
    if raw.endswith(":"):
        s += 0.2
    if sum(w[:1].isupper() for w in words if w[0].isalpha()) >= max(1, len(words) - 1) and len(words) <= 5:
        s += 0.2
    if len(words) <= 3:
        s += 0.1
    return min(1.0, s)


def _heading(line: str) -> str | None:
    """Section type for a heading-shaped line (no formatting info); kept for simple callers/tests."""
    if heading_shape(line) < 0.2:
        return None
    typ, conf = classify_heading(line)
    return typ if conf >= 0.6 else None


# ------------------------------------------------------------------ block content

def content_scores(block: str) -> dict[str, float]:
    low = block.lower()
    words = len(re.findall(r"\w+", block)) or 1
    out = {}
    ranges = len(RANGE.findall(block))
    titles = sum(1 for ln in block.split("\n") if TITLE_WORDS.search(ln) and len(ln.split()) <= 14)
    labels = len(re.findall(r"(?im)^\s*(designation|employer|work period|duration|responsibilities)\s*:", block))
    if ranges or labels >= 2:
        out["experience"] = min(0.95, 0.45 + 0.12 * ranges + 0.08 * min(titles, 3) + 0.08 * labels)
    deg = len(DEGREE.findall(block)) + len(_DEGREE_SHORT.findall(block))
    inst = len(INSTITUTION.findall(block))
    if deg or (inst and re.search(r"\b(19|20)\d{2}\b", block)):
        out["education"] = min(0.95, 0.5 + 0.15 * deg + 0.1 * inst - (0.25 if ranges > 2 else 0))
    langs = sum(1 for n in LANGS if re.search(rf"(?<![a-z]){n}(?![a-z])", low))
    if langs >= 2 and words < 80:
        out["languages"] = min(0.95, 0.55 + 0.1 * langs)
    certs = len(re.findall(r"\b(certified|certification|certificate|cka|ckad|cks|pmp|itil|az-\d{3}|aws certified)\b", low))
    if certs and words < 150:
        out["certifications"] = min(0.9, 0.45 + 0.12 * certs)
    seps = block.count(",") + block.count("|") + block.count("•") + block.count(";")
    sentences = len(re.findall(r"[a-z]{3,}\.(\s|$)", block))
    lines = [l.strip() for l in block.split("\n") if l.strip()]
    short = sum(1 for l in lines if len(l.split()) <= 4 and not RANGE.search(l))
    if not ranges and sentences <= 2 and (seps / words > 0.12 or (len(lines) >= 4 and short / len(lines) > 0.7)):
        # a degree line is comma-heavy too ("B.Sc., Computer Science, 2015, University of X"): not a skills list
        out["skills"] = min(0.9, 0.45 + max(seps / words, 0.3 * short / len(lines))) - (0.3 if deg else 0)
    if not ranges and not deg and words >= 25 and sentences >= 1 and seps / words < 0.12:
        out["summary"] = 0.5                      # prose paragraph; only used near the top
    if re.search(r"\b(award|awarded|recognized|recognition|honou?r|prize|employee of the|dean's list)\b", low) \
            and words < 120 and not ranges:
        out["awards"] = 0.55
    if re.search(r"\b(hobbies|enjoy|reading|travel(l?ing)?|music|sports|volunteer(ing)?)\b", low) and words < 50 and not ranges:
        out["interests"] = 0.55
    return out


# ------------------------------------------------------------------ dates

def _parse_date(s: str, is_end: bool) -> tuple[tuple[int, int] | None, bool, bool]:
    """Returns ((year, month) or None for 'present', is_current, month_known)."""
    s = s.strip().lower()
    if re.fullmatch(_CURRENT, s):
        return None, True, True
    y = int(re.search(r"(19|20)\d{2}", s).group(0))
    m = re.search(_MON, s)
    if m:
        return (y, MONTHS[m.group(0)[:3]]), False, True
    mm = [int(n) for n in re.findall(r"\d+", s) if len(n) <= 2]
    if mm and 1 <= mm[0] <= 12:
        return (y, mm[0]), False, True
    return (y, 1), False, False


def _months(start, end, month_known):
    n = (end[0] * 12 + end[1]) - (start[0] * 12 + start[1])
    return n + 1 if month_known else n


def _merge_months(intervals):
    """Total months covered by possibly overlapping [start, end] month intervals."""
    iv = sorted((a, b) for a, b in intervals if b >= a)
    total, cur = 0, None
    for a, b in iv:
        if cur is None or a > cur[1]:
            if cur:
                total += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        total += cur[1] - cur[0]
    return total


def _lang_level(ctx: str) -> float | None:
    for val, pat in LEVEL_TOKENS:
        if re.search(rf"(?<![a-z0-9])(?:{pat})(?![a-z0-9])", ctx):
            return val
    return None


def stated_years(text: str) -> tuple[float, bool] | None:
    """('about 6 years of total work experience' -> (6, False)), ('12+ years', 'over 8 years' -> lower bound).
    Skill-scoped figures ('5 years of Python experience') don't match: only qualifier words may sit
    between the number and 'experience'."""
    cands = []
    for rx in _STATED:
        for m in rx.finditer(text):
            if "d" in m.groupdict() and m.group("d"):
                n = {"a": 1, "one": 1, "two": 2, "three": 3}[m.group("d").lower()] * 10
                qual = True
            else:
                raw = m.group("n").lower()
                n = float(_NUM_WORDS[raw]) if raw in _NUM_WORDS else float(raw)
                qual = bool(m.groupdict().get("q") and m.group("q").strip())
            lower = "+" in m.group(0) or bool(re.search(r"(?i)\b(over|more than|at least)\b", m.group(0)))
            if 0.5 <= n <= 50:
                cands.append((qual, n, lower))
    if not cands:
        return None
    pool = [c for c in cands if c[0]] or cands
    _, n, lower = max(pool, key=lambda c: c[1])
    return n, lower


def normalize(text: str) -> str:
    """Some exports (HTML-stripped text, certain PDF generators) lose line breaks and keep
    blocks apart with runs of spaces. Restore lines so headings and job headers separate."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ")
    if text.count("\n") < len(text) / 400 and len(re.findall(r" {3,}", text)) >= 5:
        text = re.sub(r" {3,}", "\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    # "Feb 2015\nto\nFeb 2021" -> one line, so the range is recognised
    text = re.sub(rf"({_DATE})[ \t]*\n[ \t]*(to|until|–|—|-)[ \t]*\n[ \t]*({_END})", r"\1 \2 \3", text, flags=re.I)
    text = re.sub(rf"({_DATE})[ \t]*(to|until|–|—|-)?[ \t]*\n[ \t]*(to|until|–|—|-)?[ \t]*({_END})(?=[ \t]*\n)",
                  lambda m: f"{m.group(1)} {m.group(2) or m.group(3) or '-'} {m.group(4)}" if (m.group(2) or m.group(3)) else m.group(0),
                  text, flags=re.I)
    return text.strip()


_PLACES = {pl for c in COUNTRIES.values() for pl in c["places"]} | {
    "remote", "hybrid", "onsite", "on-site", "ka", "tn", "ap", "ts", "mh", "dl", "hr", "up", "wfh", "usa", "us", "uk"}


def _is_place(s: str) -> bool:
    """'Bengaluru', 'KA', 'Remote', 'Berlin, Germany' - locations that sit next to dates in job headers."""
    s = s.strip(" .()").lower()
    return bool(s) and (s in _PLACES or bool(re.fullmatch(r"[a-z]{2}", s)) or
                        all(w.strip(" .") in _PLACES for w in re.split(r"[\s,]+", s) if w.strip(" .")))


def _clean(s: str) -> str:
    """Trim separators; drop a parenthesis only when it's unbalanced ("Consultant (Oracle DBA)" keeps it)."""
    s = s.strip(" -–—|,:/•·▪●◦>")
    if not re.search(r"[A-Za-z]{2}", s):
        return ""
    if s.startswith("(") and ")" not in s:
        s = s[1:]
    if s.endswith(")") and "(" not in s:
        s = s[:-1]
    if s.endswith("(") or (s.count("(") > s.count(")") and s.rstrip().endswith("(")):
        s = s.rstrip("( ")
    return s.strip()


def _ym(d: dt.date) -> tuple[int, int]:
    return (d.year, d.month)


def _add_years(ym, years):
    total = ym[0] * 12 + (ym[1] - 1) + round(years * 12)
    return (total // 12, total % 12 + 1)


def _ym_int(ym):
    return ym[0] * 12 + ym[1]


# ------------------------------------------------------------------ main

def parse(text: str, styled: dict[str, float] | None = None, doc_date: dt.date | None = None) -> Profile:
    """styled: normalised line -> formatting score from the extractor (bold / heading style / size).
    doc_date: the document's last-saved date from metadata, if known."""
    styled = styled or {}
    text = normalize(text)
    lines = text.split("\n")
    starts, pos = [], 0
    for ln in lines:
        starts.append(pos)
        pos += len(ln) + 1
    p = Profile(text=text, lines=lines, line_starts=starts)
    low = text.lower()
    p.words = len(re.findall(r"\w+", text))
    _sections(p, styled)

    # --- contacts & headline
    p.emails = sorted(set(EMAIL.findall(text)))
    p.phones = [m.strip() for m in PHONE.findall(text[:2000]) if 9 <= len(re.sub(r"\D", "", m)) <= 15
                and not RANGE.search(m)][:2]
    m = LINKEDIN.search(text)
    p.linkedin = m.group(0) if m else ""
    m = GITHUB.search(text)
    p.github = m.group(0) if m else ""
    first_section = min((a for spans in p.sections.values() for a, _ in spans), default=len(text))
    top = text[:min(first_section, 800)] if first_section > 40 else text[:400]
    for ln in [l.strip() for l in top.split("\n") if l.strip()][:6]:
        if TITLE_WORDS.search(ln) and len(ln.split()) <= 12 and "@" not in ln and not EMAIL.search(ln) and not LABEL.match(ln):
            p.headline = ln
            break

    _jobs_and_years(p, doc_date)
    _education(p)
    _languages(p, low)

    # --- seniority from recent titles
    recent = [j for j in p.jobs if j.years_since_end <= 3] or p.jobs[:2]
    titles = [j.title.lower() for j in recent[:3]] + ([p.headline.lower()] if p.headline else [])
    ranks = []
    for t in titles:
        r = 0
        for group in LEVELS["title_words"]:
            if any(re.search(rf"(?<![a-z]){re.escape(w.strip())}(?![a-z])", t) for w in group["words"]):
                r = group["rank"]
                break
        ranks.append(r)
    p.title_rank = max(ranks) if ranks else None

    # --- location: country places in the header block, contact lines, or the latest job header
    loc_zone = top + "\n" + "\n".join(l for l in lines if re.match(r"\s*(location|address|based in|city)\b", l, re.I))
    if p.jobs:
        loc_zone += "\n" + p.jobs[0].header
    found = []
    for cid, c in COUNTRIES.items():
        for place in c["places"]:
            m = re.search(rf"(?<![a-z]){re.escape(place)}(?![a-z])", loc_zone.lower())
            if m:
                found.append((m.start(), cid, place))
                break
    found.sort()
    specific = [f for f in found if f[1] != "eu"]   # "EU (general)" only when no specific country matched
    found = specific or found
    p.locations = list(dict.fromkeys(cid for _, cid, _ in found))
    if found:
        p.location_text = found[0][2].title()

    # --- work authorisation & personal data
    for cid, c in COUNTRIES.items():
        hits = [a for a in c["auth"] if re.search(rf"(?<![a-z]){re.escape(a)}(?![a-z])", low)]
        if hits:
            p.auth[cid] = hits
    p.generic_auth = [a for a in GENERIC_AUTH if a in low]
    p.personal = [k for k, rx in PERSONAL.items() if rx.search(text)]

    # --- quantified impact in experience bullets
    exp_text = p.section_text("experience") or text
    for ln in exp_text.split("\n"):
        if (BULLET.match(ln) or len(ln.split()) > 8) and not RANGE.search(ln):
            p.bullets += 1
            if re.search(r"\d+\s*%|\$\s?\d|€\s?\d|\b\d+[kKmM]?\+?\s*(x|users|requests|services|clusters|nodes|engineers|teams|ms|hours|minutes)\b|\b\d{2,}\b", ln):
                p.quantified += 1
    return p


def _sections(p: Profile, styled: dict[str, float]):
    lines, starts, text = p.lines, p.line_starts, p.text
    bounds = []   # (line index, type or None, confidence, heading text)
    current = None
    for i, ln in enumerate(lines):
        raw = ln.strip()
        shape = heading_shape(ln, styled.get(re.sub(r"\s+", " ", raw).lower(), 0.0))
        if shape < 0.2:
            continue
        typ, conf = classify_heading(raw)
        if typ is None:
            # An unnamed but clearly formatted heading ends the preamble (name/contact block). Inside a
            # section, bold lines are usually job titles or project names - unless what follows clearly
            # belongs to another kind of section ("Where I've Worked" + dated roles after a skills list).
            if shape >= 0.7 and current is None and i > 2:
                bounds.append((i, None, 0.0, 0.0, raw))
                current = "unknown"
            elif shape >= 0.3 and current is not None and len(raw.split()) <= 4:
                nxt = next((k for k in range(i + 1, min(len(lines), i + 40)) if heading_shape(lines[k]) >= 0.3
                            and classify_heading(lines[k].strip())[0]), min(len(lines), i + 40))
                sc = content_scores("\n".join(lines[i + 1:nxt]))
                sc.pop("summary", None)
                t = max(sc, key=sc.get) if sc else None
                allowed = t == "experience" or (t == "education" and current not in ("skills", "certifications", "experience"))
                if t and t != current and sc[t] >= 0.7 and allowed and current != "education" \
                        and not (current == "experience" and sc.get("experience", 0) >= 0.3):
                    bounds.append((i, None, 0.0, 0.0, raw))
                    current = t
            continue
        if conf < 0.9 and shape < 0.4:
            continue
        if current is not None:
            # Inside a section, company/title lines ("TCS – Keysight Technologies") and same-topic
            # sub-headings ("Experience on AWS" under "Professional Experience") don't start a section.
            if typ == current or conf < 0.9 or re.search(r"\s[-–—|]\s|,", raw) or (len(raw.split()) > 4 and shape < 0.6):
                continue
        # "Achievements:", "Tools and Technologies Used:" inside a job are sub-headings, not new sections
        if current == "experience" and raw.endswith(":") and typ in ("awards", "skills", "projects", "interests",
                                                                       "certifications"):
            continue
        bounds.append((i, typ, conf, conf * (0.6 + 0.4 * shape), raw))
        current = typ

    blocks = []
    for k, (i, typ, label_conf, conf, head) in enumerate(bounds):
        end = bounds[k + 1][0] if k + 1 < len(bounds) else len(lines)
        body = "\n".join(lines[i + 1:end])
        scores = content_scores(body)
        scores.pop("summary", None)
        best_c = max(scores.items(), key=lambda kv: kv[1]) if scores else (None, 0.0)
        final, source, fconf = typ, "heading", conf
        weak_label = label_conf < 0.9
        if typ is None:
            if best_c[1] >= 0.55:
                final, source, fconf = best_c[0], "content", best_c[1]
        elif typ == "experience" and "experience" not in scores and best_c[1] >= 0.55 and (weak_label or len(head.split()) > 2):
            final, source, fconf = best_c[0], "content", best_c[1]       # "Experience on AWS" listing skills
        elif typ == "experience" and "experience" not in scores and len(body.split()) > 15 and weak_label:
            final, source, fconf = "summary", "content", 0.5
        elif weak_label and best_c[0] and best_c[0] != typ and best_c[1] >= 0.85 and scores.get(typ, 0) < 0.2 \
                and typ != "personal":
            final, source, fconf = best_c[0], "content", best_c[1]
        blocks.append([i, end, final, fconf, head, source])

    # Text before the first heading: name/contact, often a headless summary, sometimes jobs.
    first = bounds[0][0] if bounds else len(lines)
    blocks.insert(0, [0, first, None, 0.0, "", "content"])
    blocks = _split_headless(lines, blocks)

    for i, end, typ, conf, head, source in blocks:
        if not typ:
            continue
        a = starts[i]
        b = starts[end] if end < len(lines) else len(text)
        spans = p.sections.setdefault(typ, [])
        if spans and spans[-1][1] == a:
            spans[-1] = (spans[-1][0], b)
        else:
            spans.append((a, b))
        if head:
            p.headings.append(head)
        p.section_info.append({"heading": head, "type": typ, "confidence": round(conf, 2), "source": source})


def _paragraphs(lines, a, b):
    """Groups of consecutive non-empty lines in [a, b)."""
    out, start = [], None
    for k in range(a, b):
        if lines[k].strip():
            start = k if start is None else start
        elif start is not None:
            out.append((start, k))
            start = None
    if start is not None:
        out.append((start, b))
    return out


def _split_headless(lines, blocks):
    """Sections without a heading: split paragraphs off a block when their content clearly belongs to
    another section (a degree list after the jobs, a comma list of skills, a languages line...).
    Only trailing paragraphs move (a headless section follows the one before it), plus a prose summary
    or job list in the preamble."""
    out = []
    for bi, (i, end, typ, conf, head, source) in enumerate(blocks):
        paras = _paragraphs(lines, i + (1 if head else 0), end)
        if typ is None:   # preamble: name/contact lines, then maybe a summary paragraph or jobs
            cur_typ, cur_start, segs = None, i, []
            for a, b in paras:
                sc = content_scores("\n".join(lines[a:b]))
                t = max(sc, key=sc.get) if sc and max(sc.values()) >= 0.5 else None
                # name/contact lines are short and look like a list, so only summaries and jobs start here
                if t == "experience" or (t == "summary" and cur_typ is None) or (t == "education" and sc[t] >= 0.7):
                    if t != cur_typ:
                        segs.append([a, t])
                        cur_typ = t
            for k, (a, t) in enumerate(segs):
                b = segs[k + 1][0] if k + 1 < len(segs) else end
                out.append([a, b, t, 0.6, "", "content"])
            continue
        split_at, new_typ, sc_val = None, None, 0.0
        for a, b in reversed(paras[1:] if head else paras[1:]):
            sc = content_scores("\n".join(lines[a:b]))
            sc.pop("summary", None)
            t = max(sc, key=sc.get) if sc else None
            if not t or t == typ or sc[t] < 0.7 or (typ == "experience" and sc.get("experience", 0) >= 0.45) \
                    or (typ == "experience" and t in ("skills", "summary", "awards", "interests")):   # jobs end with tech lists
                break
            if new_typ and t != new_typ:
                break
            split_at, new_typ, sc_val = a, t, sc[t]
        if split_at is not None:
            out.append([i, split_at, typ, conf, head, source])
            out.append([split_at, end, new_typ, sc_val, "", "content"])
        else:
            out.append([i, end, typ, conf, head, source])
    return out


def _jobs_and_years(p: Profile, doc_date):
    lines, starts, text = p.lines, p.line_starts, p.text
    exp_spans = p.sections.get("experience", [])
    excluded = p.sections.get("education", []) + p.sections.get("certifications", []) + p.sections.get("publications", [])
    heading_lines = {k for k, l in enumerate(lines) if l.strip() and l.strip() in p.headings}

    def in_spans(pos, spans):
        return any(a <= pos < b for a, b in spans)

    raw = []
    for i, ln in enumerate(lines):
        m = RANGE.search(ln)
        if not m:
            continue
        pos = starts[i]
        if exp_spans and not in_spans(pos, exp_spans):
            continue
        if not exp_spans and in_spans(pos, excluded):
            continue
        s, _, s_known = _parse_date(m.group("s"), False)
        e, cur, e_known = _parse_date(m.group("e"), True)
        if s[0] < 1970 or (e and (e < s or e[0] - s[0] > 50)):
            continue
        raw.append({"i": i, "m": m, "s": s, "e": e, "cur": cur, "known": s_known and e_known})

    # --- as-of date: what "Present" means for this resume
    summary = p.section_text("summary") or text[:max(600, len(text) // 3)]
    st = stated_years(summary) or stated_years(text[:max(600, len(text) // 3)])
    stated, lower_bound = st if st else (None, False)
    today = _ym(dt.date.today())
    explicit = [r["s"] for r in raw] + [r["e"] for r in raw if r["e"]]
    latest = max(explicit, key=_ym_int) if explicit else None
    meta = _ym(doc_date) if doc_date else None
    if meta and latest and _ym_int(meta) < _ym_int(latest):
        meta = None                                  # metadata older than the resume's own dates: unreliable

    def total_at(as_of):
        iv = [(_ym_int(r["s"]), _ym_int(r["e"] or as_of) + (1 if r["known"] else 0)) for r in raw
              if _ym_int(r["e"] or as_of) >= _ym_int(r["s"])]
        return _merge_months(iv) / 12

    def consistent(as_of):
        t = total_at(as_of)
        return t >= stated - 1.0 and (lower_bound or t <= stated + 1.5)

    has_current = any(r["e"] is None for r in raw)
    as_of, src = (meta, "document date") if meta else (today, "today")
    if stated and has_current and not consistent(as_of):
        # Date "Present" so the job dates add up to the stated figure (gap-aware), e.g. an old resume
        # pasted as text, or re-saved years later.
        lo = latest or today
        cands = [(y, m) for y in range(lo[0], today[0] + 1) for m in range(1, 13)
                 if _ym_int(lo) <= _ym_int((y, m)) <= _ym_int(today)]
        if cands:
            best = min(cands, key=lambda c: abs(total_at(c) - stated))
            if abs(total_at(best) - stated) <= 1.0:
                as_of, src = best, "stated experience"
    p.as_of, p.as_of_source = as_of, src
    for r in raw:
        if r["e"] is None:
            r["e"] = as_of if _ym_int(as_of) >= _ym_int(r["s"]) else r["s"]

    # --- job headers, label layouts, container periods
    for k, r in enumerate(raw):
        i, m = r["i"], r["m"]
        prev = raw[k - 1]["i"] if k else -1
        nxt = raw[k + 1]["i"] if k + 1 < len(raw) else len(lines)
        date_rest = (lines[i][:m.start()] + " " + lines[i][m.end():]).strip(" ,|-–—()")
        lab = LABEL.match(lines[i])
        title_lab = company_lab = ""
        if lab:
            date_rest = ""
        head, h0, seen, skipped = [], i, 0, 0
        for j in range(i - 1, prev, -1):            # look back over up to 3 non-empty header lines
            lj = re.sub(r"\s*[.·_]{3,}\s*$", "", lines[j].strip())   # "Instructor ........" leader dots
            if not lj:
                continue
            lm = LABEL.match(lj)
            if re.match(_PROSE_LABEL, lj) and skipped < 2:   # "Key Accomplishments: ..." between title and dates
                skipped += 1
                continue
            continuation = lj[0].islower() or (lj.endswith(".") and not re.search(_ABBR_END, lj))
            field_list = bool(re.match(r"^[^:]{2,40}\s:\s*\S|^[A-Za-z ]{2,30}:\s*\S", lj)) and not lm
            if seen >= 3 or BULLET.match(lines[j]) or len(lj.split()) > 14 or j in heading_lines \
                    or continuation or field_list:
                break
            if lm and lm.group("k").lower() in ("work period", "duration", "period", "tenure", "dates", "date"):
                break
            if lm and lm.group("k").lower() in _COMPANY_LABELS:
                company_lab = company_lab or lm.group("v").strip()
            elif lm and lm.group("k").lower() in _TITLE_LABELS:
                title_lab = title_lab or lm.group("v").strip()
            else:
                head.insert(0, lj)
            h0, seen = j, seen + 1
        # Label layouts put "Designation:" after the period - unless the next period is a role inside this
        # one (employer period, then each role's own Designation + Duration).
        nested_next = k + 1 < len(raw) and _ym_int(raw[k + 1]["s"]) >= _ym_int(r["s"]) \
            and _ym_int(raw[k + 1]["e"]) <= _ym_int(r["e"]) and (raw[k + 1]["s"], raw[k + 1]["e"]) != (r["s"], r["e"])
        # With one Designation before the nested role, it's that role's; with two or more, the first is the
        # employer-level title ("Systems Engineer", then project roles "Implementation Engineer", ...).
        between = [lines[j] for j in range(i + 1, nxt) if (lm := LABEL.match(lines[j].strip()))
                   and lm.group("k").lower() in _TITLE_LABELS]
        forward_ok = not nested_next or len({b.strip().lower() for b in between}) >= 2
        for j in range(i + 1, min(nxt, i + 6) if forward_ok else i):
            lm = LABEL.match(lines[j].strip())
            if lm and lm.group("k").lower() in _TITLE_LABELS and not title_lab:
                title_lab = lm.group("v").strip()
            elif lm and lm.group("k").lower() in _COMPANY_LABELS and not company_lab:
                company_lab = lm.group("v").strip()
        # "Senior Engineer - Carrier Technologies India Ltd., Hyderabad - July 2022 – Present"
        dr_parts = [x.strip() for x in re.split(r"\s*[,|]\s*|\s+[-–—]\s+|\s+at\s+|\s+@\s+", date_rest) if x.strip(" -–—")]
        dr_title = next((x for x in dr_parts if TITLE_WORDS.search(x)), "")
        dr_company = next((x for x in dr_parts if not TITLE_WORDS.search(x) and not _is_place(x)), "")
        title = title_lab
        company = company_lab or dr_company
        if not title:
            for h in head:
                if TITLE_WORDS.search(h):
                    # When the company is already known, a dash in the title line belongs to the title
                    # ("Senior Engineer - AI/ML & Agentic Systems"); otherwise it may separate the company.
                    seps = r"\s+\|\s+|\s*,\s*|\s+at\s+|\s+@\s+" if company else r"\s+\|\s+|\s*,\s*|\s+[-–—]\s+|\s+at\s+|\s+@\s+"
                    title = next(x for x in re.split(seps, h) + [h] if TITLE_WORDS.search(x))
                    break
        title = title or dr_title
        if not title and forward_ok:   # some layouts put the title right after the dates
            for j in range(i + 1, min(nxt, i + 4)):
                lj = re.sub(r"\s*[.·_]{3,}\s*$", "", lines[j].strip())
                if not lj:
                    continue
                if TITLE_WORDS.search(lj) and len(lj.split()) <= 10 and not BULLET.match(lines[j]) and not lj.endswith("."):
                    lm = LABEL.match(lj)
                    title = lm.group("v").strip() if lm else re.split(r"\t|\s+\|\s+|\s*,\s*", lj)[0]
                break
        if not company:
            rest = [x for h in head for x in re.split(r"\s+\|\s+|\s*,\s*|\s+[-–—]\s+|\s+at\s+|\s+@\s+", h)
                    if x.strip() and x.strip() not in title and not TITLE_WORDS.search(x) and not _is_place(x)]
            company = rest[0] if rest else ""
        r.update(title=_clean(title), company=_clean(company), h0=h0,
                 head=" ".join(head + ([date_rest] if date_rest else [])).strip(), labelled=bool(title_lab))

    # exact duplicates (same period written twice): keep the one with the better title
    uniq = []
    for r in raw:
        dup = next((u for u in uniq if u["s"] == r["s"] and u["e"] == r["e"]), None)
        if dup is None:
            uniq.append(r)
        elif (r["labelled"] and not dup["labelled"]) or (not dup["title"] and r["title"]):
            dup.update(title=r["title"], company=dup["company"] or r["company"], labelled=r["labelled"])
    # container periods: an employer's overall period that contains the role periods listed under it
    for r in uniq:
        inner = [o for o in uniq if o is not r and _ym_int(o["s"]) >= _ym_int(r["s"]) and _ym_int(o["e"]) <= _ym_int(r["e"])
                 and (o["s"], o["e"]) != (r["s"], r["e"]) and o["i"] > r["i"]]
        r["container"] = bool(inner) and (not r["title"] or not r["labelled"] and not TITLE_WORDS.search(r["title"]))
        for o in inner:   # roles listed under an employer's period inherit its company
            o["company"] = o["company"] or r["company"]

    intervals = []
    listed = [r for r in uniq if not r["container"]]
    for k, r in enumerate(listed):
        nxt_h0 = listed[k + 1]["h0"] if k + 1 < len(listed) else len(lines)
        a = starts[r["h0"]]
        b = starts[nxt_h0] if nxt_h0 < len(lines) else len(text)
        if exp_spans:
            b = min(b, max((bb for aa, bb in exp_spans if aa <= a), default=b))
        p.jobs.append(Job(title=r["title"], company=r["company"], header=r["head"], start=r["s"], end=r["e"],
                          current=r["cur"], span=(a, b), months=_months(r["s"], r["e"], r["known"]), as_of=as_of))
    for r in uniq:
        intervals.append((_ym_int(r["s"]), _ym_int(r["e"]) + (1 if r["known"] else 0)))
    p.years_dates = round(_merge_months(intervals) / 12, 1)
    p.years_stated = stated
    shown = f"{stated:g}{'+' if lower_bound else ''}" if stated is not None else ""
    if stated is not None and lower_bound and stated < p.years_dates <= stated + 4:
        # "8+ years" and dates that add up to 10.4 agree; the dates are the more precise figure.
        p.years, p.years_source = p.years_dates, "dates"
        p.years_note = f"The resume states {shown} years; its job dates add up to {p.years_dates:g}, which fits."
    elif stated is not None:
        p.years, p.years_source = float(stated), "stated"
        if raw and abs(stated - p.years_dates) > 1.5:
            p.years_note = (f"The resume states {shown} years; its job dates add up to {p.years_dates:g} "
                            f"(as of {as_of[1]:02d}/{as_of[0]}). Using the stated figure.")
    else:
        p.years, p.years_source = p.years_dates, "dates"


def _education(p: Profile):
    spans = p.sections.get("education", [])
    zone_lines = []
    for a, b in spans:
        zone_lines += p.text[a:b].split("\n")
    if not zone_lines:   # no education section: degree lines anywhere outside experience
        exp = p.sections.get("experience", [])
        zone_lines = [l for k, l in enumerate(p.lines) if not any(a <= p.line_starts[k] < b for a, b in exp)]
    seen, used_as_inst = set(), set()
    lines = [l.strip() for l in zone_lines if l.strip()]
    for k, ln in enumerate(lines):
        if not (DEGREE.search(ln) or _DEGREE_SHORT.search(ln)) or len(ln.split()) > 25:
            continue
        if re.match(r"(?i)^(qualification|degree|course)s?\s*$|^board of\b", ln) or k in used_as_inst:
            continue
        # "Sri Lakshmi High School" names a school (institution), not a qualification
        deg = DEGREE.search(ln)
        if INSTITUTION.search(ln) and deg and re.fullmatch(r"(?i)high school|secondary school", deg.group(0)) \
                and not _DEGREE_SHORT.search(ln):
            continue
        ctx = lines[k:k + 3]
        inst_k = next((k + o for o, c in enumerate(ctx) if INSTITUTION.search(c)), None)
        inst = lines[inst_k] if inst_k is not None else ""
        if inst_k is not None and inst_k != k:
            used_as_inst.add(inst_k)
        elif inst_k == k:   # "Bachelor of Technology, JNTU, Anantapur" - take the institution part of the line
            inst = next((x.strip() for x in re.split(r",|\s+from\s+|\s+at\s+|\s+[-–—]\s+", ln)
                         if INSTITUTION.search(x) and not DEGREE.search(x)), "")
        years = re.findall(r"\b(?:19|20)\d{2}\b", " ".join(ctx))
        key = ln.lower()[:60]
        if key in seen:
            continue
        seen.add(key)
        level = next(lv for lv, pat in _DEGREE_LEVEL if re.search(pat, ln, re.I))
        p.education.append({"degree": ln[:140], "institution": inst[:140] if inst != ln else "",
                            "year": years[-1] if years else "", "level": level})
    if p.education:
        p.degree_level = max(e["level"] for e in p.education)


def _languages(p: Profile, low: str):
    zones = [m.group("v") for m in LANG_LABEL.finditer(p.text)]
    zones.append(p.section_text("languages"))
    zone = "\n".join(zones).lower()
    for name in LANGS:
        key = LANG_ALIAS.get(name, name).title()
        if zone and re.search(rf"(?<![a-z]){name}(?![a-z])", zone):
            for m in re.finditer(rf"(?<![a-z]){name}(?![a-z])", zone):
                seg = re.split(r"[,;\n|•/]|\band\b", zone[m.end(): m.end() + 40])[0]
                lvl = _lang_level(seg) or _lang_level(re.split(r"[,;\n|•/]", zone[max(0, m.start() - 25): m.start()])[-1])
                p.languages[key] = max(p.languages.get(key, 0), lvl if lvl is not None else LISTED)
            continue
        for m in re.finditer(rf"(?<![a-z]){name}(?![a-z])", low):
            ctx = low[max(0, m.start() - 25): m.end() + 40]
            after = re.split(r"[,;\n|•/]", low[m.end(): m.end() + 40])[0]
            before = re.split(r"[,;\n|•/]", low[max(0, m.start() - 25): m.start()])[-1]
            lvl = _lang_level(after)
            if lvl is None:
                lvl = _lang_level(before)
            if lvl is None:
                if not re.search(rf"(fluent|native|speaks?|speaking)\s+(in\s+)?{name}|{name}\s+(speaker|language)", ctx):
                    continue
                lvl = 0.8
            p.languages[key] = max(p.languages.get(key, 0), lvl)
