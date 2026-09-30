"""Per-user storage context: which Cloudinary account to use and the user's private root folder."""
import re
from dataclasses import dataclass
from typing import Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserSettings
from app.cloudinary_service import (
    CloudinaryError, ai_image_url, resolve_credentials, system_credentials, user_root_folder, ensure_folder, folder_segment,
)
from app.llm_client import load_asset_bytes


@dataclass
class StorageContext:
    user: User
    settings: Optional[UserSettings]
    creds: Dict[str, str]
    root: str
    mode: str  # "own" | "platform"

    def folder_path(self, folder_name: str) -> str:
        return f"{self.root}/{folder_segment(folder_name)}"


async def get_storage(db: AsyncSession, user: User) -> StorageContext:
    st = (await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))).scalars().first()
    creds = resolve_credentials(st)
    if not creds:
        raise CloudinaryError("Cloudinary is not configured on this server.")
    own = bool(st and st.cloudinary_cloud_name and st.cloudinary_api_key and st.cloudinary_api_secret)

    if not user.cloudinary_folder:
        # Existing accounts created before per-user folders: assign one now
        user.cloudinary_folder = user_root_folder(user)
        await db.commit()
        await ensure_folder(user.cloudinary_folder, creds)

    return StorageContext(
        user=user, settings=st, creds=creds, root=user.cloudinary_folder,
        mode="own" if own else "platform",
    )


async def ai_image_bytes(public_id: str, secure_url: str, ctx: "StorageContext") -> bytes:
    """Downloads the AI-ready JPG (max 1600px) that Cloudinary builds from an original."""
    creds = creds_for_url(secure_url, ctx)
    if not creds:
        raise CloudinaryError("This photo is stored in a Cloudinary account that is no longer connected.")
    return await load_asset_bytes(ai_image_url(public_id, creds))


def creds_for_url(url: str, ctx: StorageContext) -> Optional[Dict[str, str]]:
    """Picks the account that actually holds an asset (it may predate a switch to/from the user's own account)."""
    m = re.search(r"res\.cloudinary\.com/([^/]+)/", url or "")
    if not m:
        return ctx.creds
    cloud = m.group(1)
    if ctx.creds and ctx.creds["cloud_name"] == cloud:
        return ctx.creds
    sys = system_credentials()
    if sys and sys["cloud_name"] == cloud:
        return sys
    return None
