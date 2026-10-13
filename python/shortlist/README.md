# Shortlist: resume and ATS fit checker

Shortlist is a small local web app. It reads a resume the way an applicant tracking system (ATS)
parser does, then scores it for 9 infrastructure and AI roles × 5 seniority levels and for 17 countries
and regions. It explains every score and shows which edits would raise it.

```
pip install -r requirements.txt
python app.py          # → http://127.0.0.1:8001
```

The first run downloads `all-MiniLM-L6-v2` (about 90 MB, runs on the CPU). Everything runs locally, and
nothing is uploaded anywhere.

**File types:** PDF, DOCX, DOC, ODT, RTF, TXT and HTML, or pasted text.
- PDF uses PyMuPDF, falling back to pypdf.
- Legacy `.doc` uses antiword or LibreOffice when installed (including the antiword bundled with Git
  for Windows); otherwise a built-in Word 97–2003 reader.

## Using it

| Control | Default | Behaviour |
|---|---|---|
| **Role** | All | **All:** a role × position heatmap. **One role:** its match dial and breakdown, *How to improve*, its skills, and that role at every position. Clicking a heatmap cell selects that role. |
| **Position** | Senior | Engineer, Senior, Lead/Principal, Architect, Sr. Architect |
| **Experience** | from the resume | Slider from 5 to 30 years overrides it. Under 5 years, every score is reduced. |
| **Country / region** | All | **All:** a fit heatmap for all 17 markets. **One country:** a detail panel (work rights, location, language, CV norms, notes). Clicking a tile selects that country. |

Each combination lays the page out differently:
- **Role All, Country All:** the role heatmap spans the full width.
- **One role, Country All:** the role panel spans the full width.
- **Any role, one country:** the country panel takes the right-hand column.

The page uses 80% of the window on desktop screens (HD to 4K) and full width on phones.

## Where your resume goes

Everything stays on your machine, in memory:

1. **Browser → server.** The file is sent to the local server (`127.0.0.1`) with upload progress shown.
   The browser keeps the file in the page so the experience slider can re-score it. Only the theme and
   the last position choice are saved in browser storage, never resume content. API responses are sent
   `Cache-Control: no-store`, so results don't land in the browser cache.
2. **Server.** Uploads are read **into memory only**. Shortlist overrides Werkzeug's default of spooling
   files over 500 KB to a temp file. Text extraction, parsing and scoring all run in memory. The one
   exception is a legacy `.doc` that the built-in reader can't handle: it's written to a temporary folder
   for antiword/LibreOffice, which is deleted straight away.
3. **Cache.** The parsed resume (text, sections and embeddings) is kept in an in-memory cache keyed by a
   hash of its text, so dropdowns and the slider respond instantly:
   * at most 16 entries
   * each expires 15 minutes after last use
   * removed immediately by **Clear** (`POST /api/forget`)
   * everything is gone when the server stops
4. **Nothing else.** No database, no files written, no resume content in logs (Flask logs only the
   request line). Nothing is sent to any external service. The embedding model runs locally after its
   one-time download from Hugging Face.

## How it reads a resume

* **Sections are inferred.** The parser combines three signals rather than using a fixed list of
  headings:
  1. Heading formatting: Word heading styles, bold, font size, capitals.
  2. Fuzzy heading words: "EMPLOYMENT DETAILS", "Educational Qualification", typos.
  3. What the block contains: dates and titles mean experience, degrees mean education, language names
     mean languages, comma lists mean skills.
* **Experience is what the resume states.** "6 years of total work experience", "12+ years", "over a
  decade", and "14+ years in IT" all count. Skill-scoped figures ("5 years of Python") don't. Job dates
  are the fallback.
  * "8+" is treated as a minimum. When the dates add up to more, the dates are used.
* **"Present" means the resume's own date, not today.** In order of preference:
  1. The document's saved date (Word, ODT, PDF or `.doc` metadata), as long as it fits the stated
     experience.
  2. A date worked out so the job dates match the stated years. This makes pasted old resumes work too.
  3. The file's last-modified time.
  4. Today.
* **Job layouts:**
  * `Employer:` / `Designation:` / `Work Period:` / `Duration:` label layouts, including an employer's
    overall period that contains several roles.
  * Title and company on separate lines with blank lines in between.
  * "Title - Company, City - dates" written on one line.
  * Titles placed after the dates.
  * A location next to the dates is never taken as the company.
* **Education and languages:**
  * Degree, institution and year are extracted.
  * "Languages Known: English, Telugu, Hindi" counts as listed, with the level not stated.
  * English is never invented: if it isn't listed, it shows as *resume language*.

## How the score works

