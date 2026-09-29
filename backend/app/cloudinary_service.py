"""
Cloudinary integration.

- By default every user stores media in the platform's Cloudinary account (from .env).
  Users may optionally connect their own account in Settings; then theirs is used.
- Every user gets a private root folder: <CLOUDINARY_ROOT_FOLDER>/<name-slug>-<user id>.
  All uploads and user-created folders live inside it.
- Credentials are passed per call (never via global config) so concurrent users don't clash.
"""
import asyncio
import datetime
import io
import os
import re
import uuid
from typing import Any, Dict, List, Optional

import cloudinary
import cloudinary.api
import cloudinary.uploader
from PIL import ExifTags, Image

from app.config import settings

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ROOT_FOLDER = (os.getenv("CLOUDINARY_ROOT_FOLDER") or "cloudinary_impact").strip("/ ")


class CloudinaryError(Exception):
    pass


# --------------------------------------------------------------------------- credentials

def system_credentials() -> Optional[Dict[str, str]]:
    name = (settings.CLOUDINARY_CLOUD_NAME or "").strip()
    key = (settings.CLOUDINARY_API_KEY or "").strip()
    secret = (settings.CLOUDINARY_API_SECRET or "").strip()
    if name and key and secret:
        return {"cloud_name": name, "api_key": key, "api_secret": secret}
    m = re.match(r"cloudinary://([^:]+):([^@]+)@(.+)$", (settings.CLOUDINARY_URL or "").strip())
    if m:
        return {"cloud_name": m.group(3), "api_key": m.group(1), "api_secret": m.group(2)}
    return None


def resolve_credentials(user_settings: Optional[Any] = None) -> Optional[Dict[str, str]]:
    """User's own Cloudinary account if fully configured, otherwise the platform account."""
    if user_settings and user_settings.cloudinary_cloud_name and user_settings.cloudinary_api_key and user_settings.cloudinary_api_secret:
        return {
            "cloud_name": user_settings.cloudinary_cloud_name.strip(),
            "api_key": user_settings.cloudinary_api_key.strip(),
            "api_secret": user_settings.cloudinary_api_secret.strip(),
        }
    return system_credentials()


# --------------------------------------------------------------------------- folders

def slugify(text: str, max_len: int = 60) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").strip().lower()).strip("-")
    return (s or "folder")[:max_len]


def folder_segment(name: str) -> str:
    """Folder name safe for a Cloudinary path segment (keeps it readable)."""
    s = re.sub(r"[^\w\- ]+", "", (name or "").strip()).strip()
    s = re.sub(r"\s+", " ", s)
    return (s or "Untitled")[:80]


def user_root_folder(user: Any) -> str:
    base = slugify(user.full_name or user.email.split("@")[0], 40)
    return f"{ROOT_FOLDER}/{base}-{user.id}"


async def ensure_folder(path: str, creds: Optional[Dict[str, str]]) -> bool:
    if not creds:
        return False
    try:
        await asyncio.to_thread(cloudinary.api.create_folder, path, **creds)
        return True
    except Exception as e:
        # Already exists is fine
        if "exist" in str(e).lower():
            return True
        print(f"[Cloudinary] create_folder({path}) failed: {e}")
        return False


async def list_subfolders(path: str, creds: Optional[Dict[str, str]]) -> List[Dict[str, str]]:
    if not creds:
        return []
    try:
        res = await asyncio.to_thread(cloudinary.api.subfolders, path, max_results=500, **creds)
        return [{"name": f.get("name"), "path": f.get("path")} for f in res.get("folders", [])]
    except Exception as e:
        if "can't find folder" in str(e).lower() or "not found" in str(e).lower():
            return []
        raise CloudinaryError(str(e))


async def list_folder_resources(path: str, creds: Optional[Dict[str, str]], max_results: int = 500) -> List[Dict[str, Any]]:
    """Assets directly inside a folder. Works for both dynamic and fixed folder mode accounts."""
    if not creds:
        return []

    def _fetch():
        try:
            return cloudinary.api.resources_by_asset_folder(path, max_results=max_results, tags=True, **creds).get("resources", [])
        except Exception:
            # Fixed folder mode: folder is a public_id prefix
            out = cloudinary.api.resources(type="upload", prefix=f"{path}/", max_results=max_results, tags=True, **creds).get("resources", [])
            return [r for r in out if r.get("public_id", "").rsplit("/", 1)[0] == path]

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        raise CloudinaryError(str(e))


# --------------------------------------------------------------------------- metadata

def _get_gps_coordinates(exif_data: dict):
    try:
        gps_info = exif_data.get("GPSInfo")
        if not gps_info:
            return None, None

        def _deg(v):
            d, m, s = v
            return float(d) + float(m) / 60.0 + float(s) / 3600.0

        lat = lon = None
        if 2 in gps_info and 1 in gps_info:
            lat = _deg(gps_info[2]) * (1 if gps_info[1] == "N" else -1)
        if 4 in gps_info and 3 in gps_info:
            lon = _deg(gps_info[4]) * (1 if gps_info[3] == "E" else -1)
        return lat, lon
    except Exception:
        return None, None


