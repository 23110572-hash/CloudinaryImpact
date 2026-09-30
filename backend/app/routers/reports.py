from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import ImpactReport, User

router = APIRouter(prefix="/reports", tags=["Impact Reports"])


def serialize_creation(r: ImpactReport) -> dict:
    return {
        "id": r.id,
        "title": r.title,
        "kind": r.kind or "document",
        "folder_id": r.folder_id,
        "category": r.project_category,
        "markdown_content": r.markdown_content,
        "key_metrics": r.key_metrics or [],
        "payload": r.payload or {},
        "created_at": r.created_at,
    }


@router.get("")
async def list_reports(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ImpactReport).where(ImpactReport.user_id == user.id).order_by(ImpactReport.created_at.desc()))
    return [serialize_creation(r) for r in res.scalars().all()]


@router.delete("/{report_id}")
async def delete_report(report_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = (await db.execute(select(ImpactReport).where(ImpactReport.id == report_id, ImpactReport.user_id == user.id))).scalars().first()
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    await db.delete(r)
    await db.commit()
    return {"status": "success"}
