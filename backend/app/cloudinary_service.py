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
import cloudinary.utils
from PIL import ExifTags, Image

from app.config import settings

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


async def ensure_folder(path: str, creds: Dict[str, str]) -> None:
    """Creates the folder in Cloudinary. An existing folder is fine; anything else raises CloudinaryError."""
    try:
        await asyncio.to_thread(cloudinary.api.create_folder, path, **creds)
    except Exception as e:
        if "exist" in str(e).lower():
            return
        raise CloudinaryError(f"Couldn't create folder '{path}' in Cloudinary: {e}")


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


_DMS = re.compile(r"(\d+(?:\.\d+)?)\s*deg\s*(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)\"?\s*([NSEW])?", re.I)


def _cld_coord(value: Any, ref: Any) -> Optional[float]:
    """Parses Cloudinary/exiftool coordinates like `12 deg 58' 3.60" N` or `12.9677`."""
    if value is None:
        return None
    s = str(value).strip()
    m = _DMS.search(s)
    if m:
        deg = float(m.group(1)) + float(m.group(2)) / 60 + float(m.group(3)) / 3600
        hemi = (m.group(4) or str(ref or "")[:1]).upper()
    else:
        try:
            deg = float(s.split()[0])
        except (ValueError, IndexError):
            return None
        hemi = str(ref or "")[:1].upper()
    return -deg if hemi in ("S", "W") else deg


def exif_from_cloudinary(upload_response: Dict[str, Any]) -> Dict[str, Any]:
    """
    Capture time + GPS from the EXIF Cloudinary returns on upload (media_metadata=True).
    Used for formats Pillow can't open, e.g. iPhone HEIC photos.
    """
    md = upload_response.get("image_metadata") or upload_response.get("media_metadata") or {}
    out: Dict[str, Any] = {"captured_at": None, "latitude": None, "longitude": None}
    dt = md.get("DateTimeOriginal") or md.get("CreateDate")
    if dt:
        try:
            out["captured_at"] = datetime.datetime.strptime(str(dt).strip()[:19], "%Y:%m:%d %H:%M:%S")
        except ValueError:
            pass
    lat = _cld_coord(md.get("GPSLatitude"), md.get("GPSLatitudeRef"))
    lon = _cld_coord(md.get("GPSLongitude"), md.get("GPSLongitudeRef"))
    if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
        out["latitude"], out["longitude"] = lat, lon
    return out


def ai_image_url(public_id: str, creds: Dict[str, str]) -> str:
    """
    What the AI model receives: a JPG no larger than 1600px built by Cloudinary from the original.
    Works for HEIC and huge files (providers reject >~20 MB and most don't accept HEIC).
    """
    return cloudinary.CloudinaryImage(public_id).build_url(
        transformation=[{"width": 1600, "height": 1600, "crop": "limit"}, {"quality": "auto"}],
        format="jpg", secure=True, cloud_name=creds["cloud_name"],
    )


def layer_id(public_id: str) -> str:
    """Public ID for use inside an l_ overlay: slashes become colons, each part URL-encoded (spaces in folder names)."""
    from urllib.parse import quote
    return ":".join(quote(part, safe="-_.~").replace("%2C", "%252C") for part in public_id.split("/"))


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
    """Uploads the untouched original into `folder_path`. Raises CloudinaryError on any failure."""
    if not creds:
        raise CloudinaryError("Cloudinary is not configured on this server.")
    meta = extract_image_metadata(file_bytes)
    tags = [t.strip() for t in (custom_tags or []) if t and t.strip()]

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
    if meta["format"] is None:
        # Pillow couldn't open the file (e.g. HEIC): read the EXIF Cloudinary extracted instead
        meta.update(exif_from_cloudinary(r))
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
    }


async def delete_remote_asset(public_id: Optional[str], resource_type: str, creds: Optional[Dict[str, str]]) -> None:
    """Deletes the original from Cloudinary. Raises CloudinaryError so the app and Cloudinary never drift apart."""
    if not public_id:
        return
    if not creds:
        raise CloudinaryError("No Cloudinary account holds this asset.")
    try:
        await asyncio.to_thread(cloudinary.uploader.destroy, public_id, resource_type=resource_type or "image", invalidate=True, **creds)
    except Exception as e:
        raise CloudinaryError(f"Cloudinary delete failed: {e}")


# --------------------------------------------------------------------------- studio renders

def _text_layer(text: str, size: int, bold: bool = True) -> Dict[str, Any]:
    return {"font_family": "Arial", "font_size": size, "font_weight": "bold" if bold else "normal", "text": text}


