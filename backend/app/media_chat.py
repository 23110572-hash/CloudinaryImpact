"""
Media Library chat agent.

Lets users ask plain-language questions about their media and its metadata
("which photos have GPS?", "show before photos of the solar project", "what did we
capture in March?"). It retrieves matching assets from the user's library, then either
asks the configured LLM to answer over that metadata.
"""
import json
import re
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MediaAsset
from app.storage import StorageContext, ai_image_bytes
from app.vision_engine import AIError, VisionEngine

FULL_CONTEXT_LIMIT = 150   # libraries up to this size are sent to the model in full
MATCH_CONTEXT = 80         # bigger libraries: keyword matches first...
SAMPLE_CONTEXT = 120       # ...topped up to this many with an even spread of the rest


def spread(items: List[Any], n: int) -> List[Any]:
    """n items evenly spaced across the list (keeps order), so big sets aren't judged by their first page."""
    if n <= 0 or not items:
        return []
    if len(items) <= n:
        return list(items)
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})

STOPWORDS = set("""
a an the and or of to in on for with from by at is are was were be been it this that these those
me my our we you your i show find list give get all any some which what where when who how many much
photo photos image images picture pictures media asset assets file files please can could would do does
did have has had about tell there their them than then into over under just only also
""".split())


def _record(a: MediaAsset) -> Dict[str, Any]:
    an = a.ai_analysis
    return {
        "id": a.id,
        "name": a.original_name,
        "folder": a.folder.name if a.folder else None,
        "phase": a.phase,
        "category": an.project_category if an else None,
        "activity": an.activity_detected if an else None,
        "summary": an.summary if an else None,
        "signals": (an.visual_signals or []) if an else [],
        "metrics": (an.environmental_metrics or {}) if an else {},
        "captured_at": a.captured_at.isoformat() if a.captured_at else None,
        "uploaded_at": a.created_at.isoformat() if a.created_at else None,
        "latitude": a.latitude,
        "longitude": a.longitude,
        "format": a.format,
        "width": a.width,
        "height": a.height,
        "bytes": a.bytes,
    }


def _public(a: MediaAsset) -> Dict[str, Any]:
    return {
        "id": a.id,
        "original_name": a.original_name,
        "thumbnail_url": a.thumbnail_url or a.secure_url,
        "secure_url": a.secure_url,
        "folder": a.folder.name if a.folder else None,
        "phase": a.phase,
        "captured_at": a.captured_at.isoformat() if a.captured_at else None,
        "latitude": a.latitude,
        "longitude": a.longitude,
        "category": a.ai_analysis.project_category if a.ai_analysis else None,
    }


