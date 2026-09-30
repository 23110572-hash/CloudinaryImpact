"""
Studio: turns a folder of photos into things people can use.

The AI first works out what the folder is actually about (a field project, a birthday, a trip,
a blood donation camp...) and suggests what to make from it. Every suggestion, or a free-text
request, is mapped to one of five renderers that produce the output with real Cloudinary features:

  document      written report / story / summary (markdown, with links to every source photo)
  social        ready-to-post square + vertical images with text, built with transformations
  before_after  side-by-side before/after image + AI description of the visible change
  reel          one animated reel (GIF + MP4) from the folder's photos (Upload API `multi`)
  pack          ZIP of the untouched originals (signed, expiring link) + CSV of their details
"""
import asyncio
import csv
import hashlib
import io
import json
from collections import Counter
from typing import Any, Dict, List, Optional

import cloudinary
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.cloudinary_service import before_after_url, create_reel, photo_pack_url, social_card_url
from app.database import get_db
from app.media_chat import spread
from app.models import Comparison, Folder, ImpactReport, MediaAsset, User
from app.routers.reports import serialize_creation
from app.storage import StorageContext, ai_image_bytes, creds_for_url, get_storage
from app.vision_engine import AIError, VisionEngine

router = APIRouter(prefix="/studio", tags=["Studio"])

KINDS: Dict[str, str] = {
    "document": "a written piece: report, story, summary, recap, update, newsletter, letter, blog post, etc.",
    "social": "a ready-to-post social image (square + vertical story) with a headline and caption on the best photo, plus post text",
    "before_after": "a side-by-side before/after image with a description of the visible change (needs Before and After photos)",
    "reel": "a short animated slideshow (GIF + MP4) made from the folder's photos",
    "pack": "a downloadable ZIP of the original photos plus a CSV of their details (dates, GPS, tags)",
}


class Idea(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=400)
    kind: str
    audience: str = Field("", max_length=120)
    tone: str = Field("", max_length=120)
    prompt: str = Field("", max_length=1200)
    asset_ids: List[int] = []


class CreateRequest(BaseModel):
    folder_id: int
    idea: Optional[Idea] = None
    request: Optional[str] = Field(None, max_length=1200)


# --------------------------------------------------------------------------- data helpers

async def _folder_with_assets(db: AsyncSession, user: User, folder_id: int):
    folder = (await db.execute(select(Folder).where(Folder.id == folder_id, Folder.user_id == user.id))).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    assets = (await db.execute(
        select(MediaAsset)
        .options(selectinload(MediaAsset.ai_analysis), selectinload(MediaAsset.folder))
        .where(MediaAsset.folder_id == folder.id, MediaAsset.user_id == user.id)
        .order_by(MediaAsset.captured_at.asc().nullslast(), MediaAsset.created_at.asc())
    )).scalars().all()
    if not assets:
        raise HTTPException(status_code=400, detail="This folder has no photos yet. Upload some first.")
    return folder, list(assets)


def _signature(assets: List[MediaAsset]) -> str:
    raw = ";".join(f"{a.id}:{a.ai_status}:{a.phase}" for a in sorted(assets, key=lambda x: x.id))
    return hashlib.sha1(raw.encode()).hexdigest()


def _record(a: MediaAsset) -> Dict[str, Any]:
    an = a.ai_analysis if a.ai_status == "analyzed" else None
    return {
        "id": a.id,
        "name": a.original_name,
        "phase": a.phase,
        "captured_at": a.captured_at.isoformat() if a.captured_at else None,
        "gps": [round(a.latitude, 5), round(a.longitude, 5)] if a.latitude is not None and a.longitude is not None else None,
        "theme": an.project_category if an else None,
        "activity": an.activity_detected if an else None,
        "summary": (an.summary or "")[:240] if an else None,
        "tags": (an.visual_signals or [])[:8] if an else [],
        "measured": an.environmental_metrics if an else {},
    }


