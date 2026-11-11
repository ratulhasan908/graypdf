"""
Fonts for the PDF editor.

Retyped text should look like the text around it, so it is written with the
PDF's own font. Embedded fonts are usually subsets with no character map, so
they can't be used as they are. This module:

* rebuilds each embedded font (TrueType, OpenType, CFF or Type 1) as a clean
  OpenType font whose character map comes from the document's own text, so
  browsers can show it while editing and the PDF writer can use it, and
* finds the complete family for characters the subset doesn't contain: the
  same family from Google Fonts when it is published there, otherwise a
  metric-compatible clone (Carlito for Calibri, Arimo for Arial...), so new
  characters match the old ones in size and spacing.
"""

import io
import logging
import re
import tempfile
from pathlib import Path

import pymupdf
from django.conf import settings

logger = logging.getLogger(__name__)

SUBSET_PREFIX_RE = re.compile(r"^[A-Z]{6}\+")
FAMILY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$")
GOOGLE_CSS = "https://fonts.googleapis.com/css2"
GOOGLE_FILE_RE = re.compile(r"url\((https://fonts\.gstatic\.com/s/[a-z0-9]+/[^)\s]+\.ttf)\)")
MAX_FONT_BYTES = 15 * 1024 * 1024

WEIGHTS = [
    (("thin", "hairline"), 100),
    (("extralight", "ultralight"), 200),
    (("light",), 300),
    (("medium",), 500),
    (("semibold", "demibold", "demi"), 600),
    (("extrabold", "ultrabold", "heavy"), 800),
    (("black",), 900),
    (("bold",), 700),
]
STYLE_WORDS = {
    "regular", "normal", "book", "italic", "oblique", "it", "mt", "ps", "psmt",
    "thin", "hairline", "extralight", "ultralight", "light", "medium", "semibold", "demibold",
    "demi", "bold", "extrabold", "ultrabold", "heavy", "black", "bolditalic", "boldit",
}

# Fonts that aren't on Google Fonts, and the free family closest to each.
# The first five are metric-compatible: same widths, so lines keep their length.
SUBSTITUTES = {
    "calibri": "Carlito",
    "cambria": "Caladea",
    "arial": "Arimo",
    "helvetica": "Arimo",
    "helvetica neue": "Arimo",
    "liberation sans": "Arimo",
    "nimbus sans": "Arimo",
    "times new roman": "Tinos",
    "times": "Tinos",
    "liberation serif": "Tinos",
    "nimbus roman": "Tinos",
    "courier new": "Cousine",
    "courier": "Cousine",
    "liberation mono": "Cousine",
    "nimbus mono ps": "Cousine",
    "georgia": "Gelasio",
    "segoe ui": "Open Sans",
    "verdana": "PT Sans",
    "tahoma": "PT Sans",
    "trebuchet ms": "Fira Sans",
    "arial narrow": "Archivo Narrow",
    "century gothic": "Questrial",
    "garamond": "EB Garamond",
    "book antiqua": "Libre Baskerville",
    "palatino linotype": "Libre Baskerville",
    "consolas": "Inconsolata",
    "comic sans ms": "Comic Neue",
    # Bangla fonts common in Bangladeshi documents, none of them on Google Fonts.
    "nirmala ui": "Noto Sans Bengali",
    "vrinda": "Noto Sans Bengali",
    "solaimanlipi": "Noto Sans Bengali",
    "solaiman lipi": "Noto Sans Bengali",
    "kalpurush": "Noto Sans Bengali",
    "siyam rupali": "Noto Sans Bengali",
    "nikosh": "Noto Sans Bengali",
    "nikosh ban": "Noto Sans Bengali",
    "shonar bangla": "Noto Serif Bengali",
    "mukti": "Noto Sans Bengali",
    "adorsho lipi": "Noto Sans Bengali",
    "symbol": "",
    "zapf dingbats": "",
    "wingdings": "",
}
GENERIC = {"sans": "Arimo", "serif": "Tinos", "mono": "Cousine"}

