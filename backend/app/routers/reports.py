import json
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_db
from app.models import User, UserSettings, ImpactReport, MediaAsset, Folder, Comparison
from app.vision_engine import VisionEngine

router = APIRouter(prefix="/reports", tags=["Impact Reports"])


class GenerateReportRequest(BaseModel):
    title: str = "Impact & Sustainability Progress Report"
    folder_id: Optional[int] = None
    target_stakeholder: str = "Donors & Governing Board"
    tone: str = "donor"  # donor | technical | campaign
    # Kept for backwards compatibility with older clients
    category: Optional[str] = None


def _serialize(r: ImpactReport) -> dict:
    return {
        "id": r.id,
        "title": r.title,
        "category": r.project_category,
        "markdown_content": r.markdown_content,
        "key_metrics": r.key_metrics or [],
        "created_at": r.created_at,
    }


@router.post("/generate")
async def generate_report(req: GenerateReportRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stmt = (
        select(MediaAsset)
        .options(selectinload(MediaAsset.ai_analysis), selectinload(MediaAsset.folder))
        .where(MediaAsset.user_id == user.id)
        .order_by(MediaAsset.captured_at.asc())
    )
    scope = "All projects"
    if req.folder_id:
        folder = (await db.execute(select(Folder).where(Folder.id == req.folder_id, Folder.user_id == user.id))).scalars().first()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        stmt = stmt.where(MediaAsset.folder_id == folder.id)
        scope = folder.name
    assets = (await db.execute(stmt)).scalars().all()
    if not assets:
        raise HTTPException(status_code=400, detail="No media in this scope yet. Upload photos before generating a report.")

    asset_ids = {a.id for a in assets}
    comps = [c for c in (await db.execute(
        select(Comparison).where(Comparison.user_id == user.id).order_by(Comparison.created_at.desc())
    )).scalars().all() if c.before_asset_id in asset_ids or c.after_asset_id in asset_ids]

    phases = Counter(a.phase or "general" for a in assets)
    categories = Counter((a.ai_analysis.project_category if a.ai_analysis else None) or "Uncategorized" for a in assets)
    folders = Counter(a.folder.name if a.folder else "Unfiled" for a in assets)
    with_gps = [a for a in assets if a.latitude is not None and a.longitude is not None]
    dates = [a.captured_at for a in assets if a.captured_at]
    signals = Counter(s for a in assets if a.ai_analysis for s in (a.ai_analysis.visual_signals or []))

    key_metrics = [
        {"label": "Evidence assets", "value": str(len(assets))},
        {"label": "Geotagged", "value": f"{len(with_gps)} ({round(100 * len(with_gps) / len(assets))}%)"},
        {"label": "Before / After", "value": f"{phases.get('before', 0)} / {phases.get('after', 0)}"},
        {"label": "Comparisons", "value": str(len(comps))},
    ]

    evidence = [{
        "id": a.id,
        "name": a.original_name,
        "folder": a.folder.name if a.folder else None,
        "phase": a.phase,
        "captured_at": a.captured_at.isoformat() if a.captured_at else None,
        "gps": [a.latitude, a.longitude] if a.latitude is not None else None,
        "category": a.ai_analysis.project_category if a.ai_analysis else None,
        "activity": a.ai_analysis.activity_detected if a.ai_analysis else None,
        "summary": (a.ai_analysis.summary or "")[:220] if a.ai_analysis else None,
        "metrics": a.ai_analysis.environmental_metrics if a.ai_analysis else {},
    } for a in assets[:80]]
    comp_data = [{"title": c.title, "impact_score": c.impact_score, "summary": c.delta_summary[:400], "metrics": c.metrics_diff} for c in comps[:10]]

    user_settings = (await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))).scalars().first()
    tone_hint = {
        "donor": "warm but factual, for donors and a grant committee",
        "technical": "precise and neutral, for auditors and M&E officers",
        "campaign": "short, inspiring and shareable, for a public campaign / social post",
    }.get(req.tone, "factual")

    narrative = await VisionEngine.generate(
        system=(
            "You write impact reports for NGOs from field-media evidence. Use ONLY the data given. "
            "Never invent numbers, places, or outcomes; if something is unknown, say it is not yet evidenced. "
            "Write GitHub-flavored markdown with ## headings and bullet lists. No title line (it is added separately)."
        ),
        user_text=(
            f"Audience: {req.target_stakeholder}. Tone: {tone_hint}. Scope: {scope}.\n"
            "Sections: Executive summary; What the evidence shows (by project/category); "
            "Before vs after progress (use the comparisons); Locations & timeline; Gaps and recommended next captures.\n\n"
            f"Totals: {json.dumps({'assets': len(assets), 'phases': phases, 'categories': categories, 'folders': folders, 'geotagged': len(with_gps), 'top_signals': signals.most_common(12)})}\n"
            f"Comparisons: {json.dumps(comp_data, default=str)}\n"
            f"Evidence: {json.dumps(evidence, default=str)}"
        ),
        user_settings=user_settings,
    )

    lines = [
        f"# {req.title}",
        f"**Prepared for:** {req.target_stakeholder}  ",
        f"**Scope:** {scope}  ",
        f"**Evidence period:** {min(dates):%d %b %Y} – {max(dates):%d %b %Y}  " if dates else "**Evidence period:** capture dates not available  ",
        f"**Generated with:** {VisionEngine.provider_label(user_settings) if narrative else 'Metadata summary (no AI model configured)'}",
        "",
    ]
    if narrative:
        lines.append(narrative.strip())
    else:
        lines += [
            "## Executive summary",
            f"This report covers **{len(assets)}** media assets across **{len(folders)}** folder(s). "
            f"**{len(with_gps)}** are geotagged and **{len(comps)}** before/after comparison(s) have been run.",
            "",
            "## Evidence by category",
            *[f"- **{k}:** {v} asset(s)" for k, v in categories.most_common()],
            "",
            "## Project phases",
            *[f"- **{k.title()}:** {v}" for k, v in phases.most_common()],
            "",
        ]
        if comps:
            lines.append("## Before vs after")
            for c in comps[:5]:
                lines.append(f"- **{c.title}** (impact score {c.impact_score}/10): {c.delta_summary}")
            lines.append("")
        if signals:
            lines += ["## Most common visual signals", ", ".join(f"`{s}`" for s, _ in signals.most_common(12)), ""]
        lines += [
            "## Gaps",
            *([f"- {len(assets) - len(with_gps)} asset(s) have no GPS. Enable location on field cameras."] if len(with_gps) < len(assets) else []),
            *(["- No **before** photos yet. Capture baselines before work starts."] if not phases.get("before") else []),
            *(["- No **after** photos yet. Capture follow-ups from the same viewpoint."] if not phases.get("after") else []),
        ]

    # Traceability appendix: every claim links back to the original source asset
    lines += ["", "## Evidence appendix (source assets)"]
    for a in assets[:50]:
        meta = [a.folder.name if a.folder else "Unfiled", a.phase or "general"]
        if a.captured_at:
            meta.append(f"{a.captured_at:%Y-%m-%d}")
        if a.latitude is not None:
            meta.append(f"{a.latitude:.4f}, {a.longitude:.4f}")
        lines.append(f"- [{a.original_name}]({a.secure_url}) · {' · '.join(meta)}")
    if len(assets) > 50:
        lines.append(f"- …and {len(assets) - 50} more in the Media Library")

    report = ImpactReport(
        user_id=user.id,
        title=req.title,
        project_category=scope,
        markdown_content="\n".join(lines),
        key_metrics=key_metrics,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return _serialize(report)


@router.get("")
async def list_reports(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ImpactReport).where(ImpactReport.user_id == user.id).order_by(ImpactReport.created_at.desc()))
    return [_serialize(r) for r in res.scalars().all()]


@router.delete("/{report_id}")
async def delete_report(report_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = (await db.execute(select(ImpactReport).where(ImpactReport.id == report_id, ImpactReport.user_id == user.id))).scalars().first()
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    await db.delete(r)
    await db.commit()
    return {"status": "success"}