def _stats(assets: List[MediaAsset]) -> Dict[str, Any]:
    phases = Counter(a.phase or "general" for a in assets)
    dates = sorted(a.captured_at for a in assets if a.captured_at)
    tags = Counter(t for a in assets if a.ai_analysis and a.ai_status == "analyzed" for t in (a.ai_analysis.visual_signals or []))
    themes = Counter(a.ai_analysis.project_category for a in assets if a.ai_analysis and a.ai_status == "analyzed")
    return {
        "total": len(assets),
        "images": sum(1 for a in assets if a.resource_type == "image"),
        "analyzed": sum(1 for a in assets if a.ai_status == "analyzed"),
        "not_analyzed": sum(1 for a in assets if a.ai_status != "analyzed"),
        "phases": {k: phases.get(k, 0) for k in ("before", "during", "after", "general")},
        "geotagged": sum(1 for a in assets if a.latitude is not None and a.longitude is not None),
        "date_range": [dates[0].date().isoformat(), dates[-1].date().isoformat()] if dates else None,
        "top_tags": [t for t, _ in tags.most_common(10)],
        "themes": [t for t, _ in themes.most_common(5)],
    }


def _available_kinds(stats: Dict[str, Any]) -> Dict[str, str]:
    kinds = dict(KINDS)
    if not (stats["phases"]["before"] and stats["phases"]["after"]):
        kinds.pop("before_after")
    if stats["images"] < 2:
        kinds.pop("reel")
    return kinds


def _clean_idea(raw: Dict[str, Any], kinds: Dict[str, str], valid_ids: set) -> Optional[Dict[str, Any]]:
    kind = str(raw.get("kind") or "").strip().lower()
    title = str(raw.get("title") or "").strip()
    if kind not in kinds or not title:
        return None
    return {
        "title": title[:120],
        "description": str(raw.get("description") or "").strip()[:400],
        "kind": kind,
        "audience": str(raw.get("audience") or "").strip()[:120],
        "tone": str(raw.get("tone") or "").strip()[:120],
        "prompt": str(raw.get("prompt") or "").strip()[:1200],
        "asset_ids": [int(i) for i in (raw.get("asset_ids") or []) if str(i).isdigit() and int(i) in valid_ids][:20],
    }


CONTEXT_PHOTOS = 60


def _context_block(folder: Folder, assets: List[MediaAsset], stats: Dict[str, Any], first_ids: Optional[List[int]] = None) -> str:
    """Metadata the model sees. Big folders: the chosen photos first, then an even spread over the whole folder."""
    first = [a for a in assets if a.id in set(first_ids or [])]
    rest = [a for a in assets if a not in first]
    shown = first[:CONTEXT_PHOTOS] + spread(rest, max(0, CONTEXT_PHOTOS - len(first)))
    note = f" (showing {len(shown)} of {len(assets)}, spread across the folder)" if len(shown) < len(assets) else ""
    return (
        f"Folder name: {folder.name}\n"
        f"Folder stats (all photos): {json.dumps(stats)}\n"
        f"Photos{note} (metadata; ids are real): {json.dumps([_record(a) for a in shown], default=str)}"
    )


# --------------------------------------------------------------------------- ideas

