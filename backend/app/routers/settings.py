from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import User, UserSettings
from app.auth import get_current_user
from app.cloudinary_service import resolve_credentials, system_credentials
from app.vision_engine import test_provider_key, SUPPORTED_PROVIDERS, SUPPORTED_PROVIDER_IDS, system_ai_status

router = APIRouter(prefix="/settings", tags=["Settings"])


class SettingsUpdateRequest(BaseModel):
    llm_mode: Optional[str] = None  # "system" | "byok"
    active_provider: Optional[str] = None
    active_model: Optional[str] = None
    api_keys: Optional[Dict[str, str]] = None
    remove_keys: Optional[list] = None
    cloudinary_cloud_name: Optional[str] = None
    cloudinary_api_key: Optional[str] = None
    cloudinary_api_secret: Optional[str] = None
    clear_cloudinary: Optional[bool] = False


class TestKeyRequest(BaseModel):
    provider: str
    api_key: Optional[str] = None  # empty -> test the saved key
    model: Optional[str] = None


def _mask(k: Optional[str]) -> str:
    if not k:
        return ""
    return f"{k[:4]}…{k[-4:]}" if len(k) > 10 else "••••••••"


async def _load(db: AsyncSession, user: User) -> UserSettings:
    res = await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    st = res.scalars().first()
    if not st:
        st = UserSettings(user_id=user.id, llm_mode="system", active_provider="openrouter",
                          active_model="google/gemini-2.5-flash", api_keys={})
        db.add(st)
        await db.commit()
        await db.refresh(st)
    return st


def _serialize(st: UserSettings, root_folder: Optional[str] = None) -> dict:
    keys = st.api_keys or {}
    system_cloudinary = bool(system_credentials())
    return {
        "llm_mode": st.llm_mode or "system",
        "active_provider": st.active_provider if st.active_provider in SUPPORTED_PROVIDER_IDS else "openrouter",
        "active_model": st.active_model or "",
        "masked_keys": {p: _mask(k) for p, k in keys.items() if k},
        "supported_providers": SUPPORTED_PROVIDERS,
        "system_ai": system_ai_status(),
        "cloudinary": {
            "configured": bool(st.cloudinary_cloud_name and st.cloudinary_api_key and st.cloudinary_api_secret),
            "cloud_name": st.cloudinary_cloud_name or "",
            "masked_api_key": _mask(st.cloudinary_api_key),
            "system_configured": system_cloudinary,
            "root_folder": root_folder,
        },
    }


@router.get("")
async def get_settings(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return _serialize(await _load(db, user), user.cloudinary_folder)


@router.put("")
async def update_settings(req: SettingsUpdateRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    st = await _load(db, user)

    if req.llm_mode is not None:
        if req.llm_mode not in ("system", "byok"):
            raise HTTPException(status_code=400, detail="llm_mode must be 'system' or 'byok'")
        st.llm_mode = req.llm_mode
    if req.active_provider is not None:
        if req.active_provider not in SUPPORTED_PROVIDER_IDS:
            raise HTTPException(status_code=400, detail=f"Unsupported provider '{req.active_provider}'")
        st.active_provider = req.active_provider
    if req.active_model is not None and req.active_model.strip():
        st.active_model = req.active_model.strip()[:128]

    keys = dict(st.api_keys or {})
    for prov, val in (req.api_keys or {}).items():
        if prov in SUPPORTED_PROVIDER_IDS and val and val.strip() and "•" not in val and "…" not in val:
            keys[prov] = val.strip()
    for prov in (req.remove_keys or []):
        keys.pop(prov, None)
    st.api_keys = keys

    # BYOK needs a key for the chosen provider, otherwise every AI call silently falls back
    if st.llm_mode == "byok" and not keys.get(st.active_provider):
        raise HTTPException(status_code=400, detail="Add an API key for the selected provider, or switch to System Managed.")

    if req.clear_cloudinary:
        st.cloudinary_cloud_name = None
        st.cloudinary_api_key = None
        st.cloudinary_api_secret = None
    else:
        if req.cloudinary_cloud_name is not None and req.cloudinary_cloud_name.strip():
            st.cloudinary_cloud_name = req.cloudinary_cloud_name.strip()
        if req.cloudinary_api_key and req.cloudinary_api_key.strip() and "•" not in req.cloudinary_api_key:
            st.cloudinary_api_key = req.cloudinary_api_key.strip()
        if req.cloudinary_api_secret and req.cloudinary_api_secret.strip() and "•" not in req.cloudinary_api_secret:
            st.cloudinary_api_secret = req.cloudinary_api_secret.strip()
        partial = [st.cloudinary_cloud_name, st.cloudinary_api_key, st.cloudinary_api_secret]
        if any(partial) and not all(partial):
            raise HTTPException(status_code=400, detail="Cloudinary needs all three: Cloud Name, API Key and API Secret.")

    await db.commit()
    await db.refresh(st)
    return {"status": "success", "message": "Settings saved", "settings": _serialize(st, user.cloudinary_folder)}


@router.post("/test-key")
async def test_key(req: TestKeyRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    key = (req.api_key or "").strip()
    if not key or "•" in key or "…" in key:
        st = await _load(db, user)
        key = (st.api_keys or {}).get(req.provider, "")
        if not key:
            return {"valid": False, "message": "Enter an API key first."}
    return await test_provider_key(req.provider, key, req.model)


@router.post("/test-cloudinary")
async def test_cloudinary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Pings Cloudinary with the account this user's uploads go to (own account, else platform)."""
    import asyncio
    import cloudinary.api
    st = await _load(db, user)
    creds = resolve_credentials(st)
    if not creds:
        return {"valid": False, "message": "No Cloudinary account configured."}
    try:
        await asyncio.to_thread(cloudinary.api.ping, **creds)
        return {"valid": True, "message": f"Connected to Cloudinary ({creds['cloud_name']})."}
    except Exception as e:
        return {"valid": False, "message": f"Cloudinary rejected the credentials: {str(e)[:150]}"}

