"""
Office to PDF (LibreOffice) and OCR (OCRmyPDF + Tesseract).

Both run external programs on files from strangers, so each run has a time
limit, gets its whole process tree killed on timeout, and uses throwaway
working folders. Production also runs them in a worker with no internet access
(see docker-compose.yml).
"""

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

import pymupdf
from django.conf import settings

from .pdf_tools import ENCRYPTED_ERROR

ZIP_MAGIC = b"PK\x03\x04"
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

# extension -> how a real file of that type starts (None = plain text).
OFFICE_FORMATS = {
    "word": {".docx": ZIP_MAGIC, ".doc": OLE_MAGIC, ".odt": ZIP_MAGIC, ".rtf": b"{\\rtf"},
    "excel": {".xlsx": ZIP_MAGIC, ".xls": OLE_MAGIC, ".ods": ZIP_MAGIC, ".csv": None},
    "powerpoint": {".pptx": ZIP_MAGIC, ".ppt": OLE_MAGIC, ".odp": ZIP_MAGIC},
}

OCR_LANGUAGES = {
    "eng", "ben", "hin", "urd", "ara", "fra", "spa", "deu", "por", "ita", "rus", "chi_sim",
}
MAX_OCR_LANGUAGES = 3

# Never run macros, and never follow links to outside content.
LIBREOFFICE_PROFILE = """<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"
           xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Calc/Content/Update">
    <prop oor:name="Link" oor:op="fuse"><value>2</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Writer/Content/Update">
    <prop oor:name="Link" oor:op="fuse"><value>2</value></prop>
  </item>
</oor:items>
"""


def office_file_problem(kind, name, head):
    """Check an upload is what its name claims. Returns a message, or None."""
    extension = Path(name).suffix.lower()
    formats = OFFICE_FORMATS[kind]
    if extension not in formats:
        return f"Please choose a {', '.join(sorted(formats))} file."
    # Word, Excel and PowerPoint wrap password-protected files in the old format.
    if extension in (".docx", ".xlsx", ".pptx") and head.startswith(OLE_MAGIC):
        return "This file is password-protected. Remove the password in Office, then try again."
    magic = formats[extension]
    if magic is not None and not head.startswith(magic):
        return f"This doesn't look like a real {extension} file. It may be damaged."
    return None


def _run(command, timeout, **kwargs):
    """Run a program, killing it and everything it started on timeout."""
    windows = sys.platform == "win32"
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=not windows,
        **kwargs,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if windows:
            process.kill()
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise
    return process.returncode, stdout, stderr


def _search_path():
    """PATH, plus the standard install folders on a Windows dev machine."""
    folders = [os.environ.get("PATH", "")]
    if sys.platform == "win32":
        program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        folders += [
            str(program_files / "LibreOffice" / "program"),
            str(program_files / "Tesseract-OCR"),
            *sorted((str(p) for p in program_files.glob("gs/gs*/bin")), reverse=True),
        ]
    return os.pathsep.join(folders)


def _tool_env(work):
    return {**os.environ, "PATH": _search_path(), "HOME": work, "TMPDIR": work}


def _require(*names):
    for name in names:
        path = shutil.which(name, path=_search_path())
        if path:
            return path
    raise ValueError("This tool isn't available on this server right now.")


def _page_count_guard(path):
    doc = pymupdf.open(str(path))
    pages = doc.page_count
    doc.close()
    limit = settings.MAX_PDF_PAGES
    if pages == 0:
        raise ValueError("This file has nothing to convert.")
    if pages > limit:
        raise ValueError(f"The converted PDF has {pages} pages. The maximum is {limit}.")
    return pages


def office_to_pdf(inputs, output, options):
    soffice = _require("soffice", "libreoffice")
    target = "pdf"
    if options.get("one_page_per_sheet"):
        settings_json = json.dumps({"SinglePageSheets": {"type": "boolean", "value": "true"}})
        target = f"pdf:calc_pdf_Export:{settings_json}"

    with tempfile.TemporaryDirectory(prefix="greypdf-office-") as work:
        work_path = Path(work)
        profile = work_path / "profile"
        (profile / "user").mkdir(parents=True)
        (profile / "user" / "registrymodifications.xcu").write_text(
            LIBREOFFICE_PROFILE, encoding="utf-8"
        )
        result_dir = work_path / "out"
        result_dir.mkdir()

        code, _, _ = _run(
            [
                soffice,
                "--headless",
                "--norestore",
                "--nolockcheck",
                "--nodefault",
                "--nologo",
                f"-env:UserInstallation={profile.as_uri()}",
                "--convert-to",
                target,
                "--outdir",
                str(result_dir),
                str(inputs[0]),
            ],
            timeout=settings.OFFICE_TIMEOUT_SECONDS,
            env=_tool_env(work),
        )

        produced = result_dir / f"{inputs[0].stem}.pdf"
        if code != 0 or not produced.exists() or produced.stat().st_size == 0:
            raise ValueError(
                "This file couldn't be converted. It may be damaged or password-protected."
            )
        pages = _page_count_guard(produced)
        shutil.move(str(produced), str(output))
    return {"pages": pages}


def ocr(inputs, output, options):
    _require("tesseract")
    _require("gs", "gswin64c", "gswin32c")

    doc = pymupdf.open(str(inputs[0]))
    locked, pages = doc.needs_pass, doc.page_count
    doc.close()
    if locked:
        raise ValueError(ENCRYPTED_ERROR)
    if pages > settings.MAX_OCR_PAGES:
        raise ValueError(
            f"This PDF has {pages} pages. OCR works on up to {settings.MAX_OCR_PAGES} "
            "pages at a time. Use Split PDF first."
        )

    languages = [code for code in options.get("languages") or [] if code in OCR_LANGUAGES]
    if not languages:
        raise ValueError("Choose the language of your document.")

    with tempfile.TemporaryDirectory(prefix="greypdf-ocr-") as work:
        code, _, stderr = _run(
            [
                sys.executable,
                "-m",
                "ocrmypdf",
                "--language",
                "+".join(languages),
                # Tesseract's own text layer. The default (fpdf2) inserts
                # stray control characters into Bangla and other Indic text.
                "--pdf-renderer",
                "sandwich",
                "--skip-text",  # leave pages that already have text alone
                "--rotate-pages",
                "--deskew",
                "--optimize",
                "1",
                "--output-type",
                "pdf",
                "--jobs",
                str(settings.OCR_JOBS),
                "--quiet",
                str(inputs[0]),
                str(output),
            ],
            timeout=settings.OCR_TIMEOUT_SECONDS,
            env=_tool_env(work),
        )

    if code == 8:
        raise ValueError(ENCRYPTED_ERROR)
    if code == 2:
        raise ValueError("This file could not be read. It may be damaged or not a real PDF.")
    if code != 0:
        raise RuntimeError(f"OCR failed with code {code}: {stderr[-400:]!r}")

    result = pymupdf.open(str(output))
    readable = sum(1 for page in result if page.get_text().strip())
    total = result.page_count
    result.close()
    return {"pages": total, "text_pages": readable}
