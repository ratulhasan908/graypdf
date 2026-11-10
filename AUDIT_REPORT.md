# GreyPDF Application Audit and Remediation

**Audit date:** 2026-11-03  
**Remediation status:** Code findings addressed; deployment steps and runtime integration checks remain.  
**Scope:** Frontend routes and shared client code, Django API/authentication, all PDF task implementations, configuration, and available automated checks.

## Summary

The audit found processing failures across many PDF tools, broken PDF-to-JPG packaging and retention cleanup, unenforced upload limits, inconsistent usage accounting, incomplete processing caps, and gaps in registration and refresh-token policy. These code issues have been addressed. A follow-up PDF-to-HTML fix generates semantic, flow-based HTML with embedded CSS by default, with a separate option to approximate page layout. Frontend lint and backend checks/tests pass.

## Findings and remediation

### 1. PDF task completion timestamps — High — Fixed

Fourteen Celery tasks used `datetime.now()` without importing `datetime`. They wrote output and then failed before marking the job complete. All task completion timestamps now use Django's timezone-aware `timezone.now()`.

### 2. PDF-to-JPG ZIP creation — High — Fixed

The ZIP writer previously ran after its temporary directory had been removed. ZIP creation now occurs while generated JPGs still exist. A task regression test verifies a completed job and a readable page image in its archive.

### 3. Scheduled file retention — High — Fixed

Cleanup previously referenced an undefined `datetime` name. It now compares file modification timestamps with the timezone-aware retention cutoff and is tested against expired and recent files.

### 4. File upload size enforcement — High — Fixed in application

Every file-upload endpoint now enforces a **50 MiB per-file** cap and a **200 MiB combined-upload** cap before quota use or processing. Responses use HTTP 413. Django's file-memory threshold is not treated as a size limit.

**Deployment follow-up:** Configure the reverse proxy/load balancer with a compatible request-body cap so oversized requests are rejected before reaching Django.

### 5. PDF page and output-size guards — Medium — Fixed

The shared page-count guard now handles both pypdf readers and PyMuPDF documents. PDF inputs and generated PDFs are checked against the configured page limit; image-to-PDF checks image count as output pages. All 16 task outputs are checked against the output-size cap, including HTML, Markdown, ZIPs, and generated PDFs. Boundary tests verify page and output-size rejection.

### 6. Per-file daily quotas and product messaging — Medium — Fixed

Authenticated daily usage is now **20 files** (matching the UI) and guest usage remains **5 files**. Multi-file merge, image-to-PDF, and crop requests are charged by uploaded-file count; other file tools charge one per uploaded file. Guest increments are atomic and do not partially charge rejected batches. Rate-limit infrastructure failures now return HTTP 503 rather than allowing unlimited processing.

Text-only conversion endpoints continue to consume one usage unit per conversion job.

### 7. HTML-to-PDF network access — Medium — Reassessed

The installed IronPress renderer documents that HTML sanitization is enabled by default and remote HTTP resources are not available. The former regex URL/tag filter was removed because it was not a reliable network boundary and could reject harmless text. The renderer's no-network behavior is the relevant protection.

**Follow-up:** Reassess this boundary if the rendering library or its configuration changes.

### 8. Refresh-token revocation — Medium — Fixed in code

The SimpleJWT token blacklist app is now installed and `BLACKLIST_AFTER_ROTATION` is enabled. The custom refresh endpoint blacklists the consumed refresh token; a regression test verifies the endpoint calls revocation and issues the replacement cookie.

**Deployment follow-up:** Run Django migrations so the token blacklist tables exist before deploying the refresh flow.

### 9. Registration password policy — Medium — Fixed

Registration now calls Django's configured `validate_password()` validators with the submitted user attributes. A regression test verifies weak/common passwords are rejected.

### 10. Frontend lint failures — Medium — Fixed

Unsafe `any` error handling and icon types were replaced with explicit types; the dynamic home-page card no longer needs an unsafe prop cast. The navbar hydration workaround that triggered a React lint error was removed, dashboard effect dependencies were stabilized, and the reported unused imports and unescaped apostrophe were fixed.

### 11. Guest rate-limit behavior during Redis outage — Additional issue fixed

The previous implementation failed open when Redis was unavailable. Guest processing and guest-usage reads now raise a logged HTTP 503, preventing quota bypass and making the dependency failure explicit. A regression test covers the failure mode.

### 12. PDF-to-HTML output document — Fixed

The preserve-layout conversion previously returned page-level HTML fragments instead of a complete document. Both layout modes now produce a standalone HTML template with embedded CSS. The default clean layout infers headings from PDF typography, rebuilds paragraphs and bullet lists in responsive document flow, and embeds supported images. The optional preserve layout positions extracted text and supported images to approximate the source page. The download endpoint sends an `.html` attachment with an HTML content type. Regression tests verify semantic document structure, escaping, output extension, and download headers.

## Validation results

| Check | Result |
|---|---|
| Django system check | **Passed** |
| Backend API test suite | **Passed: 15 tests** |
| Django migration-state check (`makemigrations --check --dry-run`) | **Passed; no project model migrations needed** |
| Frontend ESLint | **Passed** |
| Next.js production build | **Passed; all app routes generated** |

Task regressions exercise cleanup, PDF-to-JPG, HTML-to-PDF, PDF-to-HTML, output/page limits, upload limits, guest/authenticated quota behavior, password validation, and refresh-token revocation. The test environment skips database setup for these tests; refresh/database behaviors are mocked where appropriate.

## Remaining production checks

1. Apply migrations in each deployed environment before enabling refresh-token blacklist checks.
2. Verify Redis, Celery workers/beat, reverse-proxy body limits, and Ghostscript availability in the deployment environment.
3. Restart Celery workers after deploying task changes so they load the current PDF-to-HTML generator.
4. Run end-to-end processing checks against the deployed database, broker, worker, and storage. These external services were not exercised in this workspace audit.
