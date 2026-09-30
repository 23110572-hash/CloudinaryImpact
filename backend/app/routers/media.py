import asyncio
import os
from datetime import datetime
from typing import List, Optional

import cloudinary.api
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.cloudinary_service import (
    CloudinaryError, delete_remote_asset, delivery_urls, ensure_folder, folder_segment,
    list_folder_resources, list_subfolders, slugify, upload_asset,
)
from app.database import get_db
from app.llm_client import LLMError
from app.models import AIAnalysis, Comparison, Folder, MediaAsset, User
from app.storage import StorageContext, ai_image_bytes, creds_for_url, get_storage
from app.vision_engine import AIError, VisionEngine

router = APIRouter(prefix="/media", tags=["Media Library"])

MAX_UPLOAD_BYTES = 40 * 1024 * 1024
FOLDER_COLORS = ["#0284c7", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#dc2626"]
ALLOWED_PHASES = {"before", "during", "after", "general"}


class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=500)


# --------------------------------------------------------------------------- helpers

def serialize_asset(a: MediaAsset) -> dict:
    an = a.ai_analysis
    return {
        "id": a.id,
        "original_name": a.original_name,
        "public_id": a.cloudinary_public_id,
        "secure_url": a.secure_url,
        "thumbnail_url": a.thumbnail_url or a.secure_url,
        "resource_type": a.resource_type,
        "format": a.format,
        "width": a.width,
        "height": a.height,
        "bytes": a.bytes,
        "captured_at": a.captured_at,
        "uploaded_at": a.created_at,
        "latitude": a.latitude,
        "longitude": a.longitude,
        "phase": a.phase,
        "upload_key": a.upload_key,
        "ai_status": a.ai_status if a.ai_status in ("analyzed", "failed") else "pending",
        "folder": {
            "id": a.folder.id, "name": a.folder.name, "color": a.folder.color,
            "icon": a.folder.icon, "cloudinary_path": a.folder.cloudinary_path,
        } if a.folder else None,
        "ai_analysis": {
            "summary": an.summary,
            "project_category": an.project_category,
            "activity_detected": an.activity_detected,
            "visual_signals": an.visual_signals or [],
            "environmental_metrics": an.environmental_metrics or {},
            "authenticity_score": an.authenticity_score,
            "confidence": an.confidence,
        } if an and a.ai_status == "analyzed" else None,
    }


async def _find_or_create_folder(db: AsyncSession, ctx: StorageContext, name: str, description: Optional[str] = None) -> Folder:
    clean = folder_segment(name)
    existing = (await db.execute(
        select(Folder).where(Folder.user_id == ctx.user.id, func.lower(Folder.name) == clean.lower())
    )).scalars().first()
    if existing:
        if not existing.cloudinary_path:
            existing.cloudinary_path = ctx.folder_path(existing.name)
        return existing

    count = (await db.execute(select(func.count(Folder.id)).where(Folder.user_id == ctx.user.id))).scalar() or 0
    folder = Folder(
        user_id=ctx.user.id,
        name=clean,
        slug=slugify(clean),
        description=(description or "").strip() or None,
        color=FOLDER_COLORS[count % len(FOLDER_COLORS)],
        icon="Folder",
        cloudinary_path=ctx.folder_path(clean),
    )
    db.add(folder)
    await db.flush()
    await ensure_folder(folder.cloudinary_path, ctx.creds)
    return folder


def _score(v) -> float:
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.0


def _tags(v) -> List[str]:
    items = v if isinstance(v, list) else str(v or "").split(",")
    return [str(s).strip().lower()[:60] for s in items if str(s).strip()][:12]


async def _analyze(asset: MediaAsset, ctx: StorageContext, db: AsyncSession, extra_tags: List[str]) -> None:
    """
    Sends Cloudinary's AI-ready JPG of the photo to the vision model and stores the result.
    Model output is normalized to the column types/lengths so an odd answer can't crash the request.
    Raises AIError / LLMError / CloudinaryError on failure.
    """
    image_bytes = await ai_image_bytes(asset.cloudinary_public_id, asset.secure_url, ctx)
    result = await VisionEngine.analyze_media(image_bytes, asset.original_name, ctx.settings)
    metrics = result.get("environmental_metrics")
    existing = (await db.execute(select(AIAnalysis).where(AIAnalysis.asset_id == asset.id))).scalars().first()
    row = existing or AIAnalysis(asset_id=asset.id)
    row.summary = str(result.get("summary") or "")[:2000]
    row.project_category = (str(result.get("project_category") or "").strip() or "Other")[:128]
    row.activity_detected = (str(result.get("activity_detected") or "").strip() or None)
    if row.activity_detected:
        row.activity_detected = row.activity_detected[:255]
    row.visual_signals = list(dict.fromkeys(_tags(result.get("visual_signals")) + extra_tags))
    row.environmental_metrics = {str(k)[:60]: v if isinstance(v, (int, float)) else str(v)[:120] for k, v in metrics.items()} if isinstance(metrics, dict) else {}
    row.authenticity_score = _score(result.get("authenticity_score"))
    row.confidence = _score(result.get("confidence"))
    if not existing:
        db.add(row)
    asset.ai_status = "analyzed"


