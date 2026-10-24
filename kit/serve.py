#!/usr/bin/env python3
"""Static server for any page that uses Atlas, plus the one write Atlas needs.

Zero dependencies. From a project folder:
    python3 vendor/atlas/serve.py --port 8098          # localhost only
    python3 vendor/atlas/serve.py --port 8098 --lan    # phones on the wifi too

Serves the folder, never caches (edits show on reload), and accepts
POST /api/atlas/style so the layer panel can save data/map-style.json.
Writes are limited to .json files under a data/ folder inside the root.
"""
import argparse
import json
import os
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TYPES = {".mjs": "text/javascript", ".js": "text/javascript", ".geojson": "application/geo+json",
         ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"}


def make_handler(root: Path):
    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **TYPES}

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(root), **kw)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt, *args):
            if "/api/" in (self.path or "") or (args and str(args[1]).startswith(("4", "5"))):
                super().log_message(fmt, *args)

        def reply(self, code: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/api/atlas/ping":
                return self.reply(200, {"ok": True, "root": root.name})
            super().do_GET()

        def do_POST(self):
            if self.path != "/api/atlas/style":
                return self.reply(404, {"error": "not found"})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                rel = str(body["path"]).lstrip("/")
                target = (root / rel).resolve()
                if root not in target.parents or target.suffix != ".json" or "data" not in target.relative_to(root).parts[:-1]:
                    return self.reply(400, {"error": f"refusing to write {rel}: only data/*.json inside the served folder"})
                target.parent.mkdir(parents=True, exist_ok=True)
                fd, tmp = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(body["data"], f, indent="\t", ensure_ascii=False)
                    f.write("\n")
                os.replace(tmp, target)
                return self.reply(200, {"ok": True, "path": str(target.relative_to(root))})
            except (KeyError, ValueError) as e:
                return self.reply(400, {"error": str(e)})

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8102)
    ap.add_argument("--root", default=".", help="folder to serve (default: current)")
    ap.add_argument("--lan", action="store_true", help="listen on all interfaces, not just localhost")
    args = ap.parse_args()
    root = Path(args.root).resolve()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    print(f"Atlas serving {root} on http://{'localhost' if not args.lan else host}:{args.port}")
    ThreadingHTTPServer((host, args.port), make_handler(root)).serve_forever()


if __name__ == "__main__":
    main()
