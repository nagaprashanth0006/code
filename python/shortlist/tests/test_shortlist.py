"""Run: python -m pytest tests -q

Fixtures are synthetic (no real resumes). Tests marked with torch need the small embedding model."""
import datetime as dt
import io
import os
import sys
import zipfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shortlist.extract import extract_document  # noqa: E402
from shortlist.parse import (RANGE, _heading, _merge_months, _parse_date, classify_heading, parse,  # noqa: E402
                             stated_years)

TODAY = (dt.date.today().year, dt.date.today().month)


# ------------------------------------------------------------------ dates and headings

@pytest.mark.parametrize("s, start, end", [
    ("Jan 2019 – Present", (2019, 1), None),
    ("March 2018 - Dec 2020", (2018, 3), (2020, 12)),
    ("03/2020 – 11/2022", (2020, 3), (2022, 11)),
    ("2016 - 2019", (2016, 1), (2019, 1)),
    ("Sept 2015 to current", (2015, 9), None),
    ("2021.04 – 2023.02", (2021, 4), (2023, 2)),
    ("January 2019 – Till Date", (2019, 1), None),
])
def test_date_ranges(s, start, end):
    m = RANGE.search(s)
    assert m, s
    assert _parse_date(m.group("s"), False)[0] == start
    e, cur, _ = _parse_date(m.group("e"), True)
    assert e == end and cur == (end is None)   # "Present" is resolved later, against the resume's as-of date


def test_overlapping_jobs_counted_once():
    a = (2018 * 12 + 1, 2019 * 12 + 12 + 1)
    b = (2019 * 12 + 6, 2020 * 12 + 12 + 1)
    assert _merge_months([a, b]) == 36


@pytest.mark.parametrize("line, want", [
    ("EXPERIENCE", "experience"), ("Professional Experience", "experience"), ("Technical Skills:", "skills"),
    ("Education", "education"), ("Languages", "languages"), ("training).", None), ("model registry.", None),
    ("Led the migration of 40 services to Kubernetes", None),
    ("EMPLOYMENT DETAILS", "experience"), ("EDUCATIONAL QUALIFICATION", "education"),
    ("Education & Professional Development", "education"), ("PERSONAL PROFILE", "personal"),
    ("Programming Languages", "skills"), ("Work History", "experience"), ("Technical Experience", "experience"),
    ("Academics:", "education"), ("Career Objective:", "summary"), ("Experiance", "experience"),
])
def test_headings(line, want):
    assert _heading(line) == want


def test_heading_classifier_confidence():
    assert classify_heading("Certifications")[0] == "certifications"
    assert classify_heading("Roles and Responsibilities")[0] is None


@pytest.mark.parametrize("text, want", [
    ("Hard working professional with about 6 years of total work experience in DevOps.", (6.0, False)),
    ("Professional with 3.1 years of total work experience in Networking.", (3.1, False)),
    ("Senior engineer with 12+ years of experience building platforms.", (12.0, True)),
    ("DBA with 11+ years of core DBA experience and 14+ years in IT.", (14.0, True)),
    ("SDET with over 8+ years specializing in automation.", (8.0, True)),
    ("Over a decade of experience in cloud.", (10.0, True)),
    ("I have 5 years of Python experience and love Go.", None),
])
def test_stated_years(text, want):
    assert stated_years(text) == want


# ------------------------------------------------------------------ experience and as-of date

LABEL_RESUME = """Jane Doe
Email: jane@example.com

CAREER SUMMARY
Hard working professional with about 6 years of total work experience in DevOps and Automation.

EMPLOYMENT DETAILS

Employer: Acme Cloud Pvt. Ltd.

Work Period: January 2019 – Till Date

Designation: Application Developer

Duration: January 2019 – Till Date

Employer: Beta Systems Ltd.

Work Period: April 2014 – December 2018

Designation: Systems Engineer

Duration: April 2014 – March 2016

Designation: Release Engineer

Duration: April 2016 – December 2018

EDUCATIONAL QUALIFICATION

Bachelor of Technology (CSE)

Shri Sai Institute of Engineering

2013

PERSONAL PROFILE

Languages Known : English, Telugu, Hindi, and Kannada
Development and scripting languages : C, Python
"""


