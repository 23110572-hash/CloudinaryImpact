from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.config import settings
from app.database import engine, Base
from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.routers import auth, settings as settings_router, media, ai, reports
from app.cloudinary_service import UPLOAD_DIR

app = FastAPI(
    title="Cloudinary Impact & Sustainability Media Platform",
    description="AI-Powered Media Intelligence platform for NGOs and Sustainability Teams",
    version="1.0.0"
)

# CORS: comma-separated list of allowed frontend origins, e.g.
#   CORS_ORIGINS=https://cloudinary-impact.vercel.app,http://localhost:3000
# CORS_ORIGIN_REGEX optionally allows Vercel preview deployments, e.g. https://cloudinary-impact-.*\.vercel\.app
_origins = [o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
    allow_credentials=False,  # auth uses Bearer tokens, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount local uploads for fallback static serving
app.mount("/static/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Include Routers
app.include_router(auth.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(reports.router, prefix="/api")

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
        "default_mode": "system_managed"
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
    "folders": {"cloudinary_path": "VARCHAR(512)"},
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