# Scripts whose letters change shape with their neighbours. Their glyphs in an
# embedded subset can't be reused one by one, so they always come from a
# complete font that shapes them properly: (first, last, sans family, serif family).
COMPLEX_SCRIPTS = [
    (0x0980, 0x09FF, "Noto Sans Bengali", "Noto Serif Bengali"),
    (0x0900, 0x097F, "Noto Sans Devanagari", "Noto Serif Devanagari"),
    (0x0A00, 0x0A7F, "Noto Sans Gurmukhi", "Noto Serif Gurmukhi"),
    (0x0A80, 0x0AFF, "Noto Sans Gujarati", "Noto Serif Gujarati"),
    (0x0B00, 0x0B7F, "Noto Sans Oriya", "Noto Sans Oriya"),
    (0x0B80, 0x0BFF, "Noto Sans Tamil", "Noto Serif Tamil"),
    (0x0C00, 0x0C7F, "Noto Sans Telugu", "Noto Serif Telugu"),
    (0x0C80, 0x0CFF, "Noto Sans Kannada", "Noto Serif Kannada"),
    (0x0D00, 0x0D7F, "Noto Sans Malayalam", "Noto Serif Malayalam"),
    (0x0D80, 0x0DFF, "Noto Sans Sinhala", "Noto Serif Sinhala"),
    (0x0600, 0x06FF, "Noto Naskh Arabic", "Noto Naskh Arabic"),
    (0x0750, 0x077F, "Noto Naskh Arabic", "Noto Naskh Arabic"),
    (0x0E00, 0x0E7F, "Noto Sans Thai", "Noto Serif Thai"),
    (0x1000, 0x109F, "Noto Sans Myanmar", "Noto Serif Myanmar"),
    (0x1780, 0x17FF, "Noto Sans Khmer", "Noto Serif Khmer"),
]


def is_complex(codepoint):
    return any(first <= codepoint <= last for first, last, *_ in COMPLEX_SCRIPTS)


def script_families(text, generic="sans"):
    """The complete fonts the scripts in `text` need, in order of appearance."""
    families = []
    for char in text:
        for first, last, sans, serif in COMPLEX_SCRIPTS:
            if first <= ord(char) <= last:
                family = serif if generic == "serif" else sans
                if family not in families:
                    families.append(family)
    return families

# The same designs ship with Linux (and in our Docker image), so the common
# substitutes work even when Google Fonts can't be reached.
LOCAL_FILES = {
    "Arimo": "LiberationSans",
    "Tinos": "LiberationSerif",
    "Cousine": "LiberationMono",
    "Carlito": "Carlito",
    "Caladea": "Caladea",
}
FONT_DIRS = ("/usr/share/fonts", "/usr/local/share/fonts")


# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------

def strip_subset(name):
    return SUBSET_PREFIX_RE.sub("", name or "")


def name_key(name):
    """Compare font names however they were spelt: 'URW Bookman Light' == 'URWBookman-Light'."""
    return re.sub(r"[^a-z0-9]", "", strip_subset(name).lower())