def test_label_layout_and_old_resume_dating():
    # Saved in April 2020: "Till Date" means April 2020, not today
    p = parse(LABEL_RESUME, doc_date=dt.date(2020, 4, 8))
    assert p.as_of == (2020, 4)
    assert p.years == 6.0 and p.years_source == "stated"
    assert 6.0 <= p.years_dates <= 6.2
    titles = [j.title for j in p.jobs]
    assert titles == ["Application Developer", "Systems Engineer", "Release Engineer"]   # no "Work Period:" titles
    assert not any("Period" in t or "Duration" in t for t in titles)
    assert p.jobs[1].company == "Beta Systems Ltd."            # inherited from the employer's container period
    assert {"experience", "education", "personal"} <= set(p.sections)
    assert p.education and p.education[0]["level"] == 2
    assert p.languages == {"English": 0.6, "Telugu": 0.6, "Hindi": 0.6, "Kannada": 0.6}   # listed, no levels; not C/Python


def test_pasted_old_resume_without_metadata_uses_stated_years():
    p = parse(LABEL_RESUME)          # no document date: anchor "Present" on the stated 6 years
    assert p.years == 6.0
    assert p.as_of_source == "stated experience" and p.as_of[0] == 2020


def test_lower_bound_stated_years_accepts_longer_dates():
    text = ("SUMMARY\nSDET with over 8+ years specializing in automation.\n\nEXPERIENCE\n"
            "Senior Engineer - Carrier Tech Ltd., Hyderabad - July 2022 – Present\n- Built test frameworks.\n"
            "Test Engineer - Mind Ltd., Bengaluru - May 2014 – June 2022\n- Wrote Selenium suites.\n")
    p = parse(text, doc_date=dt.date(2025, 11, 14))
    assert p.as_of == (2025, 11)                 # the document date fits "8+", so it isn't overridden
    assert p.years_source == "dates" and p.years > 8
    assert [j.company for j in p.jobs] == ["Carrier Tech Ltd.", "Mind Ltd."]
    assert [j.title for j in p.jobs] == ["Senior Engineer", "Test Engineer"]


def test_blank_line_title_above_company_date_line():
    text = ("Experience\n\nSenior Application Software Engineer - AI/ML & Agentic Systems\n\n"
            "Oracle Jun 2026 - Present, Bengaluru, India\n\nDriving the runtime architecture.\n\n"
            "Senior DevOps Engineer\n\nOracle Mar 2025 - May 2026, Bengaluru, India\n\nBuilt pipelines.\n")
    p = parse(text, doc_date=dt.date(2026, 10, 1))
    assert [j.title for j in p.jobs] == ["Senior Application Software Engineer - AI/ML & Agentic Systems",
                                         "Senior DevOps Engineer"]
    assert [j.company for j in p.jobs] == ["Oracle", "Oracle"]


def test_prose_label_between_title_and_dates():
    text = ("Professional Experience:\n\nTCS – Keysight Technologies\n\nAssistant Consultant (Oracle DBA)\n\n"
            "Key Accomplishments: Reduced patching downtime by streamlining quarterly updates across 40 databases.\n\n"
            "Duration: June 2019 – Apr 2022\n")
    p = parse(text)
    assert p.jobs[0].title == "Assistant Consultant (Oracle DBA)" and p.jobs[0].company == "TCS"
    assert "skills" not in p.sections            # "...Technologies" in a company line isn't a Skills heading


def test_no_languages_listed_means_no_made_up_levels():
    p = parse("SUMMARY\nPlatform engineer.\n\nEXPERIENCE\nEngineer | Acme\nJan 2020 – Dec 2022\n- Built things.\n")
    assert p.languages == {}
    assert p.effective_languages()["English"] == 0.7   # inferred from the resume language, for country scoring


# ------------------------------------------------------------------ document formats

def _docx(paragraphs, core_date=None, styled=()):
    b = io.BytesIO()
    z = zipfile.ZipFile(b, "w")
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    body = ""
    for t in paragraphs:
        x = t.replace("&", "&amp;").replace("<", "&lt;")
        rpr = "<w:rPr><w:b/></w:rPr>" if t in styled else ""
        body += f'<w:p><w:r>{rpr}<w:t xml:space="preserve">{x}</w:t></w:r></w:p>'
    z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>')
    if core_date:
        z.writestr("docProps/core.xml", f'<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dcterms="http://purl.org/dc/terms/"><dcterms:modified>{core_date}T10:00:00Z</dcterms:modified></cp:coreProperties>')
    z.close()
    return b.getvalue()