def social_card_url(public_id: str, creds: Dict[str, str], headline: str, caption: str, fmt: str) -> str:
    """
    Ready-to-post image built with Cloudinary transformations (no AI-generated pixels).
    square = 1080x1080 smart crop; story = 1080x1920 photo fitted on a blurred copy of itself.
    """
    if fmt == "story":
        W, H = 1080, 1920
        base = [
            {"width": W, "height": H, "crop": "fill", "gravity": "auto"},
            {"effect": "blur:2000"},
            {"effect": "brightness:-15"},
            # the sharp original, fitted (not cropped) in the middle
            {"overlay": layer_id(public_id), "width": W, "height": 1350, "crop": "fit"},
            {"flags": "layer_apply", "gravity": "center"},
        ]
    else:
        W, H = 1080, 1080
        base = [{"width": W, "height": H, "crop": "fill", "gravity": "auto"}]

    # Text sits on its own solid box (b_ on the text layer) so it stays readable on any photo:
    # headline at the top, caption at the bottom, wrapped to the card width with c_fit.
    text = [
        {"overlay": _text_layer(headline[:60], 60), "color": "white", "background": "rgb:0f172a", "width": W - 120, "crop": "fit"},
        {"flags": "layer_apply", "gravity": "north", "y": 150 if fmt == "story" else 60},
    ]
    if caption:
        text += [
            {"overlay": _text_layer(caption[:110], 34, bold=False), "color": "white", "background": "rgb:0369a1", "width": W - 160, "crop": "fit"},
            {"flags": "layer_apply", "gravity": "south", "y": 150 if fmt == "story" else 60},
        ]
    text += [{"fetch_format": "auto"}, {"quality": "auto"}]
    return cloudinary.CloudinaryImage(public_id).build_url(transformation=base + text, secure=True, cloud_name=creds["cloud_name"])


def before_after_url(before_id: str, after_id: str, creds: Dict[str, str], label_before: str = "BEFORE", label_after: str = "AFTER") -> str:
    """Side-by-side 1600x800 image: before on the left, after on the right, both labelled."""
    half = 800
    tr = [
        {"width": half, "height": half, "crop": "fill", "gravity": "auto"},
        {"overlay": _text_layer(label_before, 40), "color": "white", "background": "rgb:b45309"},
        {"flags": "layer_apply", "gravity": "north_west", "x": 24, "y": 24},
        {"overlay": layer_id(after_id)},
        {"width": half, "height": half, "crop": "fill", "gravity": "auto"},
        {"flags": "layer_apply", "gravity": "west", "x": half},
        {"overlay": _text_layer(label_after, 40), "color": "white", "background": "rgb:047857"},
        {"flags": "layer_apply", "gravity": "north_east", "x": 24, "y": 24},
        {"fetch_format": "auto"},
        {"quality": "auto"},
    ]
    return cloudinary.CloudinaryImage(before_id).build_url(transformation=tr, secure=True, cloud_name=creds["cloud_name"])


async def create_reel(image_urls: List[str], creds: Dict[str, str], folder_path: str) -> Dict[str, str]:
    """Combines photos into one animated reel with the Upload API `multi` method. Returns MP4 + GIF URLs."""
    if len(image_urls) < 2:
        raise CloudinaryError("A reel needs at least 2 photos.")
    target = f"{folder_path}/reel-{uuid.uuid4().hex[:10]}"

    def _multi():
        return cloudinary.uploader.multi(
            urls=image_urls[:20],
            public_id=target,
            transformation=[{"width": 1080, "height": 1080, "crop": "fill", "gravity": "auto"}, {"delay": 1600}],
            **creds,
        )

    try:
        r = await asyncio.to_thread(_multi)
    except Exception as e:
        raise CloudinaryError(f"Cloudinary couldn't build the reel: {e}")
    pid = r.get("public_id") or target
    # `multi` output is delivered with the "multi" delivery type; changing the extension to .mp4 converts it to video
    opts = {"type": "multi", "secure": True, "cloud_name": creds["cloud_name"]}
    gif = r.get("secure_url") or cloudinary.CloudinaryImage(pid).build_url(format="gif", **opts)
    mp4 = cloudinary.CloudinaryImage(pid).build_url(format="mp4", **opts)
    return {"public_id": pid, "gif_url": gif, "mp4_url": mp4}


def photo_pack_url(public_ids: List[str], creds: Dict[str, str], name: str) -> str:
    """Signed, 1-hour ZIP download of the untouched originals, built on the fly by Cloudinary."""
    if not public_ids:
        raise CloudinaryError("There are no photos to pack.")
    return cloudinary.utils.download_zip_url(
        public_ids=public_ids[:1000],
        resource_type="image",
        target_public_id=slugify(name, 80),
        use_original_filename=True,
        allow_missing=True,
        **creds,
    )
