#!/usr/bin/env bash
# Atlas on localhost:8102 (8090–8101 are taken by the other workspaces).
# --lan to open it from a phone on the wifi.
cd "$(dirname "$0")" || exit 1
exec python3 kit/serve.py --port 8102 --root . "$@"
