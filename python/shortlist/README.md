# Shortlist: resume and ATS fit checker

Shortlist is a small local web app. It reads a resume the way an applicant tracking system (ATS)
parser does, then scores it for 51 roles in 9 families × 5 seniority levels and for 17 countries and
regions. It explains every score and shows which edits would raise it.

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
| **Role** | All | **All** or **All in a family:** a role × position heatmap. **One role:** its match dial and breakdown, *How to improve*, its skills, and that role at every position. Clicking a heatmap cell inspects it. |
| **Position** | Senior | Five tiers, named the way each family names them: Engineer → Sr. Architect for IT, Designer → Head of Design, Engineer → Chief Engineer, QA Engineer → Head of Quality… |
| **Experience** | from the resume | Slider from 5 to 30 years overrides it. Under 5 years, every score is reduced. |
| **Country / region** | All | **All:** a fit heatmap for all 17 markets. **One country:** a detail panel (work rights, location, language, CV norms, notes). Clicking a tile selects that country. |

Each combination lays the page out differently:
- **Role All, Country All:** the role heatmap spans the full width.
- **One role, Country All:** the role panel spans the full width.
- **Any role, one country:** the country panel takes the right-hand column.

With Role on **All**, the heatmap groups roles by family. The two families with the strongest fits
open by default; collapsed families show their best role's score at each position, and clicking a
family name expands or collapses it.

The page uses 80% of the window on desktop screens (HD to 4K) and full width on phones.

## Roles

| Family | Roles | Position ladder |
|---|---|---|
| Cloud, Infrastructure & Ops | Platform, DevOps, SRE, Cloud, Systems Administration, Network, Database Administration, AIOps, Automation (Infra & Ops) | Engineer · Senior · Lead/Principal · Architect · Sr. Architect |
| Data & AI | Data Engineering, Data Science, Data Analytics, BI, SQL/Database Development, ML Engineering, AI Engineering, MLOps, ML/AI Ops & Engineering | Engineer/Analyst · Senior · Lead/Principal · Architect · Sr. Architect/Head |
| Software Development | Backend, Frontend, Full-Stack, Mobile, Java, .NET, Python, Embedded Software | Developer · Senior · Lead/Staff · Architect · Principal/Chief Architect |
| Enterprise Applications | SAP, Salesforce, ServiceNow | Consultant · Senior · Lead · Solution Architect · Sr. Solution Architect |
| Quality Engineering | Automation QA/SDET, QA/Manual Testing, Performance Testing | QA Engineer · Senior · QA Lead · Test Architect · Head of Quality |
| Cybersecurity | Security Engineering, Cloud Security, SOC Analysis, Penetration Testing, GRC & Risk | Analyst/Engineer · Senior · Lead · Security Architect · Principal/CISO track |
| Engineering & Design (Core) | Mechanical Design, CAD/BIM Design & Drafting, Electrical, Civil/Structural, Electronics/Hardware, VLSI, Manufacturing/Process | Engineer · Senior · Lead · Principal Engineer · Chief Engineer/Head |
| UX & Creative Design | UI/UX, Graphic/Visual, Web Design | Designer · Senior · Lead · Principal · Head of Design |
| Product & Delivery | Product Management, Business Analysis, Project/Program Management, Scrum Master/Agile Coach | Mid-level · Senior · Lead · Principal/Director · Head/VP |

Each role has:
* **Skills** weighted core (×3), important (×2) or nice to have (×1). Some groups count only **from a
  position up**: a Cloud Architect is also expected to show cloud architecture, a Senior Cloud Engineer
  cost optimisation and migrations, a Lead SDET test strategy. Below that position they're listed as
  *expected at higher positions* rather than missing.
* **Typical years per position.** These come from the family, and a role can override them: a SOC
  Analyst at the first tier is 1–5 years, a Project Manager 3–8.
