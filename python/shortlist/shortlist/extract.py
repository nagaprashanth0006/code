"""Document → text for resumes, keeping what parsers need beyond plain text:

* line-level formatting hints (heading styles, bold, larger font) used to find section headings
* document dates (DOCX/ODT/PDF/DOC metadata) used to date "Present" on older resumes
* diagnostics for ATS checks (multi-column pages, letter-spaced PDF text, photos, header contacts)

PDF uses PyMuPDF (column-aware reading order) with pypdf as a fallback. Legacy .doc uses antiword or
LibreOffice when available, then a built-in Word 97-2003 reader (olefile).
"""
from __future__ import annotations

import datetime as dt
import html
import io
import os
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass, field
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
TEXT_NS = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
SUPPORTED = (".pdf", ".docx", ".docm", ".dotx", ".doc", ".odt", ".ott", ".fodt", ".rtf", ".txt", ".md", ".markdown",
             ".text", ".html", ".htm")


class ExtractError(Exception):
    pass


@dataclass
class Document:
    text: str
    headings: dict[str, float] = field(default_factory=dict)   # normalised line text -> formatting score 0..1
    modified: dt.date | None = None                            # last-saved date from metadata
    created: dt.date | None = None
    diagnostics: dict = field(default_factory=dict)
    engine: str = ""


