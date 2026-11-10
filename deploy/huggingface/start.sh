#!/usr/bin/env bash
set -euo pipefail

redis-server --port 6379 --bind 127.0.0.1 --dir /tmp --save "" --appendonly no \
    --pidfile /tmp/redis.pid --daemonize yes

python manage.py migrate --noinput

# Keep the worker alive: if it ever dies, start it again.
(
    while true; do
        celery -A config worker -B --loglevel=info --concurrency=2 \
            --max-tasks-per-child=50 --schedule=/tmp/celerybeat-schedule || true
        echo "Celery worker stopped; restarting in 5 seconds" >&2
        sleep 5
    done
) &

exec gunicorn config.wsgi:application --bind 0.0.0.0:7860 --workers 3 --timeout 180
