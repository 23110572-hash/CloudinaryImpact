from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import traceback

from app.config import settings
from app.database import engine, Base
from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.routers import auth, settings as settings_router, media, ai, reports, studio
from app.cloudinary_service import CloudinaryError
from app.llm_client import LLMError
from app.vision_engine import AIError

app = FastAPI(
    title="Cloudinary Impact & Sustainability Media Platform",
    description="AI-Powered Media Intelligence platform built on Cloudinary",
    version="1.0.0"
)

# CORS: comma-separated list of allowed frontend origins, e.g.
#   CORS_ORIGINS=https://cloudinary-impact.vercel.app,http://localhost:3000
# CORS_ORIGIN_REGEX optionally allows Vercel preview deployments, e.g. https://cloudinary-impact-.*\.vercel\.app
_origins = [o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]


# Unexpected server errors must still carry CORS headers, otherwise the browser hides the real
# error and reports a "network error". Registered before CORSMiddleware so CORS wraps it.
@app.middleware("http")
async def _unexpected_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": f"Server error: {type(exc).__name__}. Please try again."})


app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
    allow_credentials=False,  # auth uses Bearer tokens, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)


# AI and Cloudinary failures are shown to the user as clear errors (no silent fallbacks).
@app.exception_handler(AIError)
async def _ai_error(_: Request, exc: AIError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(CloudinaryError)
async def _cloudinary_error(_: Request, exc: CloudinaryError):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(LLMError)
async def _llm_error(_: Request, exc: LLMError):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


# Include Routers
app.include_router(auth.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(studio.router, prefix="/api")

@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "Cloudinary Impact Platform AI Backend",
        "version": settings.VERSION,
        "docs": "/docs",
        "health": "/api/health"
    }

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Cloudinary Impact Platform AI",
        "version": settings.VERSION,
    }

@app.on_event("startup")
async def on_startup():
    # Create tables. No demo users or sample data are seeded; every account is real.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
        await conn.run_sync(_remove_legacy_seeded_folders)


# Old versions auto-created these 5 folders on sign-up. Remove them if the user never used them.
_LEGACY_SEEDED = [
    ("Reforestation & Canopy", "reforestation"),
    ("Clean Water & Sanitation", "clean-water"),
    ("Solar & Renewable Energy", "solar-energy"),
    ("Ocean & Waste Cleanup", "ocean-waste"),
    ("Community Infrastructure", "infrastructure"),
]


def _remove_legacy_seeded_folders(sync_conn):
    from sqlalchemy import text
    removed = 0
    for name, slug in _LEGACY_SEEDED:
        res = sync_conn.execute(text(
            "DELETE FROM folders WHERE name = :n AND slug = :s AND cloudinary_path IS NULL "
            "AND NOT EXISTS (SELECT 1 FROM media_assets m WHERE m.folder_id = folders.id)"
        ), {"n": name, "s": slug})
        removed += res.rowcount or 0
    if removed:
        print(f"[Startup] Removed {removed} unused auto-seeded folder(s)")


# Columns added after the first release. create_all() doesn't alter existing tables, so add them here.
_NEW_COLUMNS = {
    "users": {"cloudinary_folder": "VARCHAR(255)"},
    "folders": {"cloudinary_path": "VARCHAR(512)", "ideas": "JSON", "ideas_signature": "VARCHAR(128)"},
    "impact_reports": {"kind": "VARCHAR(32)", "folder_id": "INTEGER", "payload": "JSON"},
    "media_assets": {"upload_key": "VARCHAR(64)"},
}


def _add_missing_columns(sync_conn):
    from sqlalchemy import inspect, text
    insp = inspect(sync_conn)
    for table, cols in _NEW_COLUMNS.items():
        existing = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols.items():
            if name not in existing:
                sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                print(f"[Startup] Added column {table}.{name}")