def parse_font_name(name):
    """
    'ABCDEF+TimesNewRomanPS-BoldItalicMT' -> ('Times New Roman', 700, True).
    Good enough to pick a family and style; never raises.
    """
    base = strip_subset(name)
    lowered = base.lower().replace(" ", "")
    italic = any(word in lowered for word in ("italic", "oblique")) or bool(re.search(r"[-,](bold)?it$", lowered))
    weight = 400
    for words, value in WEIGHTS:
        if any(word in lowered for word in words):
            weight = value
            break

    family = re.split(r"[-,]", base, maxsplit=1)[0]
    family = re.sub(r"(PSMT|PS|MT)$", "", family)
    family = re.sub(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", family)
    words = [word for word in family.split() if word.lower() not in STYLE_WORDS]
    family = " ".join(words).strip() or base
    return family, weight, italic


def generic_kind(name, flags=0):
    lowered = strip_subset(name).lower()
    if flags & 8 or any(hint in lowered for hint in ("courier", "mono", "consol", "code")):
        return "mono"
    if any(hint in lowered for hint in ("sans", "arial", "helvetica", "calibri", "verdana", "segoe", "roboto", "tahoma", "gothic", "nirmala", "vrinda", "lipi", "kalpurush", "nikosh", "rupali")):
        return "sans"
    if flags & 4 or any(hint in lowered for hint in ("times", "serif", "roman", "georgia", "garamond", "cambria", "minion", "palatino", "book", "c059")):
        return "serif"
    return "sans"


# ---------------------------------------------------------------------------
# Embedded fonts -> usable OpenType fonts
# ---------------------------------------------------------------------------

def page_font_refs(page):
    """{normalised font name: xref} for the fonts this page uses."""
    refs = {}
    for xref, _ext, _type, basefont, refname, *_ in page.get_fonts(full=True):
        refs.setdefault(name_key(basefont), xref)
        refs.setdefault(name_key(refname), xref)
    return refs


def char_map(doc, xref, pages=None):
    """
    Character -> glyph id for one embedded font, read from the text the
    document draws with it. Only glyphs the document really uses are mapped:
    the rest of a subset is usually empty.
    """
    found = {}
    for page in (doc[number] for number in pages) if pages is not None else doc:
        refs = page_font_refs(page)
        if xref not in refs.values():
            continue
        for span in page.get_texttrace():
            if refs.get(name_key(span["font"])) != xref:
                continue
            for unicode, gid, *_ in span["chars"]:
                if gid > 0 and 32 <= unicode != 0xFFFD and not 0xE000 <= unicode <= 0xF8FF and not is_complex(unicode):
                    found.setdefault(unicode, set()).add(gid)
    # A ligature glyph shows up under each of its letters; leave those out.
    by_glyph = {}
    for unicode, gids in found.items():
        for gid in gids:
            by_glyph.setdefault(gid, set()).add(unicode)
    mapping = {}
    for unicode, gids in found.items():
        gid = min(gids)
        if len(by_glyph[gid]) == 1 or unicode == min(by_glyph[gid]):
            mapping[unicode] = gid
    if 0x20 not in mapping and 0xA0 in mapping:
        mapping[0x20] = mapping[0xA0]
    return mapping


def _space_glyph(advances, outlines, upm):
    """Spaces are rarely drawn, so guess: an early empty glyph about a quarter em wide."""
    for gid in range(1, min(len(advances), 20)):
        if not outlines[gid] and 0.15 * upm <= advances[gid] <= 0.4 * upm:
            return gid
    return None


def _build_otf(count, draw, mapping, metrics, name):
    """
    An OpenType (CFF) font from another font's outlines. `draw(gid, pen)` draws
    one glyph in 1000 units per em and returns its advance width. Only glyphs
    the character map uses are copied, which keeps big Type 1 fonts quick.
    """
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.recordingPen import RecordingPen
    from fontTools.pens.t2CharStringPen import T2CharStringPen

    upm = 1000
    builder = FontBuilder(upm, isTTF=False)
    names = [".notdef"] + [f"g{gid}" for gid in range(1, count)]
    builder.setupGlyphOrder(names)
    # The first glyphs are drawn too, to find an undrawn space glyph.
    wanted = {0, *range(min(count, 20)), *(gid for gid in mapping.values() if gid < count)}
    charstrings, hmtx, advances, outlines = {}, {}, [0] * count, [False] * count
    for gid, glyph in enumerate(names):
        recording, width = RecordingPen(), 0
        if gid in wanted:
            try:
                width = draw(gid, recording) or 0
            except Exception:
                recording = RecordingPen()
        bounds = BoundsPen(None)
        recording.replay(bounds)
        pen = T2CharStringPen(round(width), None)
        recording.replay(pen)
        charstrings[glyph] = pen.getCharString()
        hmtx[glyph] = (round(width), round(bounds.bounds[0]) if bounds.bounds else 0)
        advances[gid], outlines[gid] = width, bool(bounds.bounds)
    if 0x20 not in mapping:
        space = _space_glyph(advances, outlines, upm)
        if space:
            mapping = {**mapping, 0x20: space}
    ps_name = re.sub(r"[^A-Za-z0-9-]", "", name)[:60] or "EditFont"
    builder.setupCFF(ps_name, {"FullName": ps_name}, charstrings, {})
    builder.setupHorizontalMetrics(hmtx)
    builder.setupHorizontalHeader(ascent=metrics["ascent"], descent=metrics["descent"])
    builder.setupNameTable({"familyName": ps_name, "styleName": "Regular"})
    builder.setupCharacterMap({unicode: names[gid] for unicode, gid in mapping.items() if gid < count})
    builder.setupOS2(
        sTypoAscender=metrics["ascent"], sTypoDescender=metrics["descent"], sTypoLineGap=0,
        usWinAscent=metrics["ascent"], usWinDescent=-metrics["descent"],
    )
    builder.setupPost()
    output = io.BytesIO()
    builder.save(output)
    return output.getvalue()


def _metrics(buffer):
    font = pymupdf.Font(fontbuffer=buffer)
    return {"ascent": round(font.ascender * 1000), "descent": round(font.descender * 1000)}


def _from_sfnt(buffer, mapping):
    """TrueType or OpenType: keep the outlines, add the tables a subset dropped."""
    from fontTools.ttLib import TTFont, newTable
    from fontTools.ttLib.tables._c_m_a_p import cmap_format_4, cmap_format_12

    font = TTFont(io.BytesIO(buffer))
    order = font.getGlyphOrder()
    if 0x20 not in mapping and "glyf" in font and "hmtx" in font:
        glyf, hmtx = font["glyf"], font["hmtx"]
        outlines = [glyf[name].numberOfContours != 0 for name in order[:20]]
        advances = [hmtx[name][0] for name in order[:20]]
        space = _space_glyph(advances, outlines, font["head"].unitsPerEm)
        if space:
            mapping = {**mapping, 0x20: space}

    table = newTable("cmap")
    table.tableVersion = 0
    table.tables = []
    for subtable, encoding in ((cmap_format_4(4), 1), (cmap_format_12(12), 10)):
        subtable.platformID, subtable.platEncID, subtable.language = 3, encoding, 0
        if subtable.format == 12:
            subtable.reserved = subtable.length = subtable.nGroups = 0
        subtable.cmap = {
            unicode: order[gid]
            for unicode, gid in mapping.items()
            if gid < len(order) and (subtable.format == 12 or unicode <= 0xFFFF)
        }
        table.tables.append(subtable)
    font["cmap"] = table

    if "post" not in font:
        post = newTable("post")
        post.formatType = 3.0
        post.italicAngle = 0
        post.underlinePosition, post.underlineThickness = -100, 50
        post.isFixedPitch = 0
        post.minMemType42 = post.maxMemType42 = post.minMemType1 = post.maxMemType1 = 0
        font["post"] = post
    if "name" not in font or "OS/2" not in font:
        # Browsers refuse fonts without these; rebuilding is the simplest fix.
        from fontTools.fontBuilder import FontBuilder

        builder = FontBuilder(font=font)
        if "name" not in font:
            builder.setupNameTable({"familyName": "EditFont", "styleName": "Regular"})
        if "OS/2" not in font:
            builder.setupOS2()
    # Hinting programs from a subset sometimes upset browsers; outlines are all we need.
    for tag in ("fpgm", "prep", "cvt ", "hdmx", "VDMX", "LTSH", "kern"):
        if tag in font:
            del font[tag]
    output = io.BytesIO()
    font.save(output)
    return output.getvalue()


def _from_cff(buffer, mapping, name):
    from fontTools.cffLib import CFFFontSet
    from fontTools.pens.transformPen import TransformPen

    cff = CFFFontSet()
    cff.decompile(io.BytesIO(buffer), None)
    top = cff[cff.fontNames[0]]
    order = list(top.charset)
    matrix = getattr(top, "FontMatrix", [0.001, 0, 0, 0.001, 0, 0])
    scale = [value * 1000 for value in matrix]
    glyphs = top.CharStrings

    def draw(gid, pen):
        glyph = glyphs[order[gid]]
        glyph.draw(TransformPen(pen, scale))
        return glyph.width * scale[0]

    return _build_otf(len(order), draw, mapping, _metrics(buffer), name)


def _from_type1(buffer, mapping, name):
    from fontTools.pens.transformPen import TransformPen
    from fontTools.t1Lib import T1Font

    with tempfile.NamedTemporaryFile(suffix=".pfa", delete=False) as handle:
        handle.write(buffer)
        path = handle.name
    try:
        t1 = T1Font(path)
        t1.parse()
    finally:
        Path(path).unlink(missing_ok=True)
    glyphs = t1.font["CharStrings"]
    order = list(glyphs.keys())
    # FreeType, which reports the glyph ids, puts .notdef first by swapping.
    if ".notdef" in order and order[0] != ".notdef":
        index = order.index(".notdef")
        order[0], order[index] = order[index], order[0]
    scale = [value * 1000 for value in t1.font.get("FontMatrix", [0.001, 0, 0, 0.001, 0, 0])]

    def draw(gid, pen):
        glyph = glyphs[order[gid]]
        glyph.draw(TransformPen(pen, scale))
        return glyph.width * scale[0]

    return _build_otf(len(order), draw, mapping, _metrics(buffer), name)


def editable_font(doc, xref, pages=None):
    """
    The embedded font at `xref` as an OpenType font with a real character map,
    or None when it isn't embedded or can't be converted.
    """
    try:
        name, ext, _subtype, buffer = doc.extract_font(xref)
    except Exception:
        return None
    if not buffer or ext not in ("ttf", "otf", "cff", "cid", "pfa", "pfb"):
        return None
    mapping = char_map(doc, xref, pages)
    if not mapping:
        return None
    try:
        if ext in ("ttf", "otf"):
            return _from_sfnt(buffer, mapping)
        if ext in ("cff", "cid"):
            return _from_cff(buffer, mapping, strip_subset(name))
        return _from_type1(buffer, mapping, strip_subset(name))
    except Exception:
        logger.warning("Could not rebuild embedded font %s (%s)", name, ext, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Complete families, for characters a subset doesn't have
# ---------------------------------------------------------------------------

def _cache_dir():
    folder = Path(settings.MEDIA_ROOT) / "font-cache"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _local_file(family, weight, italic):
    stem = LOCAL_FILES.get(family)
    if not stem:
        return None
    style = ("Bold" if weight >= 600 else "") + ("Italic" if italic else "") or "Regular"
    for folder in FONT_DIRS:
        for path in Path(folder).rglob(f"{stem}-{style}.ttf") if Path(folder).exists() else []:
            return path.read_bytes()
    return None


def _download(family, weight, italic):
    """A static TTF of one style of a Google Fonts family, or None."""
    if not getattr(settings, "EDIT_FONT_DOWNLOADS", True):
        return None
    import requests

    for wanted in dict.fromkeys((weight, 700 if weight >= 600 else 400, 400)):
        axis = f"ital,wght@{int(italic)},{wanted}"
        try:
            response = requests.get(GOOGLE_CSS, params={"family": f"{family}:{axis}"}, timeout=8)
        except requests.RequestException:
            return None
        if response.status_code != 200:
            continue
        match = GOOGLE_FILE_RE.search(response.text)
        if not match:
            return None  # Google answered with a stand-in, not this family
        try:
            font = requests.get(match.group(1), timeout=15)
        except requests.RequestException:
            return None
        if font.ok and 0 < len(font.content) <= MAX_FONT_BYTES:
            return font.content
    return None


def _style_file(family, weight, italic):
    """One style of a family, from the cache, the system or Google Fonts."""
    path = _cache_dir() / f"{family.replace(' ', '_')}-{weight}-{int(italic)}.ttf"
    missing = path.with_suffix(".missing")
    if path.exists():
        return path.read_bytes()
    if missing.exists():
        return None
    data = _local_file(family, weight, italic) or _download(family, weight, italic)
    if data:
        path.write_bytes(data)
    else:
        missing.write_bytes(b"")
    return data


def family_font(family, weight=400, italic=False, generic="sans"):
    """
    (font bytes, family used) for the closest complete font to `family`:
    the family itself, then its metric-compatible clone, then a generic one.
    Returns (None, None) when nothing is available offline.
    """
    weight = min(max(int(weight) // 100 * 100, 100), 900)
    candidates = []
    if family and FAMILY_RE.match(family):
        substitute = SUBSTITUTES.get(family.lower())
        if substitute is None:
            candidates.append(family)
        elif substitute:
            candidates.append(substitute)
    candidates.append(GENERIC.get(generic, "Arimo"))
    for candidate in dict.fromkeys(candidates):
        data = _style_file(candidate, weight, bool(italic))
        if data:
            return data, candidate
    return None, None


# ---------------------------------------------------------------------------
# Writing text with a chain of fonts
# ---------------------------------------------------------------------------

def coverage(font_bytes):
    """The characters a font can draw."""
    from fontTools.ttLib import TTFont

    try:
        return set(TTFont(io.BytesIO(font_bytes), lazy=True).getBestCmap() or {})
    except Exception:
        return set()


def runs_html(text, faces):
    """
    HTML for `text` where each character uses the first face that has it, the
    way a browser falls back through `font-family`. MuPDF's layout engine
    only falls back to its own Noto fonts, so the PDF needs the runs spelled
    out to match what the editor showed. `faces` is [(css family, characters)];
    characters no face has are left to the generic family of the container.
    Combining marks stay with their base letter so scripts like Bangla shape.
    """
    import html
    import unicodedata

    parts, run, family = [], [], None

    def flush():
        if not run:
            return
        chunk = html.escape("".join(run))
        chunk = re.sub(r" {2,}", lambda match: "&nbsp;" * len(match.group()), chunk)
        parts.append(f'<span style="font-family: {family}">{chunk}</span>' if family else chunk)
        run.clear()

    for char in text:
        if char == "\n":
            flush()
            parts.append("<br>")
            continue
        joins = unicodedata.category(char) in ("Mn", "Mc", "Me") or char in "\u200c\u200d"
        wanted = family if joins and run else next((name for name, chars in faces if ord(char) in chars), None)
        if wanted != family:
            flush()
            family = wanted
        run.append(char)
    flush()
    return "".join(parts)
