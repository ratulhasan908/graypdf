FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Ghostscript: Compress, Repair, OCR. LibreOffice: Office to PDF.
# Tesseract: OCR. The fonts decide how converted documents look: Liberation,
# Carlito and Caladea match the metrics of Arial, Calibri and Cambria, so pages
# break where they do in Office, and Noto covers Bangla and other scripts.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ghostscript \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-writer \
        fonts-crosextra-caladea \
        fonts-crosextra-carlito \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-noto-core \
        pngquant \
        tesseract-ocr \
        tesseract-ocr-ara \
        tesseract-ocr-ben \
        tesseract-ocr-chi-sim \
        tesseract-ocr-deu \
        tesseract-ocr-eng \
        tesseract-ocr-fra \
        tesseract-ocr-hin \
        tesseract-ocr-ita \
        tesseract-ocr-por \
        tesseract-ocr-rus \
        tesseract-ocr-spa \
        tesseract-ocr-urd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Admin CSS/JS, served by WhiteNoise. The key is a throwaway: collectstatic
# only needs settings to load.
RUN SECRET_KEY=collectstatic-only python manage.py collectstatic --noinput

RUN useradd --create-home --uid 10001 greypdf \
    && mkdir -p /app/media/uploads /app/media/outputs \
    && chown -R greypdf:greypdf /app/media

USER greypdf

EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120"]
