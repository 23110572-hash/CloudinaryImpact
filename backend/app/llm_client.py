"""
Unified multi-provider LLM client.

Supports Gemini, OpenAI, OpenRouter, Groq (OpenAI-compatible) and Anthropic Claude,
with optional image inputs. Returns plain text, or raises LLMError on failure so
callers can fall back gracefully.
"""
import base64
import json
import os
from typing import List, Optional

import httpx

from app.cloudinary_service import UPLOAD_DIR


class LLMError(Exception):
    pass


OPENAI_COMPATIBLE_BASE = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
}


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("utf-8")


def _guess_mime(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:3] == b"GIF":
        return "image/gif"
    return "image/jpeg"


async def load_asset_bytes(url: Optional[str]) -> Optional[bytes]:
    """Loads image bytes from a Cloudinary/remote URL or the local fallback upload dir."""
    if not url:
        return None
    try:
        if url.startswith("/static/uploads/"):
            path = os.path.join(UPLOAD_DIR, os.path.basename(url))
            if os.path.exists(path):
                with open(path, "rb") as f:
                    return f.read()
            return None
        if url.startswith("http"):
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    return resp.content
    except Exception as e:
        print(f"[llm_client] Could not load asset bytes from {url}: {e}")
    return None


async def call_llm(
    provider: str,
    model: str,
    api_key: str,
    system: str,
    user_text: str,
    images: Optional[List[bytes]] = None,
    json_mode: bool = False,
    history: Optional[List[dict]] = None,
    temperature: float = 0.3,
    timeout: float = 45.0,
) -> str:
    """Calls the given provider and returns the assistant text."""
    provider = (provider or "").lower()
    images = [i for i in (images or []) if i]
    history = history or []

    async with httpx.AsyncClient(timeout=timeout) as client:
        # ---------------- Gemini ----------------
        if provider == "gemini":
            contents = []
            for h in history:
                role = "model" if h.get("role") == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": h.get("content", "")}]})
            parts = [{"text": user_text}]
            for img in images:
                parts.append({"inline_data": {"mime_type": _guess_mime(img), "data": _b64(img)}})
            contents.append({"role": "user", "parts": parts})
            payload = {
                "system_instruction": {"parts": [{"text": system}]},
                "contents": contents,
                "generationConfig": {"temperature": temperature},
            }
            if json_mode:
                payload["generationConfig"]["response_mime_type"] = "application/json"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            res = await client.post(url, json=payload, headers={"x-goog-api-key": api_key})
            if res.status_code != 200:
                raise LLMError(f"Gemini {res.status_code}: {res.text[:200]}")
            data = res.json()
            try:
                return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
            except (KeyError, IndexError) as e:
                raise LLMError(f"Gemini returned no content: {e}")

        # ---------------- Anthropic ----------------
        if provider == "anthropic":
            messages = [
                {"role": "assistant" if h.get("role") == "assistant" else "user", "content": h.get("content", "")}
                for h in history
            ]
            content = []
            for img in images:
                content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": _guess_mime(img), "data": _b64(img)},
                })
            text = user_text + ("\n\nRespond with a single valid JSON object only." if json_mode else "")
            content.append({"type": "text", "text": text})
            messages.append({"role": "user", "content": content})
            res = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 2048,
                    "system": system,
                    "temperature": temperature,
                    "messages": messages,
                },
            )
            if res.status_code != 200:
                raise LLMError(f"Anthropic {res.status_code}: {res.text[:200]}")
            data = res.json()
            return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")

        # ---------------- OpenAI-compatible ----------------
        if provider in OPENAI_COMPATIBLE_BASE:
            messages = [{"role": "system", "content": system}]
            for h in history:
                messages.append({
                    "role": "assistant" if h.get("role") == "assistant" else "user",
                    "content": h.get("content", ""),
                })
            if images:
                content = [{"type": "text", "text": user_text}]
                for img in images:
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{_guess_mime(img)};base64,{_b64(img)}"},
                    })
                messages.append({"role": "user", "content": content})
            else:
                messages.append({"role": "user", "content": user_text})

            payload = {"model": model, "messages": messages, "temperature": temperature}
            if json_mode:
                payload["response_format"] = {"type": "json_object"}
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            if provider == "openrouter":
                headers["HTTP-Referer"] = "http://localhost:3000"
                headers["X-Title"] = "Cloudinary Impact"
            res = await client.post(f"{OPENAI_COMPATIBLE_BASE[provider]}/chat/completions", headers=headers, json=payload)
            if res.status_code != 200:
                raise LLMError(f"{provider} {res.status_code}: {res.text[:200]}")
            data = res.json()
            try:
                return data["choices"][0]["message"]["content"] or ""
            except (KeyError, IndexError) as e:
                raise LLMError(f"{provider} returned no content: {e}")

    raise LLMError(f"Unsupported provider '{provider}'")


def parse_json_response(text: str) -> dict:
    """Parses JSON from an LLM reply, tolerating ```json fences and leading prose."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lower().startswith("json"):
            t = t[4:]
    try:
        return json.loads(t)
    except Exception:
        start, end = t.find("{"), t.rfind("}")
        if start != -1 and end > start:
            return json.loads(t[start:end + 1])
        raise