def test_docx_metadata_date_and_bold_headings():
    data = _docx(LABEL_RESUME.split("\n"), core_date="2020-04-08", styled=("CAREER SUMMARY", "EMPLOYMENT DETAILS"))
    doc = extract_document("old.docx", data)
    assert doc.modified == dt.date(2020, 4, 8)
    assert doc.headings.get("employment details", 0) >= 0.4
    p = parse(doc.text, doc.headings, doc.modified)
    assert p.years == 6.0 and p.as_of == (2020, 4)


def _letter_spaced_pdf():
    """A PDF whose text is drawn one glyph at a time with extra character spacing, which pypdf
    reads as 'E x p e r i e n c e' while PyMuPDF keeps the words."""
    lines = ["Jane Doe", "PROFESSIONAL EXPERIENCE", "Senior Test Engineer - Acme Ltd. - Jan 2019 - Present",
             "Built Selenium and Playwright automation suites in Python for 40 services."] * 3
    ops = []
    y = 800
    for ln in lines:
        ops.append(f"BT /F1 10 Tf 3 Tc 40 {y} Td ({ln}) Tj ET")
        y -= 16
    content = "\n".join(ops)
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", f"<< /Length {len(content)} >>\nstream\n{content}\nendstream"]
    out, offs = "%PDF-1.4\n", []
    for i, o in enumerate(objs):
        offs.append(len(out))
        out += f"{i + 1} 0 obj\n{o}\nendobj\n"
    x = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offs)
    out += f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF"
    return out.encode("latin-1")


def test_pdf_extraction_keeps_words():
    pytest.importorskip("fitz")
    doc = extract_document("r.pdf", _letter_spaced_pdf())
    assert doc.engine == "pymupdf"
    words = doc.text.split()
    assert "EXPERIENCE" in doc.text and sum(len(w) == 1 for w in words) / len(words) < 0.2
    assert parse(doc.text, doc.headings, doc.modified).jobs


def test_doc_word97_reader_on_minimal_document():
    pytest.importorskip("olefile")
    from shortlist.extract import _doc
    # Not a valid OLE file: must fall back cleanly to the byte scan, not crash.
    doc = _doc(b"\xd0\xcf\x11\xe0" + ("Experience Senior Engineer Acme 2019 2021 ".encode("utf-16-le")) * 20)
    assert "Experience" in doc.text


@pytest.mark.parametrize("name, data", [
    ("r.txt", b"EXPERIENCE\nEngineer | Acme\nJan 2020 - Dec 2022\n"),
    ("r.rtf", rb"{\rtf1\ansi EXPERIENCE\par Engineer | Acme\par Jan 2020 - Dec 2022\par}"),
    ("r.html", b"<html><body><h2>Experience</h2><p>Engineer | Acme</p><p>Jan 2020 - Dec 2022</p></body></html>"),
])
def test_other_formats(name, data):
    doc = extract_document(name, data)
    assert parse(doc.text, doc.headings, doc.modified).jobs


def test_odt_with_heading_and_metadata():
    b = io.BytesIO()
    z = zipfile.ZipFile(b, "w")
    z.writestr("mimetype", "application/vnd.oasis.opendocument.text")
    z.writestr("content.xml", '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h>Work History</text:h><text:p>Engineer | Acme</text:p><text:p>Jan 2020 - Present</text:p></office:text></office:body></office:document-content>')
    z.writestr("meta.xml", '<?xml version="1.0"?><office:document-meta xmlns:office="o" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:date>2021-06-01T00:00:00</dc:date></office:document-meta>')
    z.close()
    doc = extract_document("r.odt", b.getvalue())
    assert doc.headings.get("work history") == 1.0 and doc.modified == dt.date(2021, 6, 1)
    p = parse(doc.text, doc.headings, doc.modified)
    assert p.jobs and p.jobs[0].end == (2021, 6)


# ------------------------------------------------------------------ scoring properties (need torch)

RESUME = """Jane Doe
Senior DevOps Engineer
Berlin, Germany | jane@example.com | +49 30 1234 5678

EXPERIENCE
Senior DevOps Engineer | Acme GmbH
Jan 2020 – Dec 2023
- Built CI/CD with GitHub Actions and Argo CD for 30 services.

DevOps Engineer | Beta AG
Feb 2016 – Dec 2019
- Terraform and Ansible on AWS.

EDUCATION
B.Sc. Informatics, 2012 – 2016

LANGUAGES
German (native), English (C1), French (A2)
"""