def extract_image_metadata(file_bytes: bytes) -> Dict[str, Any]:
    """Real EXIF only: capture time and GPS stay None when the file doesn't carry them."""
    meta: Dict[str, Any] = {"width": 0, "height": 0, "format": None, "captured_at": None, "latitude": None, "longitude": None}
    try:
        image = Image.open(io.BytesIO(file_bytes))
        meta["width"], meta["height"] = image.width, image.height
        meta["format"] = (image.format or "").lower() or None
        exif = image._getexif() if hasattr(image, "_getexif") else None
        if exif:
            data = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
            dt = data.get("DateTimeOriginal") or data.get("DateTime")
            if dt:
                try:
                    meta["captured_at"] = datetime.datetime.strptime(str(dt).strip(), "%Y:%m:%d %H:%M:%S")
                except Exception:
                    pass
            meta["latitude"], meta["longitude"] = _get_gps_coordinates(data)
    except Exception:
        pass
    return meta


def delivery_urls(public_id: str, resource_type: str, creds: Dict[str, str]) -> Dict[str, str]:
    """Optimized delivery (f_auto, q_auto) + thumbnail. The stored original is never altered."""
    opts = {"cloud_name": creds["cloud_name"], "secure": True, "resource_type": resource_type}
    thumb = cloudinary.CloudinaryImage(public_id).build_url(
        transformation=[{"width": 600, "height": 450, "crop": "fill", "gravity": "auto", "fetch_format": "auto", "quality": "auto"}],
        **({**opts, "resource_type": "video", "format": "jpg"} if resource_type == "video" else opts),
    )
    optimized = cloudinary.CloudinaryImage(public_id).build_url(
        transformation=[{"fetch_format": "auto", "quality": "auto"}], **opts
    )
    return {"thumbnail_url": thumb, "optimized_url": optimized}


# --------------------------------------------------------------------------- upload / delete

async def upload_asset(
    file_bytes: bytes,
    filename: str,
    creds: Optional[Dict[str, str]],
    folder_path: str,
    custom_tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Uploads the original file into `folder_path`. Raises CloudinaryError if Cloudinary is
    configured but the upload fails. Only when no Cloudinary account exists at all does it
    fall back to local disk.
    """
    meta = extract_image_metadata(file_bytes)
    tags = [t.strip() for t in (custom_tags or []) if t and t.strip()]

    if creds:
        def _upload():
            return cloudinary.uploader.upload(
                file_bytes,
                folder=folder_path,              # fixed mode: public_id prefix; dynamic mode: asset folder
                asset_folder=folder_path,        # dynamic folder mode (ignored by fixed-mode accounts)
                use_filename=True,
                unique_filename=True,
                filename_override=filename,
                tags=tags or None,
                resource_type="auto",
                media_metadata=True,
                context={"original_filename": filename[:200]},
                **creds,
            )

        try:
            r = await asyncio.to_thread(_upload)
        except Exception as e:
            raise CloudinaryError(f"Cloudinary upload failed: {e}")

        rtype = r.get("resource_type", "image")
        urls = delivery_urls(r["public_id"], rtype, creds)
        return {
            "public_id": r["public_id"],
            "secure_url": r["secure_url"],          # untouched original (traceability)
            "thumbnail_url": urls["thumbnail_url"],
            "optimized_url": urls["optimized_url"],
            "format": r.get("format") or meta["format"],
            "resource_type": rtype,
            "bytes": r.get("bytes", len(file_bytes)),
            "width": r.get("width") or meta["width"],
            "height": r.get("height") or meta["height"],
            "captured_at": meta["captured_at"],
            "latitude": meta["latitude"],
            "longitude": meta["longitude"],
            "folder": r.get("asset_folder") or folder_path,
            "cloudinary_tags": r.get("tags") or tags,
            "cloud_name": creds["cloud_name"],
            "is_cloudinary": True,
        }

    # No Cloudinary account configured anywhere: keep the file locally
    unique = f"{uuid.uuid4().hex[:12]}_{re.sub(r'[^A-Za-z0-9._-]', '_', filename)}"
    with open(os.path.join(UPLOAD_DIR, unique), "wb") as f:
        f.write(file_bytes)
    url = f"/static/uploads/{unique}"
    return {
        "public_id": f"local_{unique}",
        "secure_url": url,
        "thumbnail_url": url,
        "optimized_url": url,
        "format": meta["format"],
        "resource_type": "image",
        "bytes": len(file_bytes),
        "width": meta["width"],
        "height": meta["height"],
        "captured_at": meta["captured_at"],
        "latitude": meta["latitude"],
        "longitude": meta["longitude"],
        "folder": folder_path,
        "cloudinary_tags": tags,
        "cloud_name": None,
        "is_cloudinary": False,
    }


async def delete_remote_asset(public_id: Optional[str], resource_type: str, creds: Optional[Dict[str, str]]) -> None:
    if not public_id:
        return
    if public_id.startswith("local_"):
        p = os.path.join(UPLOAD_DIR, public_id[len("local_"):])
        if os.path.exists(p):
            os.remove(p)
        return
    if creds:
        try:
            await asyncio.to_thread(cloudinary.uploader.destroy, public_id, resource_type=resource_type or "image", invalidate=True, **creds)
        except Exception as e:
            print(f"[Cloudinary] destroy({public_id}) failed: {e}")