* **Role fit** is 55% skills, 20% meaning-based similarity, 12% job titles and 13% ATS readability.
  * Skills: each role template marks skills as core (×3), important (×2) or nice to have (×1), with
    synonyms. A skill used in a job counts fully (less for older jobs); one only listed in a skills
    section counts 70%.
* **Cell score** = role fit × a seniority gate of 40–100%. The gate combines years against the position's
  typical range, scope signals (led, mentored, architected, governance…), and the level of recent
  titles. Below 5 years of experience, the score is also multiplied by 0.4 + 0.12 × years.
* **How to improve** re-scores the resume with one concrete edit at a time and lists the points each
  adds:
  * a missing core skill
  * a skill moved from a list into a job bullet
  * a matching headline
  * an ATS fix
  * level-appropriate scope
* **Country fit:** work rights stated 40%, location 20%, language 25%, CV norms 15%.
  * A language is required only where a skilled-worker immigration route requires it; otherwise the
    local language is a bonus.
  * EU markets also note whether a degree, needed for the Blue Card, is present.
* **ATS readability checks:**
  * multi-column PDFs
  * PDFs that common parsers read as spaced-out letters
  * DOCX tables, text boxes and section columns
  * contact details in page headers
  * icon-font glyphs
  * missing sections or dates
  * length

These scores are consistent and explainable, but they are **not interview odds**. No single "ATS score"
exists across vendors. The immigration notes are general guidance; check official sources.

## Measured accuracy

Measured on public data from Hugging Face; only aggregate numbers were inspected.

**Section detection.** Measured on 600
[LiveCareer resumes](https://huggingface.co/datasets/opensporks/resumes) whose HTML labels every section:

| Section | Headings as written | Headings replaced by unseen synonyms | No headings at all |
|---|---|---|---|
| Experience | 98% | 86% | 87% |
| Education | 97% | 90% | 60% |
| Skills | 97% | 91% | 68% |
| Summary | 95% | 89% | 51% |

**Parsing on LiveCareer** (238 IT and engineering resumes):

| Measure | Result |
|---|---|
| Experience section found | 98% |
| Education section found | 92% |
| Dated jobs found | 95% |
| Jobs with a title | 87% |

**Real PDFs** ([resumes-raw-pdf](https://huggingface.co/datasets/d4rk3r/resumes-raw-pdf), mostly Vietnamese
job-portal CVs): an experience section was found in 73% of all files, including non-English ones. Median
time is 0.4 s per resume.

**Role ranking** ([resume-atlas](https://huggingface.co/datasets/ahmedheakl/resume-atlas), lowercased text):

| Category | AUROC vs every other category | Top-ranked role |
|---|---|---|
| DevOps | **0.975** | DevOps for 94% |
| Data Science (as ML Engineering) | 0.69 | |
| Testing (as Automation) | 0.63 | |

Many "Testing" resumes are manual QA, and many "Data Science" ones are student or analyst profiles.

**Job-description match:** only 0.60 AUROC on
[resume-job-description-fit](https://huggingface.co/datasets/cnamuangtoun/resume-job-description-fit),
whose labels barely track term overlap. Treat it as a keyword-coverage check, not a fit prediction.

## Checking your own resumes

```
python scripts/check_samples.py path/to/resume.pdf another.docx
```

This prints what was read: years (with source and as-of date), sections, jobs, education, languages,
ATS issues, top role fits and top countries. Keep real resumes out of the repo; `samples/` is
git-ignored.

**Tests:** `python -m pytest tests -q`. They use synthetic fixtures only.

## Customising

All templates are plain JSON in `shortlist/kb/`. Edit them and restart the server.

| File | Contents |
|---|---|
| `skills.json` | skill catalogue and synonyms; a leading `=` makes an alias case-sensitive |
| `roles.json` | per-role `family`, skill weights, title phrases and description |
| `levels.json` | year ranges, scope signals, title words |
| `countries.json` | places, languages, work-rights phrases, CV norms, notes |

Roles carry a `family` field (currently `IT / Infrastructure & AI`). New families, such as Engineering,
appear as their own groups in the Role dropdown ("All in Engineering") and in the heatmap with no code
changes.

## Layout

```
app.py                  Flask server (/, /api/meta, /api/analyze)
static/index.html       the UI: vanilla JS/CSS, no build step, no external requests
static/resume.js|css
shortlist/extract.py    documents → text + formatting hints + metadata dates + layout diagnostics
shortlist/parse.py      sections, jobs, experience and as-of date, education, languages, location, work rights
shortlist/layout.py     ATS readability checks
shortlist/score.py      role × level matrix, seniority gate, how-to-improve, country fit, job-description match
shortlist/kb/*.json     editable templates
scripts/check_samples.py
tests/
```

PyMuPDF is AGPL-3.0. That's fine for local use; swap in another PDF library if you ship this as a
product.