def _stats(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    dates = sorted(r["captured_at"] for r in records if r["captured_at"])
    return {
        "total_assets": len(records),
        "by_folder": dict(Counter(r["folder"] or "Unfiled" for r in records)),
        "by_phase": dict(Counter(r["phase"] or "general" for r in records)),
        "by_category": dict(Counter(r["category"] or "Uncategorized" for r in records)),
        "with_gps": sum(1 for r in records if r["latitude"] is not None and r["longitude"] is not None),
        "captured_range": [dates[0][:10], dates[-1][:10]] if dates else None,
    }


def _date_filters(q: str) -> Dict[str, Optional[int]]:
    month = next((v for k, v in MONTHS.items() if re.search(rf"\b{k}\b", q)), None)
    ym = re.search(r"\b(20\d{2}|19\d{2})\b", q)
    return {"month": month, "year": int(ym.group(1)) if ym else None}


def _retrieve(message: str, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    q = message.lower()
    tokens = [t for t in re.findall(r"[a-z0-9]+", q) if t not in STOPWORDS and len(t) > 2 and t not in MONTHS]
    df = _date_filters(q)
    want_gps = any(w in q for w in ["gps", "location", "coordinates", "geotag", "where", "map"])
    phase = next((p for p in ["before", "after", "during"] if re.search(rf"\b{p}\b", q)), None)

    has_filter = bool(df["month"] or df["year"] or want_gps or phase)
    scored = []
    for r in records:
        if df["month"] or df["year"]:
            if not r["captured_at"]:
                continue
            dt = datetime.fromisoformat(r["captured_at"])
            if df["month"] and dt.month != df["month"]:
                continue
            if df["year"] and dt.year != df["year"]:
                continue
        if want_gps and "without" not in q and "no gps" not in q and r["latitude"] is None:
            continue
        if phase and r["phase"] != phase:
            continue

        hay = " ".join(str(x) for x in [
            r["name"], r["folder"], r["category"], r["activity"], r["summary"], " ".join(r["signals"]),
            " ".join(r["metrics"].keys()),
        ] if x).lower()
        score = sum(2 if t in (r["folder"] or "").lower() or t in (r["category"] or "").lower() else 1
                    for t in tokens if t in hay)
        # Records reaching here already passed date/GPS/phase filters
        if score or has_filter:
            scored.append((score, r))

    scored.sort(key=lambda s: s[0], reverse=True)
    # If keywords matched something, drop filter-only hits that matched no keyword
    if tokens and any(s > 0 for s, _ in scored):
        scored = [x for x in scored if x[0] > 0]
    return [r for _, r in scored]


async def run_media_chat(
    db: AsyncSession,
    user_id: int,
    ctx: StorageContext,
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    asset_id: Optional[int] = None,
) -> Dict[str, Any]:
    steps: List[Dict[str, str]] = []
    res = await db.execute(
        select(MediaAsset)
        .options(selectinload(MediaAsset.ai_analysis), selectinload(MediaAsset.folder))
        .where(MediaAsset.user_id == user_id)
        .order_by(MediaAsset.created_at.desc())
    )
    assets = res.scalars().all()
    by_id = {a.id: a for a in assets}
    records = [_record(a) for a in assets]
    stats = _stats(records)
    steps.append({"title": "Read library", "detail": f"Loaded metadata for {len(records)} asset(s)"})

    matches = _retrieve(message, records)
    steps.append({"title": "Search metadata", "detail": f"{len(matches)} asset(s) matched your question"})

    attached = by_id.get(asset_id) if asset_id else None
    image_bytes = None
    if attached:
        image_bytes = await ai_image_bytes(attached.cloudinary_public_id, attached.secure_url, ctx)
        steps.append({"title": "Attached image", "detail": f"Looking at {attached.original_name}"})

    # Keep the prompt bounded. Small libraries: every photo. Big ones: keyword matches plus an even
    # spread over the whole library, and the model is told exactly how many photos it can see.
    if len(records) <= FULL_CONTEXT_LIMIT:
        context_records = records
    else:
        picked = matches[:MATCH_CONTEXT]
        seen = {r["id"] for r in picked}
        rest = [r for r in records if r["id"] not in seen]
        context_records = picked + spread(rest, max(0, SAMPLE_CONTEXT - len(picked)))
    for r in context_records:
        r["summary"] = (r["summary"] or "")[:240] or None
    partial = len(context_records) < len(records)

    system = (
        "You are Buddy, the assistant for a media library built on Cloudinary. The photos can be about anything "
        "(field projects, events, trips, campaigns, daily life). "
        "Answer questions about the user's field photos using ONLY the metadata provided (and the attached image if any). "
        "Be concise and friendly, use short markdown (bold, bullet lists). If the data can't answer, say so and suggest "
        "what metadata would help. Never invent assets, numbers, locations, or dates. The library stats always "
        "cover every photo; use them for counts. If you only see part of the photos' metadata and the answer "
        "depends on the rest, say so plainly.\n"
        'Reply with a JSON object: {"answer": "<markdown>", "asset_ids": [ids of assets you refer to, most relevant first]}'
    )
    user_text = (
        f"Library stats (all {len(records)} photos):\n{json.dumps(stats)}\n\n"
        + (f"NOTE: metadata below covers {len(context_records)} of {len(records)} photos "
           f"(keyword matches first, then an even spread of the rest).\n\n" if partial else "")
        +
        f"Assets pre-matched by keyword search (ids): {[m['id'] for m in matches[:30]]}\n\n"
        f"Asset metadata:\n{json.dumps(context_records, default=str)}\n\n"
        + (f"The attached image is asset id {attached.id} ({attached.original_name}).\n\n" if attached else "")
        + f"User question: {message}"
    )
    trimmed_history = [h for h in (history or []) if h.get("content")][-8:]

    data = await VisionEngine.generate_json(
        system, user_text, ctx.settings,
        images=[image_bytes] if image_bytes else None,
        history=trimmed_history,
    )
    answer = str(data.get("answer") or "").strip()
    if not answer:
        raise AIError("Buddy didn't get an answer from the AI model. Please try again.")
    asset_ids = [int(i) for i in data.get("asset_ids", []) if str(i).isdigit() and int(i) in by_id]
    steps.append({"title": "Answer", "detail": "Written by AI from your library metadata"})

    if attached and attached.id not in asset_ids:
        asset_ids.insert(0, attached.id)

    return {
        "answer": answer,
        "assets": [_public(by_id[i]) for i in asset_ids[:12]],
        "steps": steps,
        "stats": stats,
    }
