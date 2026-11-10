# GreyPDF API in a single container: Redis, the Celery worker (with the
# cleanup scheduler) and gunicorn, started by backend/start.sh. The database
# is outside (e.g. Neon, via DATABASE_URL). Build with backend/ as the context:
#   docker build -f deploy/single/Dockerfile backend
# render.yaml uses this for Render's free plan.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        redis-server \
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

RUN useradd --create-home --uid 1000 user
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=user . .
RUN SECRET_KEY=collectstatic-only python manage.py collectstatic --noinput \
    && mkdir -p media/uploads media/outputs \
    && chown -R user:user /app

USER user
ENV HOME=/home/user
EXPOSE 10000
CMD ["bash", "start.sh"]