@router.get("/folders/{folder_id}/ideas")
async def folder_ideas(folder_id: int, refresh: bool = False, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """AI reads the folder and suggests what to make from it. Cached until the folder's photos change."""
    folder, assets = await _folder_with_assets(db, user, folder_id)
    stats = _stats(assets)
    sig = _signature(assets)
    if not refresh and folder.ideas and folder.ideas_signature == sig:
        return {"folder_id": folder.id, "folder_name": folder.name, "stats": stats, **folder.ideas}

    if not stats["analyzed"]:
        raise HTTPException(status_code=400, detail="None of these photos have been analyzed yet. Analyze them in the Media Library first.")

    ctx = await get_storage(db, user)
    kinds = _available_kinds(stats)
    data = await VisionEngine.generate_json(
        system=(
            "You help people turn a folder of photos into something useful. First work out what this folder is "
            "really about from the photos themselves (it could be anything: a field project, a birthday, a trip, "
            "a blood donation camp, a wedding, a product shoot, a cleanup drive...). Do not assume it is an NGO "
            "project unless the photos show that. Then suggest what would genuinely be worth creating from it, for "
            "the people who would care about it. Reply with strict JSON only."
        ),
        user_text=(
            f"{_context_block(folder, assets, stats)}\n\n"
            f"Output types you can choose from (kind -> what it produces): {json.dumps(kinds)}\n\n"
            "Return JSON: {\"theme\": \"one sentence on what this folder is about\", \"ideas\": [3 items, each "
            "{\"title\": \"specific, short\", \"description\": \"one sentence on what it is and who it is for\", "
            "\"kind\": one of the kinds above, \"audience\": \"who it is for\", \"tone\": \"e.g. warm, formal, playful\", "
            "\"prompt\": \"detailed instructions for writing it\", \"asset_ids\": [the best photo ids for it]}]}. "
            "Make the 3 ideas different from each other and use at least 2 different kinds."
        ),
        user_settings=ctx.settings,
    )
    valid_ids = {a.id for a in assets}
    ideas = [i for i in (_clean_idea(x, kinds, valid_ids) for x in (data.get("ideas") or []) if isinstance(x, dict)) if i]
    if not ideas:
        raise AIError("The AI model didn't return usable ideas. Please try again.")
    cached = {"theme": str(data.get("theme") or "").strip()[:300], "ideas": ideas[:4]}
    folder.ideas = cached
    folder.ideas_signature = sig
    await db.commit()
    return {"folder_id": folder.id, "folder_name": folder.name, "stats": stats, **cached}


async def _plan_request(folder: Folder, assets: List[MediaAsset], stats: Dict[str, Any], request: str, ctx: StorageContext) -> Dict[str, Any]:
    """Maps a free-text request ("1-page update for the district officer with the 3 best photos") to a renderer."""
    kinds = _available_kinds(stats)
    data = await VisionEngine.generate_json(
        system="You turn a user's request about a folder of photos into a precise creation plan. Reply with strict JSON only.",
        user_text=(
            f"{_context_block(folder, assets, stats)}\n\n"
            f"Output types available (kind -> what it produces): {json.dumps(kinds)}\n\n"
            f"User request: {request}\n\n"
            "Pick the kind that best fulfils the request and return JSON: {\"title\", \"description\", \"kind\", "
            "\"audience\", \"tone\", \"prompt\" (detailed writing instructions that follow the request exactly), "
            "\"asset_ids\" (photo ids to use, best first)}. If the request needs Before/After photos and none exist, "
            "choose \"document\" and say so in the prompt."
        ),
        user_settings=ctx.settings,
    )
    idea = _clean_idea(data, kinds, {a.id for a in assets})
    if not idea:
        raise AIError("The AI model couldn't plan that request. Try rephrasing it.")
    idea["prompt"] = f"User request: {request}\n{idea['prompt']}"
    return idea


# --------------------------------------------------------------------------- renderers

def _pick(assets: List[MediaAsset], ids: List[int], images_only: bool = True) -> List[MediaAsset]:
    by_id = {a.id: a for a in assets}
    chosen = [by_id[i] for i in ids if i in by_id]
    rest = [a for a in assets if a not in chosen]
    out = chosen + rest
    return [a for a in out if a.resource_type == "image"] if images_only else out


async def _render_document(folder, assets, stats, idea, ctx) -> Dict[str, Any]:
    comps = []
    ids = {a.id for a in assets}
    narrative = await VisionEngine.generate(
        system=(
            "You write from photo evidence. Use ONLY the data given. Never invent numbers, names, places or outcomes; "
            "if something isn't shown by the data, say so plainly. Match the purpose, audience and tone requested. "
            "Write GitHub-flavored markdown with ## headings, short paragraphs and bullet lists. No title line."
        ),
        user_text=(
            f"Piece to write: {idea['title']}. {idea['description']}\n"
            f"Audience: {idea['audience'] or 'general'}. Tone: {idea['tone'] or 'clear and friendly'}.\n"
            f"Instructions: {idea['prompt']}\n\n"
            f"{_context_block(folder, assets, stats, idea['asset_ids'])}\n"
            f"Photos to feature first: {idea['asset_ids']}"
        ),
        user_settings=ctx.settings,
    )
    dr = stats["date_range"]
    lines = [
        f"# {idea['title']}",
        f"**Folder:** {folder.name}  ",
        *([f"**For:** {idea['audience']}  "] if idea["audience"] else []),
        f"**Photos:** {stats['total']}" + (f" · captured {dr[0]} to {dr[1]}" if dr else "") + "  ",
        "",
        narrative.strip(),
        "",
        "## Source photos",
    ]
    featured = _pick(assets, idea["asset_ids"], images_only=False)
    for a in featured[:50]:
        meta = [a.phase or "general"]
        if a.captured_at:
            meta.append(f"{a.captured_at:%Y-%m-%d}")
        if a.latitude is not None:
            meta.append(f"{a.latitude:.4f}, {a.longitude:.4f}")
        lines.append(f"- [{a.original_name}]({a.secure_url}) · {' · '.join(meta)}")
    if len(featured) > 50:
        lines.append(f"- …and {len(featured) - 50} more in the Media Library")
    key_metrics = [
        {"label": "Photos", "value": str(stats["total"])},
        {"label": "Geotagged", "value": f"{stats['geotagged']} ({round(100 * stats['geotagged'] / stats['total'])}%)"},
        {"label": "Before / After", "value": f"{stats['phases']['before']} / {stats['phases']['after']}"},
        {"label": "Period", "value": f"{dr[0]} → {dr[1]}" if dr else "No capture dates"},
    ]
    covers = [{"id": a.id, "url": a.thumbnail_url or a.secure_url} for a in _pick(assets, idea["asset_ids"])[:3]]
    return {"markdown": "\n".join(lines), "key_metrics": key_metrics, "payload": {"cover_images": covers, "source_ids": [a.id for a in featured]}}


async def _render_social(folder, assets, stats, idea, ctx) -> Dict[str, Any]:
    candidates = _pick(assets, idea["asset_ids"])
    if not candidates:
        raise HTTPException(status_code=400, detail="A social post needs at least one photo.")
    data = await VisionEngine.generate_json(
        system="You write short, honest social media copy from photo metadata. Never invent facts. Reply with strict JSON only.",
        user_text=(
            f"Post: {idea['title']}. {idea['description']}\nAudience: {idea['audience']}. Tone: {idea['tone']}.\n"
            f"Instructions: {idea['prompt']}\n\n{_context_block(folder, candidates[:20], stats)}\n\n"
            "Return JSON: {\"headline\": \"max 45 characters, printed on the image\", \"caption\": \"max 90 characters, "
            "printed under it\", \"post_text\": \"the full post text\", \"hashtags\": [3-6 tags without #], "
            "\"asset_id\": id of the single best photo}"
        ),
        user_settings=ctx.settings,
    )
    headline = str(data.get("headline") or "").strip()
    caption = str(data.get("caption") or "").strip()
    if not headline:
        raise AIError("The AI model didn't write a headline. Please try again.")
    by_id = {a.id: a for a in candidates}
    photo = by_id.get(int(data["asset_id"])) if str(data.get("asset_id", "")).isdigit() and int(data["asset_id"]) in by_id else candidates[0]
    creds = creds_for_url(photo.secure_url, ctx)
    if not creds:
        raise HTTPException(status_code=400, detail="This photo is stored in a Cloudinary account that is no longer connected.")
    hashtags = [str(h).lstrip("#").replace(" ", "") for h in (data.get("hashtags") or []) if str(h).strip()][:6]
    post = str(data.get("post_text") or "").strip()
    images = [
        {"format": "square", "label": "Square 1080×1080", "url": social_card_url(photo.cloudinary_public_id, creds, headline, caption, "square")},
        {"format": "story", "label": "Story 1080×1920", "url": social_card_url(photo.cloudinary_public_id, creds, headline, caption, "story")},
    ]
    text = post + ("\n\n" + " ".join(f"#{h}" for h in hashtags) if hashtags else "")
    return {
        "markdown": text,
        "key_metrics": [],
        "payload": {"images": images, "headline": headline, "caption": caption, "post_text": post, "hashtags": hashtags,
                    "source_ids": [photo.id], "source_url": photo.secure_url},
    }


async def _render_before_after(folder, assets, stats, idea, ctx, db, user) -> Dict[str, Any]:
    chosen = _pick(assets, idea["asset_ids"])
    before = next((a for a in chosen if a.phase == "before"), None)
    after = next((a for a in chosen if a.phase == "after"), None)
    if not before or not after:
        raise HTTPException(status_code=400, detail="This folder needs at least one Before and one After photo.")
    creds = creds_for_url(before.secure_url, ctx)
    if not creds or creds_for_url(after.secure_url, ctx) != creds:
        raise HTTPException(status_code=400, detail="Both photos must be in the same connected Cloudinary account.")
    b_bytes, a_bytes = await asyncio.gather(
        ai_image_bytes(before.cloudinary_public_id, before.secure_url, ctx),
        ai_image_bytes(after.cloudinary_public_id, after.secure_url, ctx),
    )
    comp = await VisionEngine.compare_images(b_bytes, a_bytes, f"{folder.name}: {idea['title']}", ctx.settings)
    try:
        score = float(comp.get("impact_score") or 0)
    except (TypeError, ValueError):
        score = 0.0
    db.add(Comparison(
        user_id=user.id, title=f"{folder.name}: {before.original_name} → {after.original_name}"[:255],
        before_asset_id=before.id, after_asset_id=after.id,
        delta_summary=comp["delta_summary"], impact_score=score, metrics_diff=comp.get("metrics_diff") or {},
    ))
    metrics = comp.get("metrics_diff") or {}
    md = "\n".join([
        f"# {idea['title']}",
        "",
        comp["delta_summary"],
        "",
        *([f"- **{k.replace('_', ' ').capitalize()}:** {v}" for k, v in metrics.items()]),
        "",
        f"Before: [{before.original_name}]({before.secure_url})" + (f" · {before.captured_at:%Y-%m-%d}" if before.captured_at else ""),
        "",
        f"After: [{after.original_name}]({after.secure_url})" + (f" · {after.captured_at:%Y-%m-%d}" if after.captured_at else ""),
    ])
    return {
        "markdown": md,
        "key_metrics": [{"label": "Change score", "value": f"{score:g}/10"}] + [{"label": k.replace("_", " ").capitalize(), "value": str(v)} for k, v in list(metrics.items())[:3]],
        "payload": {
            "images": [{"format": "side_by_side", "label": "Before & After 1600×800", "url": before_after_url(before.cloudinary_public_id, after.cloudinary_public_id, creds)}],
            "source_ids": [before.id, after.id],
        },
    }


async def _render_reel(folder, assets, stats, idea, ctx) -> Dict[str, Any]:
    photos = [a for a in _pick(assets, idea["asset_ids"]) if creds_for_url(a.secure_url, ctx) == ctx.creds][:20]
    if len(photos) < 2:
        raise HTTPException(status_code=400, detail="A reel needs at least 2 photos in your connected Cloudinary account.")
    # Order frames by capture time so the reel tells the story in sequence
    photos.sort(key=lambda a: (a.captured_at is None, a.captured_at or a.created_at))
    frame_urls = [
        cloudinary.CloudinaryImage(a.cloudinary_public_id).build_url(
            transformation=[{"width": 1600, "crop": "limit"}], format="jpg", secure=True, cloud_name=ctx.creds["cloud_name"],
        ) for a in photos
    ]
    reel = await create_reel(frame_urls, ctx.creds, folder.cloudinary_path or f"{ctx.root}/studio")
    return {
        "markdown": idea["description"] or idea["title"],
        "key_metrics": [{"label": "Frames", "value": str(len(photos))}],
        "payload": {"videos": [{"format": "mp4", "label": "MP4 video", "url": reel["mp4_url"]}],
                    "images": [{"format": "gif", "label": "Animated GIF", "url": reel["gif_url"]}],
                    "reel_public_id": reel["public_id"], "source_ids": [a.id for a in photos]},
    }


def _render_pack(folder, assets, stats, idea, ctx) -> Dict[str, Any]:
    photos = [a for a in _pick(assets, idea["asset_ids"]) if creds_for_url(a.secure_url, ctx) == ctx.creds]
    if not photos:
        raise HTTPException(status_code=400, detail="There are no photos in your connected Cloudinary account to pack.")
    return {
        "markdown": idea["description"] or f"Original photos from {folder.name} with a CSV of their details.",
        "key_metrics": [{"label": "Photos", "value": str(len(photos))}, {"label": "Geotagged", "value": str(sum(1 for a in photos if a.latitude is not None))}],
        "payload": {"source_ids": [a.id for a in photos], "zip_name": f"{folder.name}-originals"},
    }


# --------------------------------------------------------------------------- create

@router.post("/create")
async def create(req: CreateRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not req.idea and not (req.request or "").strip():
        raise HTTPException(status_code=400, detail="Pick an idea or describe what you need.")
    folder, assets = await _folder_with_assets(db, user, req.folder_id)
    stats = _stats(assets)
    ctx = await get_storage(db, user)

    if req.request and req.request.strip():
        idea = await _plan_request(folder, assets, stats, req.request.strip(), ctx)
    else:
        idea = _clean_idea(req.idea.model_dump(), _available_kinds(stats), {a.id for a in assets})
        if not idea:
            raise HTTPException(status_code=400, detail="That option isn't available for this folder.")

    kind = idea["kind"]
    if kind == "document":
        out = await _render_document(folder, assets, stats, idea, ctx)
    elif kind == "social":
        out = await _render_social(folder, assets, stats, idea, ctx)
    elif kind == "before_after":
        out = await _render_before_after(folder, assets, stats, idea, ctx, db, user)
    elif kind == "reel":
        out = await _render_reel(folder, assets, stats, idea, ctx)
    else:
        out = _render_pack(folder, assets, stats, idea, ctx)

    creation = ImpactReport(
        user_id=user.id,
        title=idea["title"],
        project_category=folder.name,
        markdown_content=out["markdown"],
        key_metrics=out["key_metrics"],
        kind=kind,
        folder_id=folder.id,
        payload={**out["payload"], "idea": idea},
    )
    db.add(creation)
    await db.commit()
    await db.refresh(creation)
    return serialize_creation(creation)


# --------------------------------------------------------------------------- downloads

async def _owned_creation(db: AsyncSession, user: User, creation_id: int) -> ImpactReport:
    r = (await db.execute(select(ImpactReport).where(ImpactReport.id == creation_id, ImpactReport.user_id == user.id))).scalars().first()
    if not r:
        raise HTTPException(status_code=404, detail="Creation not found")
    return r


@router.get("/creations/{creation_id}/pack-link")
async def pack_link(creation_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Fresh signed ZIP link (Cloudinary links expire after an hour, so one is made per click)."""
    r = await _owned_creation(db, user, creation_id)
    ids = (r.payload or {}).get("source_ids") or []
    assets = (await db.execute(select(MediaAsset).where(MediaAsset.user_id == user.id, MediaAsset.id.in_(ids)))).scalars().all()
    ctx = await get_storage(db, user)
    public_ids = [a.cloudinary_public_id for a in assets if creds_for_url(a.secure_url, ctx) == ctx.creds and a.resource_type == "image"]
    if not public_ids:
        raise HTTPException(status_code=400, detail="None of these photos are left in your Cloudinary account.")
    return {"url": photo_pack_url(public_ids, ctx.creds, (r.payload or {}).get("zip_name") or r.title), "count": len(public_ids)}


def _csv_safe(v: Any) -> Any:
    """Stops spreadsheet apps from running text as a formula (CSV injection). Numbers pass through."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


@router.get("/folders/{folder_id}/details.csv")
async def folder_csv(folder_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    folder, assets = await _folder_with_assets(db, user, folder_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["file", "phase", "captured_at", "uploaded_at", "latitude", "longitude", "theme", "activity", "tags", "summary", "original_url"])
    for a in assets:
        an = a.ai_analysis if a.ai_status == "analyzed" else None
        w.writerow([_csv_safe(v) for v in [
            a.original_name, a.phase, a.captured_at.isoformat() if a.captured_at else "", a.created_at.isoformat() if a.created_at else "",
            a.latitude if a.latitude is not None else "", a.longitude if a.longitude is not None else "",
            an.project_category if an else "", (an.activity_detected or "") if an else "",
            "; ".join(an.visual_signals or []) if an else "", an.summary if an else "", a.secure_url,
        ]])
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{folder.slug or "folder"}-details.csv"'},
    )