async def _analyze_and_store(asset: MediaAsset, folder: Optional[Folder], ctx: StorageContext, db: AsyncSession, extra_tags: List[str]) -> Optional[str]:
    """Runs analysis and commits. Returns an error message if it failed (the photo is kept, marked failed)."""
    error = None
    try:
        await _analyze(asset, ctx, db, extra_tags)
    except (AIError, LLMError, CloudinaryError) as e:
        asset.ai_status = "failed"
        error = str(e)
    if folder is not None:
        folder.ideas_signature = None  # folder content changed: Studio ideas must be refreshed
    await db.commit()
    return error


async def load_owned_asset(db: AsyncSession, user: User, asset_id: int) -> MediaAsset:
    a = (await db.execute(
        select(MediaAsset).options(selectinload(MediaAsset.ai_analysis), selectinload(MediaAsset.folder))
        .where(MediaAsset.id == asset_id, MediaAsset.user_id == user.id)
    )).scalars().first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    return a


# --------------------------------------------------------------------------- storage info

@router.get("/storage")
async def storage_info(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ctx = await get_storage(db, user)
    return {"mode": ctx.mode, "cloud_name": ctx.creds["cloud_name"], "root_folder": ctx.root}


# --------------------------------------------------------------------------- folders

@router.get("/folders")
async def get_folders(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Folder, func.count(MediaAsset.id))
        .outerjoin(MediaAsset, Folder.id == MediaAsset.folder_id)
        .where(Folder.user_id == user.id)
        .group_by(Folder.id)
        .order_by(Folder.created_at.desc())
    )).all()
    out = []
    for f, count in rows:
        thumbs = (await db.execute(
            select(MediaAsset.thumbnail_url).where(MediaAsset.folder_id == f.id).order_by(MediaAsset.created_at.desc()).limit(4)
        )).scalars().all()
        out.append({
            "id": f.id, "name": f.name, "slug": f.slug, "description": f.description or "",
            "color": f.color, "icon": f.icon, "asset_count": count, "preview_thumbnails": list(thumbs),
            "cloudinary_path": f.cloudinary_path, "created_at": f.created_at,
        })
    return out