def norm_line(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def extract_document(filename: str, data: bytes) -> Document:
    ext = os.path.splitext(filename.lower())[1]
    if ext not in SUPPORTED:
        raise ExtractError(f"Unsupported file type “{ext or filename}”. Use PDF, DOCX, DOC, ODT, RTF or TXT.")
    try:
        if ext == ".pdf":
            doc = _pdf(data)
        elif ext in (".docx", ".docm", ".dotx"):
            doc = _docx(data)
        elif ext in (".odt", ".ott"):
            doc = _odt(data)
        elif ext == ".fodt":
            text, heads = _odf_text(ET.fromstring(data))
            doc = Document(text, heads, engine="odt")
        elif ext == ".rtf":
            doc = Document(_rtf(_decode(data)), engine="rtf")
        elif ext == ".doc":
            doc = _doc(data)
        elif ext in (".html", ".htm"):
            doc = _html(_decode(data))
        else:
            doc = Document(_decode(data), engine="text")
    except ExtractError:
        raise
    except Exception as e:
        raise ExtractError(f"Couldn't read this {ext[1:].upper()} file ({e.__class__.__name__}).") from e
    text = doc.text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    doc.text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not doc.text:
        raise ExtractError("No text found. Scanned PDFs or images need OCR first.")
    return doc


def extract(filename: str, data: bytes, keep_lines: bool = True) -> str:
    """Plain-text convenience wrapper."""
    return extract_document(filename, data).text


def _decode(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _date(s) -> dt.date | None:
    if not s:
        return None
    m = re.search(r"(\d{4})-?(\d{2})-?(\d{2})", str(s))
    if not m:
        return None
    try:
        d = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    return d if dt.date(1990, 1, 1) <= d <= dt.date.today() else None


# ------------------------------------------------------------------ PDF

def _pdf(data: bytes) -> Document:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return _pdf_pypdf(data)
    try:
        pdf = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return _pdf_pypdf(data)
    if pdf.needs_pass and not pdf.authenticate(""):
        raise ExtractError("This PDF is password-protected.")
    out, sizes, lines_meta, col_pages, photo = [], [], [], 0, False
    respaced = 0
    for pno, page in enumerate(pdf):
        width = page.rect.width
        blocks = [b for b in page.get_text("rawdict")["blocks"] if b.get("type") == 0]
        for b in blocks:                      # rebuild span text from glyphs, repairing letter-spacing
            for ln in b["lines"]:
                fixed = _line_text(ln)
                respaced += fixed[1]
                for s in ln["spans"]:
                    s["text"] = ""
                if ln["spans"]:
                    ln["spans"][0]["text"] = fixed[0]
        # Column detection: substantial text blocks in a left column (ends before mid-page) and blocks
        # starting further right that sit beside them. Covers 50/50 columns and sidebar templates; a
        # right-aligned date next to a job title is too short to count.
        # Sidebar items are often short (one skill per line), so the test is aggregate: where does a
        # substantial right-hand column start, and how much text sits entirely left of it beside it?
        right = [b for b in blocks if b["bbox"][0] >= width * 0.3 and _block_chars(b) > 40]
        two_col = False
        if right and sum(_block_chars(b) for b in right) >= 200:
            col_x = min(b["bbox"][0] for b in right)
            y0, y1 = min(b["bbox"][1] for b in right), max(b["bbox"][3] for b in right)
            left = [b for b in blocks if b["bbox"][0] < width * 0.25 and b["bbox"][2] <= col_x - 4
                    and b["bbox"][3] > y0 and b["bbox"][1] < y1 and _block_chars(b) > 0]
            two_col = len(left) >= 3 and sum(_block_chars(b) for b in left) >= 60
        if two_col:
            col_pages += 1
            top = min(b["bbox"][1] for b in left + right)
            mid = min(b["bbox"][0] for b in right)

            def key(b, top=top, mid=mid, width=width):
                if (b["bbox"][2] - b["bbox"][0]) >= width * 0.6:   # full-width block (name banner, footer)
                    return (0 if b["bbox"][1] < top else 3, b["bbox"][1])
                return (1 if b["bbox"][0] < mid - 5 else 2, b["bbox"][1])
            blocks.sort(key=key)
        else:
            blocks.sort(key=lambda b: (round(b["bbox"][1] / 3), b["bbox"][0]))
        for b in blocks:
            for ln in b["lines"]:
                txt = "".join(s["text"] for s in ln["spans"]).strip()
                spans = [s for s in ln["spans"] if s.get("chars")]
                if not txt or not spans:
                    continue
                size = max(s["size"] for s in spans)
                bold = all((s["flags"] & 16) or "bold" in s["font"].lower() for s in spans
                           if any(c["c"].strip() for c in s["chars"]))
                out.append(txt)
                sizes.append(size)
                lines_meta.append((txt, size, bold))
            out.append("")
        if pno == 0:
            try:
                for img in page.get_image_info():
                    x0, y0, x1, y1 = img["bbox"]
                    w, h = x1 - x0, y1 - y0
                    if 40 <= w <= 220 and 0.6 <= w / max(h, 1) <= 1.1 and y0 < page.rect.height * 0.4:
                        photo = True
            except Exception:
                pass
    body = sorted(sizes)[len(sizes) // 2] if sizes else 10
    headings = {}
    for txt, size, bold in lines_meta:
        score = (0.5 if size >= body * 1.15 else 0) + (0.4 if bold else 0)
        if score and len(txt.split()) <= 7:
            k = norm_line(txt)
            headings[k] = max(headings.get(k, 0), min(1.0, score))
    meta = pdf.metadata or {}
    doc = Document("\n".join(out), headings, _date(meta.get("modDate")), _date(meta.get("creationDate")),
                   {"pages": len(pdf), "column_pages": col_pages, "photo": photo, "respaced_lines": respaced}, "pymupdf")
    # Letter-spaced text: either we had to repair it, or a common parser (pypdf) reads it as single letters.
    doc.diagnostics["letter_spaced_elsewhere"] = respaced > 3 or _pypdf_letter_spaced(data)
    return doc


def _line_text(line) -> tuple[str, bool]:
    """Text of one PDF line from its glyphs. Normally glyphs + the PDF's own spaces; for letter-spaced
    text (every glyph pushed apart, so naive extraction gives "E x p e r i e n c e"), word breaks are
    put only where the gap is clearly wider than the usual letter gap."""
    chars = [(c["c"], c["bbox"][0], c["bbox"][2], s["size"]) for s in line["spans"] for c in s.get("chars", [])]
    if not chars:
        return "", False
    plain = "".join(c for c, *_ in chars)
    glyphs = [g for g in chars if g[0].strip()]
    if len(glyphs) < 6:
        return plain, False
    gaps = [b[1] - a[2] for a, b in zip(glyphs, glyphs[1:])]
    size = max(g[3] for g in glyphs)
    gaps_sorted = sorted(gaps)
    letter_gap = gaps_sorted[len(gaps_sorted) // 4]           # typical gap inside a word
    if letter_gap < 0.12 * size:                              # normal text: trust the PDF's own spaces
        return plain, False
    out = [glyphs[0][0]]
    for (prev, nxt), gap in zip(zip(glyphs, glyphs[1:]), gaps):
        if gap > letter_gap + 0.18 * size:
            out.append(" ")
        out.append(nxt[0])
    return "".join(out), True


def _block_chars(b) -> int:
    return sum(len(s["text"].strip()) for ln in b["lines"] for s in ln["spans"])


def _pypdf_letter_spaced(data: bytes) -> bool:
    """True when a common parser (pypdf) reads this PDF as spaced-out letters ("E x p e r i e n c e")."""
    try:
        from pypdf import PdfReader
        t = " ".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages[:2])
    except Exception:
        return False
    toks = re.findall(r"\S+", t)
    return len(toks) > 50 and sum(len(x) == 1 and x.isalpha() for x in toks) / len(toks) > 0.45


def _pdf_pypdf(data: bytes) -> Document:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ExtractError("This PDF is password-protected.")
    text = "\n\n".join(p.extract_text() or "" for p in reader.pages)
    info = reader.metadata or {}
    return Document(text, {}, _date(info.get("/ModDate")), _date(info.get("/CreationDate")),
                    {"pages": len(reader.pages), "letter_spaced_elsewhere": False}, "pypdf")


# ------------------------------------------------------------------ DOCX

def _docx(data: bytes) -> Document:
    z = zipfile.ZipFile(io.BytesIO(data))
    names = z.namelist()
    styles = _docx_styles(z.read("word/styles.xml")) if "word/styles.xml" in names else {}
    root = ET.fromstring(z.read("word/document.xml"))
    lines, raw, sizes = [], {}, []
    for p in root.iter(W + "p"):
        txt, size, bold = _docx_para(p)
        if not txt.strip():
            lines.append("")
            continue
        lines += [txt, ""]
        style = p.find(f"{W}pPr/{W}pStyle")
        sid = style.get(W + "val", "") if style is not None else ""
        st = styles.get(sid, {})
        size = size or st.get("size")
        bold = bold or st.get("bold", False)
        if size:
            sizes.append(size)
        is_heading = bool(re.match(r"(heading|title|subtitle|section)", (st.get("name") or sid).lower()))
        raw[norm_line(txt)] = (1.0 if is_heading else 0.0, size, bold)
    body = sorted(sizes)[len(sizes) // 2] if sizes else None
    scored = {}
    for k, (hs, size, bold) in raw.items():
        s = hs + (0.5 if body and size and size >= body * 1.15 else 0) + (0.4 if bold else 0)
        if s and len(k.split()) <= 7:
            scored[k] = min(1.0, s)
    docxml = z.read("word/document.xml").decode("utf-8", "ignore")
    diag = {
        "tables": sum(1 for t in re.findall(r"<w:tbl>.*?</w:tbl>", docxml, re.S) if len(re.sub(r"<[^>]+>", "", t)) > 40),
        "textboxes": len(re.findall(r"<w:txbxContent", docxml)),
        "columns": bool(re.search(r'<w:cols[^>]*w:num="([2-9])"', docxml)),
        "header_contact": False,
        "images": len([n for n in names if n.startswith("word/media/")]),
    }
    hf_text = []
    for n in names:
        if re.match(r"word/(header|footer)\d*\.xml", n):
            t = " ".join(x.text or "" for x in ET.fromstring(z.read(n)).iter(W + "t")).strip()
            if t:
                hf_text.append(t)
                if re.search(r"[\w.+-]+@[\w-]+\.\w+|\+?\d[\d\s().-]{8,}\d", t):
                    diag["header_contact"] = True
    modified = created = None
    if "docProps/core.xml" in names:
        core = z.read("docProps/core.xml").decode("utf-8", "ignore")
        m = re.search(r"<dcterms:modified[^>]*>([^<]+)<", core)
        c = re.search(r"<dcterms:created[^>]*>([^<]+)<", core)
        modified, created = _date(m and m.group(1)), _date(c and c.group(1))
    # Header/footer text goes first so contact details are still found; the ATS check flags it separately.
    text = "\n".join(hf_text + [""] + lines)
    return Document(text, scored, modified, created, diag, "docx")


def _docx_styles(xml: bytes) -> dict:
    out = {}
    for s in ET.fromstring(xml).iter(W + "style"):
        sid = s.get(W + "styleId", "")
        name = s.find(W + "name")
        rpr = s.find(W + "rPr")
        size = bold = None
        if rpr is not None:
            sz = rpr.find(W + "sz")
            size = int(sz.get(W + "val")) / 2 if sz is not None and (sz.get(W + "val") or "").isdigit() else None
            b = rpr.find(W + "b")
            bold = b is not None and b.get(W + "val", "true") not in ("0", "false")
        out[sid] = {"name": name.get(W + "val") if name is not None else sid, "size": size, "bold": bool(bold)}
    return out


def _docx_para(p) -> tuple[str, float | None, bool]:
    """Text of one paragraph, skipping nested text-box paragraphs (they are visited on their own)."""
    parts, sizes, bolds = [], [], []

    def walk(el):
        for ch in el:
            if ch.tag == W + "txbxContent":
                continue
            if ch.tag == W + "r":
                rpr = ch.find(W + "rPr")
                txt = "".join((t.text or "") if t.tag == W + "t" else "\t" if t.tag == W + "tab" else
                              "\n" if t.tag in (W + "br", W + "cr") else "" for t in ch)
                if txt.strip():
                    sz = rpr.find(W + "sz") if rpr is not None else None
                    b = rpr.find(W + "b") if rpr is not None else None
                    sizes.append(int(sz.get(W + "val")) / 2 if sz is not None and (sz.get(W + "val") or "").isdigit() else None)
                    bolds.append(b is not None and b.get(W + "val", "true") not in ("0", "false"))
                parts.append(txt)
            else:
                walk(ch)
    walk(p)
    known = [s for s in sizes if s]
    return "".join(parts), (max(known) if known else None), bool(bolds) and all(bolds)


# ------------------------------------------------------------------ ODT / RTF / HTML

def _odf_text(root) -> tuple[str, dict]:
    headings = {}

    def walk(el):
        out = [el.text or ""]
        for ch in el:
            if ch.tag == TEXT_NS + "s":
                out.append(" " * int(ch.get(TEXT_NS + "c", "1")))
            elif ch.tag == TEXT_NS + "tab":
                out.append("\t")
            elif ch.tag == TEXT_NS + "line-break":
                out.append("\n")
            elif ch.tag != TEXT_NS + "note":
                out.append(walk(ch))
            out.append(ch.tail or "")
        return "".join(out)

    paras = []
    for el in root.iter():
        if el.tag in (TEXT_NS + "p", TEXT_NS + "h"):
            t = walk(el)
            if t.strip():
                paras.append(t)
                if el.tag == TEXT_NS + "h":
                    headings[norm_line(t)] = 1.0
    return "\n\n".join(paras), headings


def _odt(data: bytes) -> Document:
    z = zipfile.ZipFile(io.BytesIO(data))
    text, headings = _odf_text(ET.fromstring(z.read("content.xml")))
    modified = created = None
    if "meta.xml" in z.namelist():
        meta = z.read("meta.xml").decode("utf-8", "ignore")
        m = re.search(r"<dc:date>([^<]+)<", meta)
        c = re.search(r"<meta:creation-date>([^<]+)<", meta)
        modified, created = _date(m and m.group(1)), _date(c and c.group(1))
    return Document(text, headings, modified, created, {}, "odt")


def _rtf(s: str) -> str:
    """Minimal RTF → text: drops destinations (fonts, styles, pictures) and control words."""
    out, stack, skip = [], [], False
    i, n = 0, len(s)
    skip_dest = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl",
                 "headerr", "footerl", "footerr", "footnote", "themedata", "colorschememapping", "latentstyles",
                 "datastore", "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator"}
    while i < n:
        c = s[i]
        if c == "{":
            stack.append(skip)
            i += 1
        elif c == "}":
            skip = stack.pop() if stack else False
            i += 1
        elif c == "\\":
            m = re.match(r"\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\(.)", s[i:])
            if not m:
                i += 1
                continue
            i += m.end()
            if m.group(3):
                if not skip:
                    out.append(bytes([int(m.group(3), 16)]).decode("cp1252", "replace"))
            elif m.group(4):
                ch = m.group(4)
                if ch == "*":
                    skip = True
                elif ch in "\\{}" and not skip:
                    out.append(ch)
                elif ch == "~" and not skip:
                    out.append(" ")
            else:
                w, arg = m.group(1), m.group(2)
                if w in skip_dest:
                    skip = True
                elif skip:
                    pass
                elif w in ("par", "line", "sect", "page", "row"):
                    out.append("\n")
                elif w in ("tab", "cell"):
                    out.append("\t")
                elif w == "u" and arg:
                    out.append(chr(int(arg) % 65536))
                    if i < n and s[i] == "?":
                        i += 1
                elif w == "emdash":
                    out.append("—")
                elif w == "endash":
                    out.append("–")
                elif w in ("lquote", "rquote"):
                    out.append("'")
                elif w in ("ldblquote", "rdblquote"):
                    out.append('"')
        elif c in "\r\n":
            i += 1
        else:
            if not skip:
                out.append(c)
            i += 1
    return "".join(out)


def _html(s: str) -> Document:
    s = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", s)
    headings = {norm_line(html.unescape(re.sub(r"<[^>]+>", " ", h))): 1.0
                for h in re.findall(r"(?is)<h[1-4][^>]*>(.*?)</h[1-4]>", s)}
    s = re.sub(r"(?i)<br\s*/?>|</(p|div|h\d|li|tr)>", "\n", s)
    return Document(html.unescape(re.sub(r"<[^>]+>", " ", s)), headings, engine="html")


# ------------------------------------------------------------------ legacy .doc

def _doc(data: bytes) -> Document:
    # Some ".doc" files are really RTF, DOCX or HTML.
    if data[:5] == b"{\\rtf":
        return Document(_rtf(_decode(data)), engine="rtf")
    if data[:2] == b"PK":
        return _docx(data)
    if data[:200].lstrip().lower().startswith((b"<html", b"<!doctype")):
        return _html(_decode(data))
    modified, created = _ole_dates(data)
    # In-memory reader first; external tools need the file written to a (deleted-afterwards) temp folder.
    engine = "word97"
    try:
        text = _doc_word97(data)
    except Exception:
        text = ""
    if len(text.split()) < 20:
        engine, text = "antiword/libreoffice", _doc_external(data)
    if not text or len(text.split()) < 20:
        engine, text = "scan", _doc_scan(data)
    return Document(text, {}, modified, created, {}, engine)


def _find_tool(names, extra_dirs):
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    for d in extra_dirs:
        for n in names:
            for cand in (os.path.join(d, n), os.path.join(d, n + ".exe")):
                if os.path.exists(cand):
                    return cand
    return None


def _doc_external(data: bytes) -> str:
    git = [os.path.join(os.environ.get(v, ""), "Git", "mingw64", "bin") for v in ("ProgramFiles", "ProgramFiles(x86)")]
    office = [r"C:\Program Files\LibreOffice\program", "/Applications/LibreOffice.app/Contents/MacOS"]
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.doc")
        with open(src, "wb") as f:
            f.write(data)
        tool = _find_tool(["antiword"], git + ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"])
        if tool:
            try:
                r = subprocess.run([tool, "-w", "0", src], capture_output=True, timeout=30)
                if r.returncode == 0 and r.stdout.strip():
                    return _decode(r.stdout)
            except Exception:
                pass
        soffice = _find_tool(["soffice", "libreoffice"], office)
        if soffice:
            try:
                subprocess.run([soffice, "--headless", "--convert-to", "txt:Text", "--outdir", tmp, src],
                               capture_output=True, timeout=90)
                out = os.path.join(tmp, "in.txt")
                if os.path.exists(out):
                    return _decode(open(out, "rb").read())
            except Exception:
                pass
    return ""


def _doc_word97(data: bytes) -> str:
    """Word 97-2003 binary: read the piece table (CLX) from the table stream and decode each piece."""
    import olefile
    ole = olefile.OleFileIO(io.BytesIO(data))
    wd = ole.openstream("WordDocument").read()
    if struct.unpack_from("<H", wd, 0)[0] != 0xA5EC:
        raise ValueError("not a Word document")
    flags = struct.unpack_from("<H", wd, 0x0A)[0]
    table = ole.openstream("1Table" if flags & 0x0200 else "0Table").read()
    ccp_text = struct.unpack_from("<I", wd, 0x4C)[0]
    fc_clx, lcb_clx = struct.unpack_from("<II", wd, 0x01A2)
    clx = table[fc_clx:fc_clx + lcb_clx]
    i = 0
    while i < len(clx) and clx[i] == 0x01:  # skip Prc (property) entries
        i += 3 + struct.unpack_from("<H", clx, i + 1)[0]
    if i >= len(clx) or clx[i] != 0x02:
        raise ValueError("no piece table")
    lcb = struct.unpack_from("<I", clx, i + 1)[0]
    plc = clx[i + 5:i + 5 + lcb]
    n = (lcb - 4) // 12
    cps = struct.unpack_from(f"<{n + 1}I", plc, 0)
    out = []
    for k in range(n):
        start, end = cps[k], min(cps[k + 1], ccp_text)
        if start >= ccp_text:
            break
        fc = struct.unpack_from("<I", plc, 4 * (n + 1) + 8 * k + 2)[0]
        if fc & 0x40000000:   # 8-bit (cp1252) piece
            off = (fc & 0x3FFFFFFF) // 2
            out.append(wd[off:off + (end - start)].decode("cp1252", "replace"))
        else:                 # UTF-16LE piece
            out.append(wd[fc:fc + 2 * (end - start)].decode("utf-16-le", "replace"))
    text = "".join(out)
    text = re.sub("\x13[^\x14\x15]*\x14?", "", text).replace("\x15", "")   # field codes: keep displayed result
    text = text.replace("\x07", "\t").replace("\r", "\n").replace("\x0b", "\n").replace("\x0c", "\n")
    return re.sub(r"[\x00-\x08\x0e-\x1f]", "", text)


def _ole_dates(data: bytes):
    try:
        import olefile
        m = olefile.OleFileIO(io.BytesIO(data)).get_metadata()

        def f(d):
            return d.date() if d and dt.date(1990, 1, 1) <= d.date() <= dt.date.today() else None
        return f(m.last_saved_time), f(m.create_time)
    except Exception:
        return None, None


def _doc_scan(data: bytes) -> str:
    """Last resort: pull runs of UTF-16LE / 8-bit text out of the binary."""
    u16 = re.findall(rb"(?:[\x20-\x7e\x0d\x09]\x00|[\xa0-\xff]\x00){20,}", data)
    runs = [r.decode("utf-16-le", "ignore") for r in u16]
    if sum(map(len, runs)) < 200:
        runs = [r.decode("cp1252", "ignore") for r in re.findall(rb"[\x20-\x7e\x0d\x09\x92-\x97\xa0-\xff]{20,}", data)]
    text = "\n".join(runs).replace("\r", "\n")
    lines = [l for l in text.split("\n") if sum(ch.isalpha() or ch == " " for ch in l) > 0.8 * max(len(l), 1)]
    return "\n".join(lines)
