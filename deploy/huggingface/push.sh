#!/usr/bin/env bash
# Publish the backend to the Hugging Face Space. Usage:
#   deploy/huggingface/push.sh <hf-username>/<space-name>
# Needs a Hugging Face login (`hf auth login`) with write access.
set -euo pipefail
space="${1:?Usage: push.sh <user>/<space>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

git -C "$root" archive HEAD backend | tar -x -C "$stage"
cp "$root"/deploy/huggingface/{Dockerfile,start.sh,README.md} "$stage/backend/"
rm -f "$stage/backend/.env" "$stage/backend/Dockerfile.dockerignore"

hf upload "$space" "$stage/backend" . --repo-type space \
    --commit-message "Deploy $(git -C "$root" rev-parse --short HEAD)"