@router.post("/folders")
async def create_folder(req: FolderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ctx = await get_storage(db, user)
    folder = await _find_or_create_folder(db, ctx, req.name, req.description)
    await db.commit()
    return {"id": folder.id, "name": folder.name, "cloudinary_path": folder.cloudinary_path}


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    folder = (await db.execute(select(Folder).where(Folder.id == folder_id, Folder.user_id == user.id))).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    count = (await db.execute(select(func.count(MediaAsset.id)).where(MediaAsset.folder_id == folder.id))).scalar() or 0
    if count:
        raise HTTPException(status_code=400, detail="Folder isn't empty. Delete or move its media first.")
    ctx = await get_storage(db, user)
    if folder.cloudinary_path:
        try:
            await asyncio.to_thread(cloudinary.api.delete_folder, folder.cloudinary_path, **ctx.creds)
        except Exception as e:
            if "not found" not in str(e).lower() and "can't find" not in str(e).lower():
                raise CloudinaryError(f"Couldn't delete the folder in Cloudinary: {e}")
    await db.delete(folder)
    await db.commit()
    return {"status": "success"}


# --------------------------------------------------------------------------- upload

@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    folder_name: Optional[str] = Form(None),
    folder_id: Optional[int] = Form(None),
    custom_tags: Optional[str] = Form(None),
    phase: Optional[str] = Form("general"),
    upload_key: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Stores the original in Cloudinary, then runs AI analysis.
    `upload_key` (one per selected file, generated by the browser) makes retries safe: the same key never stores twice.
    If analysis fails the photo is kept (ai_status = "failed", ai_error set) so it can be retried.
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 40 MB")
    if file.content_type and not file.content_type.startswith(("image/", "video/")):
        raise HTTPException(status_code=400, detail="Only images and videos are supported")
    phase = phase if phase in ALLOWED_PHASES else "general"

    ctx = await get_storage(db, user)

    if folder_id:
        folder = (await db.execute(select(Folder).where(Folder.id == folder_id, Folder.user_id == user.id))).scalars().first()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        if not folder.cloudinary_path:
            folder.cloudinary_path = ctx.folder_path(folder.name)
    elif folder_name and folder_name.strip():
        folder = await _find_or_create_folder(db, ctx, folder_name)
    else:
        raise HTTPException(status_code=400, detail="Choose a folder for this upload")

    tags = [t.strip().lower() for t in (custom_tags or "").split(",") if t.strip()]
    key = (upload_key or "").strip()[:64] or None

    if key:
        # Retry of a file the server already stored (e.g. the browser lost the response): reuse it, never duplicate
        done = (await db.execute(
            select(MediaAsset).options(selectinload(MediaAsset.ai_analysis), selectinload(MediaAsset.folder))
            .where(MediaAsset.user_id == user.id, MediaAsset.upload_key == key)
        )).scalars().first()
        if done:
            ai_error = None
            if done.resource_type == "image" and done.ai_status != "analyzed":
                ai_error = await _analyze_and_store(done, done.folder, ctx, db, tags)
            db.expire_all()
            out = serialize_asset(await load_owned_asset(db, user, done.id))
            out["ai_error"] = ai_error
            return out

    filename = os.path.basename(file.filename or "upload.jpg")
    try:
        up = await upload_asset(content, filename, ctx.creds, folder.cloudinary_path, tags + [f"phase-{phase}"])
    except CloudinaryError:
        await db.rollback()
        raise

    asset = MediaAsset(
        user_id=user.id,
        folder_id=folder.id,
        filename=os.path.basename(up["secure_url"]),
        original_name=filename,
        cloudinary_public_id=up["public_id"],
        secure_url=up["secure_url"],
        thumbnail_url=up["thumbnail_url"],
        format=up.get("format") or "",
        resource_type=up.get("resource_type", "image"),
        bytes=up.get("bytes", len(content)),
        width=up.get("width") or 0,
        height=up.get("height") or 0,
        captured_at=up.get("captured_at"),
        latitude=up.get("latitude"),
        longitude=up.get("longitude"),
        phase=phase,
        ai_status="pending",
        upload_key=key,
    )
    db.add(asset)
    await db.flush()
    folder.ideas_signature = None  # folder content changed: Studio ideas must be refreshed
    await db.commit()  # the photo is safely recorded before the (slower) AI step

    ai_error = None
    if asset.resource_type == "image":
        ai_error = await _analyze_and_store(asset, folder, ctx, db, tags)

    db.expire_all()
    out = serialize_asset(await load_owned_asset(db, user, asset.id))
    out["ai_error"] = ai_error
    return out


# --------------------------------------------------------------------------- list / detail / delete

@router.get("")
async def list_media(
    folder_id: Optional[int] = Query(None),
    phase: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(MediaAsset)
        .options(selectinload(MediaAsset.ai_analysis), selectinload(MediaAsset.folder))
        .where(MediaAsset.user_id == user.id)
        .order_by(MediaAsset.created_at.desc())
    )
    if folder_id:
        stmt = stmt.where(MediaAsset.folder_id == folder_id)
    if phase and phase != "all":
        stmt = stmt.where(MediaAsset.phase == phase)
    assets = (await db.execute(stmt)).scalars().all()

    out = []
    q = (search or "").lower().strip()
    for a in assets:
        if q:
            an = a.ai_analysis
            hay = " ".join(filter(None, [
                a.original_name, a.folder.name if a.folder else "",
                an.summary if an else "", an.project_category if an else "",
                " ".join(an.visual_signals or []) if an else "",
            ])).lower()
            if q not in hay:
                continue
        out.append(serialize_asset(a))
    return out


@router.post("/{asset_id}/analyze")
async def analyze_asset(asset_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """(Re)runs AI analysis on an asset, e.g. after a failed analysis or for synced assets."""
    asset = await load_owned_asset(db, user, asset_id)
    if asset.resource_type != "image":
        raise HTTPException(status_code=400, detail="Only photos can be analyzed.")
    ctx = await get_storage(db, user)
    error = await _analyze_and_store(asset, asset.folder, ctx, db, [])
    if error:
        raise HTTPException(status_code=503, detail=error)
    db.expire_all()
    return serialize_asset(await load_owned_asset(db, user, asset_id))


class UploadStatusRequest(BaseModel):
    keys: List[str] = Field(default_factory=list, max_length=500)


@router.post("/upload-status")
async def upload_status(req: UploadStatusRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Which of these upload keys did the server store? Lets the browser confirm uploads whose response it lost."""
    keys = [k.strip()[:64] for k in req.keys if k and k.strip()]
    if not keys:
        return []
    assets = (await db.execute(
        select(MediaAsset).options(selectinload(MediaAsset.ai_analysis), selectinload(MediaAsset.folder))
        .where(MediaAsset.user_id == user.id, MediaAsset.upload_key.in_(keys))
    )).scalars().all()
    return [serialize_asset(a) for a in assets]


@router.patch("/{asset_id}")
async def update_asset(
    asset_id: int,
    phase: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await load_owned_asset(db, user, asset_id)
    if phase:
        if phase not in ALLOWED_PHASES:
            raise HTTPException(status_code=400, detail="Invalid phase")
        asset.phase = phase
    await db.commit()
    db.expire_all()
    return serialize_asset(await load_owned_asset(db, user, asset_id))


@router.delete("/{asset_id}")
async def delete_asset(asset_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    asset = await load_owned_asset(db, user, asset_id)
    ctx = await get_storage(db, user)
    await delete_remote_asset(asset.cloudinary_public_id, asset.resource_type, creds_for_url(asset.secure_url, ctx))
    # Comparisons referencing this asset would point at nothing
    for c in (await db.execute(select(Comparison).where(
        (Comparison.before_asset_id == asset.id) | (Comparison.after_asset_id == asset.id)
    ))).scalars().all():
        await db.delete(c)
    if asset.folder:
        asset.folder.ideas_signature = None
    await db.delete(asset)
    await db.commit()
    return {"status": "success"}


# --------------------------------------------------------------------------- sync

@router.post("/sync")
async def sync_from_cloudinary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """
    Imports anything added to the user's Cloudinary folder outside this app
    (e.g. via the Cloudinary console): new subfolders become folders, new files become assets.
    """
    ctx = await get_storage(db, user)
    subfolders = await list_subfolders(ctx.root, ctx.creds)

    known_ids = set((await db.execute(
        select(MediaAsset.cloudinary_public_id).where(MediaAsset.user_id == user.id)
    )).scalars().all())

    new_folders = new_assets = 0
    for sf in subfolders:
        folder = (await db.execute(
            select(Folder).where(Folder.user_id == user.id, Folder.cloudinary_path == sf["path"])
        )).scalars().first()
        if not folder:
            folder = await _find_or_create_folder(db, ctx, sf["name"])
            folder.cloudinary_path = sf["path"]
            new_folders += 1
        resources = await list_folder_resources(sf["path"], ctx.creds)
        for r in resources:
            pid = r.get("public_id")
            if not pid or pid in known_ids or "/reel-" in pid:
                continue
            rtype = r.get("resource_type", "image")
            urls = delivery_urls(pid, rtype, ctx.creds)
            tags = r.get("tags") or []
            phase = next((t.split("-", 1)[1] for t in tags if t.startswith("phase-") and t.split("-", 1)[1] in ALLOWED_PHASES), "general")
            created = r.get("created_at")
            a = MediaAsset(
                user_id=user.id, folder_id=folder.id,
                filename=os.path.basename(r.get("secure_url", pid)),
                original_name=r.get("display_name") or r.get("original_filename") or pid.rsplit("/", 1)[-1],
                cloudinary_public_id=pid, secure_url=r.get("secure_url"), thumbnail_url=urls["thumbnail_url"],
                format=r.get("format") or "", resource_type=rtype, bytes=r.get("bytes") or 0,
                width=r.get("width") or 0, height=r.get("height") or 0,
                # Capture time is unknown without the original EXIF; keep the real Cloudinary upload time instead
                captured_at=None,
                created_at=datetime.fromisoformat(created.replace("Z", "+00:00")).replace(tzinfo=None) if created else datetime.utcnow(),
                phase=phase, ai_status="pending",
            )
            db.add(a)
            folder.ideas_signature = None
            known_ids.add(pid)
            new_assets += 1
    await db.commit()
    return {"new_folders": new_folders, "new_assets": new_assets, "root_folder": ctx.root}


# --------------------------------------------------------------------------- single asset
# Registered last so the int path parameter never shadows /storage, /folders, etc.

@router.get("/{asset_id}")
async def get_asset(asset_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Current state of one asset (lets the UI confirm a result when a long request's response was lost)."""
    return serialize_asset(await load_owned_asset(db, user, asset_id))
