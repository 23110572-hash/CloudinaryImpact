"""
Media Library chat agent.

Lets users ask plain-language questions about their media and its metadata
("which photos have GPS?", "show before photos of the solar project", "what did we
capture in March?"). It retrieves matching assets from the user's library, then either
asks the configured LLM to answer over that metadata, or falls back to a rule-based answer.
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
from app.vision_engine import VisionEngine
from app.llm_client import load_asset_bytes, parse_json_response

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


def _fallback_answer(message: str, records: List[Dict[str, Any]], matches: List[Dict[str, Any]], stats: Dict[str, Any]) -> str:
    q = message.lower()
    if not records:
        return "Your Media Library is empty. Upload some field photos first, then ask me about them."

    lines: List[str] = []
    if any(w in q for w in ["how many", "count", "number of", "total"]):
        lines.append(f"You have **{stats['total_assets']}** assets in your library.")
        if matches and len(matches) != len(records):
            lines.append(f"**{len(matches)}** of them match your question.")
    if "folder" in q:
        lines.append("**Folders:**")
        lines += [f"- {k}: {v} asset(s)" for k, v in stats["by_folder"].items()]
    if any(w in q for w in ["gps", "location", "coordinates", "where", "map"]):
        lines.append(f"**{stats['with_gps']}** of {stats['total_assets']} assets have GPS coordinates in their EXIF data.")
    if any(w in q for w in ["summary", "summarize", "overview", "everything"]):
        lines.append("**Library overview**")
        lines.append(f"- Phases: " + ", ".join(f"{k} ({v})" for k, v in stats["by_phase"].items()))
        lines.append(f"- Categories: " + ", ".join(f"{k} ({v})" for k, v in stats["by_category"].items()))
        if stats["captured_range"]:
            lines.append(f"- Captured between {stats['captured_range'][0]} and {stats['captured_range'][1]}")

    if matches:
        lines.append(f"\nI found **{len(matches)}** matching asset(s):")
        for r in matches[:8]:
            bits = [r["folder"] or "Unfiled", r["phase"]]
            if r["captured_at"]:
                bits.append(r["captured_at"][:10])
            if r["latitude"] is not None:
                bits.append(f"GPS {r['latitude']:.4f}, {r['longitude']:.4f}")
            lines.append(f"- **{r['name']}** ({' · '.join(bits)})" + (f": {r['summary']}" if r["summary"] else ""))
    elif not lines:
        lines.append("I couldn't find assets matching that. Try asking by folder, phase (before/after), month, "
                     "GPS, or a visual tag like *solar* or *trees*.")

    lines.append("\n_Answered from your metadata without an AI model. Connect an AI key in Settings for richer answers._")
    return "\n".join(lines)


async def run_media_chat(
    db: AsyncSession,
    user_id: int,
    user_settings: Optional[Any],
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
        image_bytes = await load_asset_bytes(attached.secure_url)
        steps.append({"title": "Attached image", "detail": f"Looking at {attached.original_name}"})

    # Keep the prompt bounded: send everything for small libraries, otherwise matches first
    context_records = records if len(records) <= 120 else (matches[:60] or records[:60])
    for r in context_records:
        r["summary"] = (r["summary"] or "")[:240] or None

    system = (
        "You are the Media Library assistant for an NGO impact platform built on Cloudinary. "
        "Answer questions about the user's field photos using ONLY the metadata provided (and the attached image if any). "
        "Be concise and friendly, use short markdown (bold, bullet lists). If the data can't answer, say so and suggest "
        "what metadata would help. Never invent assets, numbers, locations, or dates.\n"
        'Reply with a JSON object: {"answer": "<markdown>", "asset_ids": [ids of assets you refer to, most relevant first]}'
    )
    user_text = (
        f"Library stats:\n{json.dumps(stats)}\n\n"
        f"Assets pre-matched by keyword search (ids): {[m['id'] for m in matches[:30]]}\n\n"
        f"Asset metadata:\n{json.dumps(context_records, default=str)}\n\n"
        + (f"The attached image is asset id {attached.id} ({attached.original_name}).\n\n" if attached else "")
        + f"User question: {message}"
    )
    trimmed_history = [h for h in (history or []) if h.get("content")][-8:]

    answer = None
    asset_ids: List[int] = []
    text = await VisionEngine.generate(
        system, user_text, user_settings,
        images=[image_bytes] if image_bytes else None,
        json_mode=True, history=trimmed_history,
    )
    if text:
        try:
            data = parse_json_response(text)
            answer = data.get("answer")
            asset_ids = [int(i) for i in data.get("asset_ids", []) if str(i).isdigit() and int(i) in by_id]
        except Exception:
            answer = text  # Model ignored JSON format; show its text as-is
        steps.append({"title": "AI answer", "detail": VisionEngine.provider_label(user_settings)})

    if not answer:
        answer = _fallback_answer(message, records, matches, stats)
        asset_ids = [m["id"] for m in matches[:12]]
        steps.append({"title": "Metadata answer", "detail": "No AI model available, answered with rule-based search"})

    if attached and attached.id not in asset_ids:
        asset_ids.insert(0, attached.id)

    return {
        "answer": answer,
        "assets": [_public(by_id[i]) for i in asset_ids[:12]],
        "provider_used": VisionEngine.provider_label(user_settings) if text else "Metadata search",
        "steps": steps,
        "stats": stats,
    }