* **Seniority signals** per family: "design reviews" and "technical authority" for engineers, "design
  system" and "design critique" for designers, "test strategy" and "TCoE" for QA, and so on.
* **Title words** per family, so "Principal Engineer" ranks as Principal in Engineering and "Art
  Director" as Principal in Design.
* **Target titles** for headline suggestions: "Senior DevOps Engineer", "Principal Mechanical Design
  Engineer", "SOC Lead", "VP of Product".

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
    synonyms, and some only count from a given position up, so the skills score differs by position.
    A skill used in a job counts fully (less for older jobs); one only listed in a skills section
    counts 70%.
* **Cell score** = role fit × a seniority gate of 40–100%. The gate combines years against the role's
  typical range for that position, the family's scope signals (led, mentored, architected, design
  reviews, test strategy…), and the level of recent titles. Below 5 years of experience, the score is also multiplied by 0.4 + 0.12 × years.
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

**Role ranking** ([resume-atlas](https://huggingface.co/datasets/ahmedheakl/resume-atlas), 1,000
resumes: 40 from each of 18 mapped categories plus 7 unrelated ones). This text is lowercased with job
titles and punctuation stripped, so the 12% title part (and aliases like C#, C++ and Node.js) can't
help. Real resumes do better on near neighbours.

| Category | AUROC of its role vs all others | Top-1 role in the right set | Top-3 | Right family |
|---|---|---|---|---|
| SAP Developer | **0.995** | 75% | 90% | 75% |
| Mechanical Engineer | **0.976** | 90% | 100% | 92% |
| Network Security Engineer | **0.965** | 82% | 100% | 100% |
| DevOps | **0.963** | 78% | 92% | 85% |
| SQL Developer | 0.943 | 92% | 98% | 98% |
| React Developer (Frontend) | 0.942 | 65% | 90% | 90% |
| ETL Developer (Data Engineering) | 0.940 | 82% | 90% | 88% |
| Python Developer | 0.939 | 35% | 80% | 80% |
| Java Developer | 0.930 | 90% | 98% | 92% |
| .NET Developer | 0.919 | 60% | 78% | 62% |
| Web Designing | 0.903 | 60% | 80% | 85% |
| Electrical Engineering | 0.901 | 65% | 75% | 78% |
| PMO (Project Management) | 0.887 | 82% | 88% | 85% |
| Business Analyst | 0.871 | 72% | 98% | 90% |
| Database (DBA) | 0.848 | 52% | 75% | 78% |
| Civil Engineer | 0.838 | 60% | 88% | 72% |
| Testing (QA / Manual) | 0.709 | 45% | 57% | 45% |
| Data Science | 0.524 | 48% | 72% | 48% |

The median AUROC is 0.92. Overall, the top-ranked role is in the right set for 69% of resumes and among
the top 3 for 86%.

* **Near neighbours explain most top-1 misses:** Full-Stack vs Python or .NET Developer, DBA vs SQL
  Developer, Civil vs CAD/BIM Designer. On real resumes the job title settles these.
* **Two labels are noisy:**
  * Only 28% of "Testing" resumes mention software testing; many are lab or inspection testing.
  * Only 37% of "Data Science" resumes mention machine learning (27% of "Python Developer" ones do too).
* **The original roles didn't regress:** DevOps AUROC on the previous pass's 9-category sample is 0.974
  (it was 0.975).

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
| `roles.json` | per role: `family`, skill groups (weight and optional `from` position), title phrases, description, target titles and optional per-position `years` |
| `families.json` | per family: names of the 5 positions, typical years, extra scope signals, seniority skills and title words |
| `levels.json` | the 5 shared position tiers: default scope signals, seniority skills, title words |
| `countries.json` | places, languages, work-rights phrases, CV norms, notes |

Adding a role or a whole family is a data change only: add it to `families.json` and `roles.json` and
restart. The templates are validated at startup, so an unknown skill id, family or position name stops
the server with a message saying which file and entry to fix.

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
