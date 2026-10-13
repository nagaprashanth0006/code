"""Print what Shortlist reads from one or more resumes — for checking real files locally.

    python scripts/check_samples.py path/to/resume.pdf [more files...]

Nothing is written or uploaded. Keep real resumes out of the repo (samples/ is git-ignored).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shortlist.extract import ExtractError, extract_document  # noqa: E402
from shortlist.score import analyze  # noqa: E402


def main(paths):
    for path in paths:
        name = os.path.basename(path)
        print("=" * 100)
        print(name)
        data = open(path, "rb").read()
        try:
            doc = extract_document(name, data)
        except ExtractError as e:
            print("  could not read:", e)
            continue
        r = analyze(doc.text, filename=name, data=data, doc=doc)
        p = r["profile"]
        print(f"  read with {doc.engine}; {p['words']} words; document date {doc.modified or doc.created or 'none'}")
        print(f"  experience: {p['years_derived']} yrs ({p['years_source']}; stated {p['years_stated']}, "
              f"dates {p['years_dates']}); 'Present' = {p['as_of']} ({p['as_of_source']})")
        if p["years_note"]:
            print("  note:", p["years_note"])
        print("  sections:", ", ".join(f"{s['type']}<{s['heading'] or '-'}|{s['source']}>" for s in p["section_info"]))
        for j in p["jobs"]:
            print(f"    job: {j['title'] or '(no title)':55.55} | {j['company'] or '-':30.30} | {j['start']} – {j['end']}")
        for e in p["education"]:
            print(f"    edu: {e['degree'][:60]:60} | {e['institution'][:30]:30} | {e['year']}")
        langs = dict(p["languages"])
        print("  languages:", langs or "none listed", "| location:", p["location"] or "-")
        print("  ATS issues:", [c["label"] for c in r["ats"]["checks"] if c["status"] != "pass"] or "none")
        cells = sorted(((r["matrix"][ro][lv]["score"], r["matrix"][ro][lv]["title"])
                        for ro in r["role_order"] for lv in r["level_order"]), reverse=True)[:3]
        print("  top fits:", "; ".join(f"{title} {s * 100:.0f}%" for s, title in cells))
        best = {}
        for ro in r["role_order"]:
            fam = r["roles"][ro]["family"]
            s = max(c["score"] for c in r["matrix"][ro].values())
            if s > best.get(fam, (0, ""))[0]:
                best[fam] = (s, r["roles"][ro]["label"])
        print("  best per family:", "; ".join(f"{r['families'][f]['label']}: {lab} {s * 100:.0f}%"
                                             for f, (s, lab) in sorted(best.items(), key=lambda x: -x[1][0])[:4]))
        top_c = sorted(r["countries"], key=lambda c: -c["score"])[:3]
        print("  top countries:", ", ".join(f"{c['label']} {c['score'] * 100:.0f}%" for c in top_c))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
