"""Text extraction for uploaded documents. Only pypdf is required beyond the stdlib;
DOCX/ODT/ODP/RTF/HTML are parsed directly, legacy .doc uses LibreOffice/antiword if present
and a best-effort binary scan otherwise."""
from __future__ import annotations

import html
import io
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
TEXT_NS = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"

SUPPORTED = (".txt", ".md", ".markdown", ".text", ".csv", ".log", ".pdf", ".docx", ".docm", ".dotx",
             ".odt", ".ott", ".fodt", ".rtf", ".doc", ".html", ".htm")


class ExtractError(Exception):
    pass


def extract(filename: str, data: bytes) -> str:
    ext = os.path.splitext(filename.lower())[1]
    if ext not in SUPPORTED:
        raise ExtractError(f"Unsupported file type “{ext or filename}”.")
    try:
        if ext == ".pdf":
            text = _pdf(data)
        elif ext in (".docx", ".docm", ".dotx"):
            text = _docx(data)
        elif ext in (".odt", ".ott"):
            text = _odf(zipfile.ZipFile(io.BytesIO(data)).read("content.xml"))
        elif ext == ".fodt":
            text = _odf(data)
        elif ext == ".rtf":
            text = _rtf(_decode(data))
        elif ext == ".doc":
            text = _doc(data)
        elif ext in (".html", ".htm"):
            text = _html(_decode(data))
        else:
            text = _decode(data)
    except ExtractError:
        raise
    except Exception as e:
        raise ExtractError(f"Couldn't read this {ext[1:].upper()} file ({e.__class__.__name__}).") from e
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        raise ExtractError("No text found. Scanned PDFs/images need OCR first.")
    return text


def _decode(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _pdf(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ExtractError("This PDF is password-protected.")
    pages = [p.extract_text() or "" for p in reader.pages]
    text = "\n\n".join(pages)
    # Re-join words hyphenated across line breaks, and lines wrapped mid-sentence.
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = re.sub(r"(?<![.!?:\n])\n(?!\n|[-•*\d])", " ", text)
    return text


def _docx(data: bytes) -> str:
    z = zipfile.ZipFile(io.BytesIO(data))
    root = ET.fromstring(z.read("word/document.xml"))
    paras = []
    for p in root.iter(W + "p"):
        parts = []
        for el in p.iter():
            if el.tag == W + "t" and el.text:
                parts.append(el.text)
            elif el.tag == W + "tab":
                parts.append("\t")
            elif el.tag in (W + "br", W + "cr"):
                parts.append("\n")
        paras.append("".join(parts))
    return "\n\n".join(x for x in paras if x.strip())


def _odf(xml: bytes) -> str:
    root = ET.fromstring(xml)

    def walk(el):
        out = [el.text or ""]
        for ch in el:
            tag = ch.tag
            if tag == TEXT_NS + "s":
                out.append(" " * int(ch.get(TEXT_NS + "c", "1")))
            elif tag == TEXT_NS + "tab":
                out.append("\t")
            elif tag == TEXT_NS + "line-break":
                out.append("\n")
            elif tag in (TEXT_NS + "note", ):
                pass
            else:
                out.append(walk(ch))
            out.append(ch.tail or "")
        return "".join(out)

    paras = [walk(el) for el in root.iter() if el.tag in (TEXT_NS + "p", TEXT_NS + "h")]
    return "\n\n".join(p for p in paras if p.strip())


def _rtf(s: str) -> str:
    """Minimal RTF → text: drops destinations (fonts, styles, pictures) and control words."""
    out, stack, skip = [], [], False
    i, n = 0, len(s)
    skip_dest = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer",
                 "headerl", "headerr", "footerl", "footerr", "footnote", "themedata", "colorschememapping",
                 "latentstyles", "datastore", "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator"}
    while i < n:
        c = s[i]
        if c == "{":
            stack.append(skip); i += 1
        elif c == "}":
            skip = stack.pop() if stack else False; i += 1
        elif c == "\\":
            m = re.match(r"\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\(.)", s[i:])
            if not m:
                i += 1; continue
            i += m.end()
            if m.group(3):
                if not skip: out.append(bytes([int(m.group(3), 16)]).decode("cp1252", "replace"))
            elif m.group(4):
                ch = m.group(4)
                if ch == "*": skip = True
                elif ch in "\\{}" and not skip: out.append(ch)
                elif ch == "~" and not skip: out.append(" ")
            else:
                w, arg = m.group(1), m.group(2)
                if w in skip_dest: skip = True
                elif skip: pass
                elif w in ("par", "line", "sect", "page"): out.append("\n")
                elif w == "tab": out.append("\t")
                elif w == "u" and arg:
                    out.append(chr(int(arg) % 65536))
                    if i < n and s[i] == "?": i += 1
                elif w in ("emdash",): out.append("—")
                elif w in ("endash",): out.append("–")
                elif w in ("lquote", "rquote"): out.append("'")
                elif w in ("ldblquote", "rdblquote"): out.append('"')
        elif c in "\r\n":
            i += 1
        else:
            if not skip: out.append(c)
            i += 1
    return "".join(out)


def _html(s: str) -> str:
    s = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</(p|div|h\d|li|tr)>", "\n", s)
    return html.unescape(re.sub(r"<[^>]+>", " ", s))


def _doc(data: bytes) -> str:
    # Some ".doc" files are really RTF, DOCX or HTML.
    if data[:5] == b"{\\rtf":
        return _rtf(_decode(data))
    if data[:2] == b"PK":
        return _docx(data)
    if data[:200].lstrip().lower().startswith((b"<html", b"<!doctype")):
        return _html(_decode(data))

    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.doc")
        open(src, "wb").write(data)
        soffice = shutil.which("soffice") or shutil.which("libreoffice") or next(
            (p for p in (r"C:\Program Files\LibreOffice\program\soffice.exe",
                         "/Applications/LibreOffice.app/Contents/MacOS/soffice") if os.path.exists(p)), None)
        if soffice:
            subprocess.run([soffice, "--headless", "--convert-to", "txt:Text", "--outdir", tmp, src],
                           capture_output=True, timeout=60)
            out = os.path.join(tmp, "in.txt")
            if os.path.exists(out):
                return _decode(open(out, "rb").read())
        if shutil.which("antiword"):
            r = subprocess.run(["antiword", src], capture_output=True, timeout=30)
            if r.returncode == 0:
                return _decode(r.stdout)
    return _doc_scan(data)


def _doc_scan(data: bytes) -> str:
    """Fallback for Word 97-2003: pull the longest runs of UTF-16LE / 8-bit text out of the
    binary. Works for most simple documents; install LibreOffice for full fidelity."""
    u16 = re.findall(rb"(?:[\x20-\x7e\x0d\x09]\x00|[\xa0-\xff]\x00|[\x18-\x20]\x20){20,}", data)
    runs = [r.decode("utf-16-le", "ignore") for r in u16]
    if sum(map(len, runs)) < 200:
        runs = [r.decode("cp1252", "ignore") for r in re.findall(rb"[\x20-\x7e\x0d\x09\x92-\x97\xa0-\xff]{20,}", data)]
    text = "\n".join(runs).replace("\r", "\n")
    # Drop obvious binary/font-table noise.
    lines = [l for l in text.split("\n") if sum(ch.isalpha() or ch == " " for ch in l) > 0.8 * max(len(l), 1)]
    return "\n".join(lines)
