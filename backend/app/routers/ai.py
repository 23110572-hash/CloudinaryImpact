from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import User, UserSettings, MediaAsset, Comparison
from app.auth import get_current_user
from app.vision_engine import VisionEngine
from app.media_chat import run_media_chat
from app.llm_client import load_asset_bytes

router = APIRouter(prefix="/ai", tags=["AI Vision Intelligence"])


class CompareRequest(BaseModel):
    before_asset_id: int
    after_asset_id: int
    title: str = "Environmental Progression Comparison"


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: List[ChatMessage] = []
    asset_id: Optional[int] = None


async def _get_settings(db: AsyncSession, user: User) -> Optional[UserSettings]:
    res = await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    return res.scalars().first()


async def _get_owned_asset(db: AsyncSession, user: User, asset_id: int) -> Optional[MediaAsset]:
    res = await db.execute(select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.user_id == user.id))
    return res.scalars().first()


@router.post("/chat")
async def chat_with_library(req: ChatRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Plain-language Q&A over the user's media metadata (optionally with one attached image)."""
    if req.asset_id and not await _get_owned_asset(db, user, req.asset_id):
        raise HTTPException(status_code=404, detail="Attached asset not found")
    user_settings = await _get_settings(db, user)
    return await run_media_chat(
        db=db,
        user_id=user.id,
        user_settings=user_settings,
        message=req.message.strip(),
        history=[h.model_dump() if hasattr(h, "model_dump") else h.dict() for h in req.history],
        asset_id=req.asset_id,
    )


@router.post("/compare")
async def compare_before_after(req: CompareRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if req.before_asset_id == req.after_asset_id:
        raise HTTPException(status_code=400, detail="Pick two different photos to compare")
    before_asset = await _get_owned_asset(db, user, req.before_asset_id)
    after_asset = await _get_owned_asset(db, user, req.after_asset_id)
    if not before_asset or not after_asset:
        raise HTTPException(status_code=404, detail="Before or After asset not found")

    user_settings = await _get_settings(db, user)
    comp = await VisionEngine.compare_images(
        before_bytes=await load_asset_bytes(before_asset.secure_url),
        after_bytes=await load_asset_bytes(after_asset.secure_url),
        title=req.title,
        user_settings=user_settings,
    )

    try:
        score = float(comp.get("impact_score", 0) or 0)
    except (TypeError, ValueError):
        score = 0.0

    comparison = Comparison(
        user_id=user.id,
        title=req.title,
        before_asset_id=before_asset.id,
        after_asset_id=after_asset.id,
        delta_summary=comp.get("delta_summary", ""),
        impact_score=score,
        metrics_diff=comp.get("metrics_diff", {}),
    )
    db.add(comparison)
    await db.commit()
    await db.refresh(comparison)

    return {
        "id": comparison.id,
        "title": comparison.title,
        "before_asset": {"id": before_asset.id, "url": before_asset.secure_url, "name": before_asset.original_name, "captured_at": before_asset.captured_at},
        "after_asset": {"id": after_asset.id, "url": after_asset.secure_url, "name": after_asset.original_name, "captured_at": after_asset.captured_at},
        "delta_summary": comparison.delta_summary,
        "impact_score": comparison.impact_score,
        "metrics_diff": comparison.metrics_diff,
        "simulated": bool(comp.get("simulated")),
        "provider_used": VisionEngine.provider_label(user_settings),
        "created_at": comparison.created_at,
    }


@router.get("/comparisons")
async def list_comparisons(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Comparison).where(Comparison.user_id == user.id).order_by(Comparison.created_at.desc()))
    out = []
    for c in res.scalars().all():
        b = await db.get(MediaAsset, c.before_asset_id)
        a = await db.get(MediaAsset, c.after_asset_id)
        out.append({
            "id": c.id,
            "title": c.title,
            "before_url": b.secure_url if b else "",
            "after_url": a.secure_url if a else "",
            "before_name": b.original_name if b else "",
            "after_name": a.original_name if a else "",
            "delta_summary": c.delta_summary,
            "impact_score": c.impact_score,
            "metrics_diff": c.metrics_diff,
            "created_at": c.created_at,
        })
    return out
