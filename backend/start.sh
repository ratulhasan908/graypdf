#!/usr/bin/env bash
# Entry point for the single-container image (deploy/single/Dockerfile).
# Small hosts set WEB_CONCURRENCY=1 and CELERY_POOL=solo to fit in 512 MB.
set -euo pipefail

redis-server --port 6379 --bind 127.0.0.1 --dir /tmp --save "" --appendonly no \
    --maxmemory 32mb --pidfile /tmp/redis.pid --daemonize yes

python manage.py migrate --noinput

# Keep the worker alive: if it ever dies (say, out of memory), start it again.
(
    while true; do
        celery -A config worker -B --loglevel=info \
            --pool="${CELERY_POOL:-prefork}" --concurrency="${CELERY_CONCURRENCY:-2}" \
            --max-tasks-per-child=20 --schedule=/tmp/celerybeat-schedule || true
        echo "Celery worker stopped; restarting in 5 seconds" >&2
        sleep 5
    done
) &

# The access log shows the X-Forwarded-For chain, which is what
# TRUSTED_PROXY_COUNT has to match so guest limits count visitors.
exec gunicorn config.wsgi:application \
    --bind "0.0.0.0:${PORT:-10000}" \
    --workers "${WEB_CONCURRENCY:-3}" \
    --timeout 180 \
    --access-logfile - \
    --access-logformat '%(h)s xff="%({x-forwarded-for}i)s" "%(r)s" %(s)s %(b)s %(M)sms'
