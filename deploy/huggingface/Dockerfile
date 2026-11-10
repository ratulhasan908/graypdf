# GreyPDF API as a Hugging Face Docker Space: one container runs Redis, the
# Celery worker (with the cleanup scheduler) and gunicorn. The database is
# outside, on Neon. Built by deploy/huggingface/push.sh with backend/ as context.
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

# Spaces run the container as uid 1000.
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
EXPOSE 7860
CMD ["bash", "start.sh"]