def test_parse_profile():
    p = parse(RESUME, doc_date=dt.date(2024, 1, 10))
    assert [j.title for j in p.jobs] == ["Senior DevOps Engineer", "DevOps Engineer"]
    assert p.jobs[0].company == "Acme GmbH"
    assert 7.8 <= p.years <= 8.0          # education dates are excluded
    assert p.locations == ["germany"]
    assert p.languages["German"] == 1.0 and p.languages["English"] == 0.9 and p.languages["French"] == 0.25
    assert p.title_rank == 1


@pytest.fixture(scope="module")
def analysis():
    pytest.importorskip("torch")
    from shortlist.score import analyze
    return analyze(RESUME)


def test_scores_are_bounded_and_consistent(analysis):
    r = analysis
    for ro in r["role_order"]:
        for lv in r["level_order"]:
            c = r["matrix"][ro][lv]
            assert 0 <= c["score"] <= 1 and 0 <= c["role_fit"] <= 1
            im = c["improve"]
            assert im["potential"] >= c["score"] - 1e-9
            assert all(a["gain"] > 0 for a in im["actions"])
            assert im["actions"] == sorted(im["actions"], key=lambda a: -a["gain"])
            assert im["potential"] <= 1
    best = max((r["matrix"][ro][lv]["score"], ro) for ro in r["role_order"] for lv in r["level_order"])
    assert best[1] in ("devops", "platform")
    assert len(r["countries"]) == 17 and r["families"]


def test_adding_a_skill_never_lowers_the_score():
    pytest.importorskip("torch")
    from shortlist.score import analyze
    before = analyze(RESUME)["matrix"]["sre"]["senior"]["score"]
    more = RESUME.replace("- Terraform and Ansible on AWS.", "- Terraform and Ansible on AWS; defined SLOs and ran incident response.")
    after = analyze(more)["matrix"]["sre"]["senior"]["score"]
    assert after >= before


def test_under_five_years_factor():
    pytest.importorskip("torch")
    from shortlist.score import analyze
    r = analyze(RESUME, years=3)
    assert r["profile"]["exp_factor"] == pytest.approx(0.76)


# ------------------------------------------------------------------ data handling

def test_cache_forget_and_expiry(monkeypatch):
    pytest.importorskip("torch")
    from shortlist import score
    score.forget()
    r = score.analyze(RESUME)
    assert r["doc_key"] in score._cache
    assert score.forget(r["doc_key"]) == 1 and r["doc_key"] not in score._cache
    score.analyze(RESUME)
    monkeypatch.setattr(score, "CACHE_TTL", -1)        # everything is now expired
    score.analyze(RESUME + "\n")                        # any new request purges expired entries
    assert len(score._cache) == 1


def test_uploads_stay_in_memory_and_results_are_not_cached_by_browser():
    pytest.importorskip("torch")
    import app as server
    client = server.app.test_client()
    big = RESUME + "\n" + ("Built pipelines on Kubernetes. " * 30000)   # ~900 KB, above Werkzeug's 500 KB spool limit
    seen = []
    orig = server.MemoryRequest._get_file_stream
    server.MemoryRequest._get_file_stream = lambda self, *a, **k: seen.append(type(orig(self, *a, **k)).__name__) or orig(self, *a, **k)
    try:
        r = client.post("/api/analyze", data={"file": (io.BytesIO(big.encode()), "r.txt")}, content_type="multipart/form-data")
    finally:
        server.MemoryRequest._get_file_stream = orig
    assert r.status_code == 200 and r.headers["Cache-Control"] == "no-store"
    assert seen and all(s == "BytesIO" for s in seen)
    assert client.post("/api/forget", json={"key": r.get_json()["doc_key"]}).get_json()["forgotten"] == 1


# ------------------------------------------------------------------ role families and per-tier templates

def test_templates_cover_every_family_and_tier():
    from shortlist.knowledge import FAMILIES, FAMILY_INFO, LEVEL_IDS, ROLES, level_config, role_band, role_groups
    assert len(FAMILIES) >= 9 and len(ROLES) >= 50
    assert list(FAMILIES)[0] == "infra"   # families.json order, not alphabetical
    for rid, r in ROLES.items():
        assert r["family"] in FAMILY_INFO and r["description"] and r["titles"]
        for lid in LEVEL_IDS:
            a, b = role_band(rid, lid)
            assert 0 <= a < b
            assert role_groups(rid, lid)
            assert level_config(r["family"], lid)["label"]
    # bands rise with the tier for every role
    for rid in ROLES:
        mins = [role_band(rid, lid)[0] for lid in LEVEL_IDS]
        assert mins == sorted(mins), rid


