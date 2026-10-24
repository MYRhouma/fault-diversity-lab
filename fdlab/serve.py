"""Dashboard server: the read-only run API plus the built web UI (web/dist).

Usage
-----
  python -m fdlab.serve config/demo.json                 # http://127.0.0.1:8765
  python -m fdlab.serve config/demo.json --host 0.0.0.0 --port 9000

The UI is built once with `cd web && npm ci && npm run build`. Without a build, the API still works and / says how
to build the UI. The server never writes to the run folder, so it can stay open while a run is in progress.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from fdlab import dashboard
from fdlab.generate import ROOT

WEB = ROOT / "web" / "dist"
NO_CACHE = {"Cache-Control": "no-cache"}


def create_app(config: Path) -> FastAPI:
    dashboard.configure(config)
    app = FastAPI(title="fault-diversity-lab", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.include_router(dashboard.router)

    if (WEB / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        if not (WEB / "index.html").exists():
            return PlainTextResponse("The web UI is not built yet: cd web && npm ci && npm run build\n"
                                     "The API is available under /api/run (docs: /api/docs).")
        file = (WEB / path).resolve()
        if path and file.is_file() and file.is_relative_to(WEB.resolve()):
            return FileResponse(file)
        return FileResponse(WEB / "index.html", headers=NO_CACHE)

    return app


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m fdlab.serve", description="Serve the dashboard for one run.")
    ap.add_argument("config", type=Path)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args(argv)
    import uvicorn

    print(f"dashboard for {a.config} on http://{a.host}:{a.port}")
    uvicorn.run(create_app(a.config), host=a.host, port=a.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
