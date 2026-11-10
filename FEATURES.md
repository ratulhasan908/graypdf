# GreyPDF feature list

Last updated: 2026-11-08

Effort: **S** = under a day, **M** = 1 to 3 days, **L** = about a week. These are estimates. The priority order is a judgment call, not based on search data, so check it against real keyword numbers before you commit.

## Live today (30 tools)

| Group | Tools |
|---|---|
| Organize | Merge, Split, Rotate, Organize, Page Numbers, Fill PDF Form, Remove Pages, Extract Pages |
| Optimize | Compress, Crop, Repair, OCR (12 languages, including Bangla) |
| Convert | Word to PDF, Excel to PDF, PowerPoint to PDF, PDF to JPG, JPG to PDF, PDF to HTML, HTML to PDF, PDF to Markdown, Markdown to PDF, PDF to Word, PDF to Excel, PDF to PowerPoint |
| Secure | Protect, Unlock, Watermark, Sign, Redact, Compare |

## Next tools

### Priority 1: quick wins using libraries you already have

No new server software. Each one adds a task, a route and a small tool component.

| Tool | What it does | Effort |
|---|---|---|
| PDF to PNG | Same as PDF to JPG, with PNG output | S |
| WebP/HEIC to PDF | More image input types | S |
| Extract Images | Pull every image out of a PDF | S |
| PDF to Text | Plain .txt export | S |
| Text to PDF | .txt to PDF | S |
| Edit Metadata | Change title, author and keywords | S |
| Remove Metadata | Strip hidden document details | S |
| Grayscale PDF | Convert to black and white with Ghostscript | S |
| Flatten PDF | Bake in forms and annotations | S |
| Resize Pages | Change everything to A4, Letter and so on | S |
| N-up | Print several pages on one sheet | S |
| Image Watermark | Stamp a logo | M |
| Header and Footer | Text at the top or bottom of each page | M |
| Bates Numbering | Legal page stamps | S |

### Priority 2: advanced tools

| Tool | What it does | Needs | Effort |
|---|---|---|---|
| Edit PDF | Add text, shapes and images | Builds on the page previews | L |
| Create PDF Forms | Add fillable fields to a flat PDF | Builds on the page previews | L |
| Request Signatures | Email a document for others to sign | Email and tracking | L |
| Certified Digital Signatures | Certificate-based signing | Certificates, `pyhanko` | L |
| PDF/A Convert | Archive format | Ghostscript, plus a validator such as veraPDF to prove conformance | M |
| URL to PDF | Save a web page as a PDF | Chromium, with strict blocking of private network addresses | M |
| Translate PDF | Translate text in place | Paid translation API | L |
| Summarize PDF | AI summary | Paid AI API | M |

Translate and Summarize cost money per use, so they don't fit a free unlimited plan unless you cap them.

## Platform features

| Feature | Why it matters | Effort |
|---|---|---|
| More page previews | Page images now power Organize, Sign, Redact, Remove and Extract. Add them to Crop, Rotate and Split too. | S |
| Better HTML to PDF with Chromium | Adds full CSS (flexbox, grid) and Bangla and Chinese text, which are dropped today | M |
| Bangla for watermarks | Needs a bundled Bangla font and text shaping | M |
| Batch processing | Run one tool on many files, then download a ZIP | M |
| Pass a result to the next tool | "Keep going" links currently start with an empty tool | M |
| Google Drive and Dropbox | Pick files from the cloud and save back | L |
| Bangla interface | Translate the site; it's also a good way to stand out | L |
| Refund failed jobs | A damaged file currently uses one of a guest's 10 daily files | S |
| Installable web app (PWA) | Home-screen icon on phones | S |

## Before launch

### Must do

- [ ] **Licensing.** PyMuPDF and Ghostscript are AGPL. If a public website uses them, you generally have to offer your complete source code to users, or buy a commercial licence from Artifex. Decide which before launch, and get legal advice if you plan to keep the code private.
- [ ] **Password reset.** There is none today, so anyone who forgets a password is locked out for good. This needs an email provider.
- [ ] **Login rate limiting.** Nothing stops repeated password guessing.
- [ ] **Email verification.** It is turned off, so unlimited accounts can be created freely, which bypasses the guest limit.
- [ ] **Privacy Policy and Terms pages.** Required for Google AdSense and for handling user files.
- [ ] **Production setup.** Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SITE_URL`, run HTTPS, set `DEBUG=False`, match the reverse proxy's upload limit to the 200 MB app limit, and set `TRUSTED_PROXY_COUNT` so guest limits see real visitor IPs.
- [ ] **Run workers on Linux**, with Redis, Celery beat (it deletes the files), Ghostscript, LibreOffice and Tesseract. `docker-compose.yml` sets this up, with the worker cut off from the internet and limited in memory. It has not been built or tested yet: Docker can't run on the dev PC until virtualization is turned on in the BIOS and WSL is installed. Test it on the server before launch.
- [ ] **Server size.** LibreOffice and OCR need memory. Plan for at least 4 GB of RAM.

### Google sign-in

The backend has the libraries, but sign-in isn't finished. There's no button, no credentials are loaded into settings, and the login flow doesn't issue this app's session cookies yet. Effort: M.

### For Google AdSense

- [ ] Add a cookie consent banner. Google requires a certified consent tool for visitors in the EEA, UK and Switzerland.
- [ ] Add `ads.txt`.
- [ ] Keep ads away from Download and Upload buttons. Layouts that cause accidental clicks can get an account suspended.
- [ ] Add a few hundred words of useful help text and an FAQ to each tool page. Pages with little content are often refused, and this also helps search ranking.
- [ ] Keep ads off the signed-in dashboard to start with.
- [ ] Add analytics, so you can see which tools people use before building more.