def test_level_gated_skills_join_at_their_tier():
    from shortlist.knowledge import role_groups
    ids = lambda rid, lid: {g for g, _, _ in role_groups(rid, lid)}
    assert ("cloud_arch",) not in ids("cloud_eng", "senior")
    assert ("cloud_arch",) in ids("cloud_eng", "architect")
    # a group repeated "from" a tier weighs more there, but still shows as one skill
    w = lambda lid: dict((g, w) for g, w, _ in role_groups("qa_automation", lid))[("test_framework",)]
    assert w("engineer") == 2 and w("senior") == 4
    assert all(tier <= 3 for _, _, tier in role_groups("qa_automation", "senior"))


def test_target_titles_follow_each_familys_ladder():
    from shortlist.score import _target_title
    assert _target_title("devops", "senior") == "Senior DevOps Engineer"
    assert _target_title("devops", "architect") == "DevOps Architect"
    assert _target_title("mech_design", "architect") == "Principal Mechanical Design Engineer"
    assert _target_title("ux_designer", "sr_architect") == "Head of Design"
    assert _target_title("soc_analyst", "lead") == "SOC Lead"
    assert _target_title("product_mgr", "sr_architect") == "VP of Product"


QA_RESUME = """Priya Sharma
Senior QA Automation Engineer
Pune, India | priya@example.com

EXPERIENCE
Senior QA Automation Engineer | Gamma Tech
Mar 2019 – Dec 2023
- Built a Selenium WebDriver and TestNG framework in Java using the page object model; 1,200 regression tests.
- API testing with Postman and Rest Assured; BDD with Cucumber; Jenkins CI runs on every merge.
- Mobile automation with Appium; defects tracked in Jira; test plans and test cases for each sprint.

QA Engineer | Delta Soft
Jun 2015 – Feb 2019
- Manual, functional and regression testing; wrote test scenarios; SQL for data validation.

EDUCATION
B.E. Computer Science, 2011 – 2015
"""

MECH_RESUME = """Arjun Rao
Mechanical Design Engineer
Chennai, India | arjun@example.com

EXPERIENCE
Senior Design Engineer | Omega Machines
Jan 2018 – Dec 2023
- 3D modelling in SolidWorks and Creo; 2D engineering drawings with GD&T and tolerance stack-up analysis.
- FEA in ANSYS for brackets and frames; DFM reviews with suppliers for sheet metal and casting parts.
- DFMEA for new products; BOMs released through Windchill PLM; prototyping and validation testing.

Design Engineer | Sigma Industries
Jul 2014 – Dec 2017
- Machine design and design calculations; AutoCAD detailing to ASME standards.

EDUCATION
B.E. Mechanical Engineering, 2010 – 2014
"""


@pytest.mark.parametrize("text, family, role", [(QA_RESUME, "quality", "qa_automation"),
                                                (MECH_RESUME, "engineering", "mech_design")])
def test_resumes_land_in_their_family(text, family, role):
    pytest.importorskip("torch")
    from shortlist.score import analyze
    r = analyze(text)
    best = max(r["role_order"], key=lambda ro: r["matrix"][ro]["senior"]["score"])
    assert best == role and r["roles"][best]["family"] == family
    cell = r["matrix"][best]["senior"]
    assert cell["seniority"]["band"] and cell["title"].startswith("Senior")
    # improvement texts are shared via an index table
    assert all(isinstance(a["text"], int) and r["texts"][a["text"]] for a in cell["improve"]["actions"])


def test_role_band_overrides_family_band():
    from shortlist.knowledge import role_band
    assert role_band("soc_analyst", "engineer") == [1, 5]           # role's own band
    assert role_band("sec_eng", "engineer") == [2, 6]               # family band


def test_meta_keeps_family_order():
    pytest.importorskip("flask")
    import app as server
    m = server.app.test_client().get("/api/meta").get_json()
    assert list(m["families"])[:3] == ["infra", "data_ai", "software"]
    assert m["families"]["design"]["ladder"]["sr_architect"] == "Head of Design"
