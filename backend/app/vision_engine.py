import httpx
from typing import Dict, Any, List, Optional, Tuple

from app.config import settings
from app.llm_client import call_llm, parse_json_response, LLMError

# Single source of truth for providers exposed in Settings. Model lists are suggestions;
# users can type any model id their provider supports.
SUPPORTED_PROVIDERS: List[Dict[str, Any]] = [
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "key_hint": "sk-or-...",
        "models": ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.5", "openai/gpt-4o", "openai/gpt-4o-mini"],
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "key_hint": "sk-...",
        "models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"],
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "key_hint": "AIza...",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    },
    {
        "id": "anthropic",
        "name": "Anthropic Claude",
        "key_hint": "sk-ant-...",
        "models": ["claude-sonnet-4-5", "claude-3-5-haiku-latest", "claude-opus-4-1"],
    },
    {
        "id": "groq",
        "name": "Groq",
        "key_hint": "gsk_...",
        "models": ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"],
    },
]
SUPPORTED_PROVIDER_IDS = {p["id"] for p in SUPPORTED_PROVIDERS}

SYSTEM_DEFAULT_MODELS = {
    "gemini": "gemini-2.5-flash",
    "openrouter": "google/gemini-2.5-flash",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-latest",
    "groq": "meta-llama/llama-4-scout-17b-16e-instruct",
}


class AIError(Exception):
    """Raised when no AI model is connected or the model call fails. Surfaced to the user as an error."""


def _system_keys() -> List[Tuple[str, str]]:
    return [
        ("gemini", settings.SYSTEM_GEMINI_API_KEY or ""),
        ("openrouter", settings.SYSTEM_OPENROUTER_API_KEY or ""),
        ("openai", settings.SYSTEM_OPENAI_API_KEY or ""),
        ("anthropic", settings.SYSTEM_ANTHROPIC_API_KEY or ""),
        ("groq", settings.SYSTEM_GROQ_API_KEY or ""),
    ]


def system_ai_status() -> Dict[str, Any]:
    """Tells the UI whether System Managed mode has a live model configured."""
    for prov, key in _system_keys():
        if key.strip():
            return {"live": True, "provider": prov, "model": SYSTEM_DEFAULT_MODELS[prov]}
    return {"live": False, "provider": None, "model": None}


async def test_provider_key(provider: str, api_key: str, model: Optional[str] = None) -> Dict[str, Any]:
    """Checks whether an API key is accepted by the provider."""
    if not api_key or len(api_key.strip()) < 8:
        return {"valid": False, "message": "Key is empty or too short."}

    provider = provider.lower()
    key = api_key.strip()
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            if provider == "gemini":
                res = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    headers={"x-goog-api-key": key},
                )
            elif provider == "groq":
                res = await client.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {key}"})
            elif provider == "openai":
                res = await client.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {key}"})
            elif provider == "anthropic":
                res = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                )
            elif provider == "openrouter":
                res = await client.get("https://openrouter.ai/api/v1/auth/key", headers={"Authorization": f"Bearer {key}"})
            else:
                return {"valid": False, "message": f"Unsupported provider '{provider}'."}

            name = next((p["name"] for p in SUPPORTED_PROVIDERS if p["id"] == provider), provider)
            if res.status_code == 200:
                return {"valid": True, "message": f"{name} key verified."}
            if res.status_code in (401, 403):
                return {"valid": False, "message": f"{name} rejected this key ({res.status_code})."}
            return {"valid": False, "message": f"{name} error {res.status_code}: {res.text[:120]}"}
    except Exception as e:
        return {"valid": False, "message": f"Could not reach provider: {e}"}


class VisionEngine:
    @staticmethod
    def get_effective_provider_and_key(user_settings: Optional[Any] = None) -> Tuple[str, str, str]:
        """Returns (provider, model, key). BYOK wins when a key is saved; otherwise the platform key. Raises AIError if neither exists."""
        if user_settings and user_settings.llm_mode == "byok":
            prov = (user_settings.active_provider or "").lower()
            keys = user_settings.api_keys or {}
            key = (keys.get(prov) or "").strip()
            if prov in SUPPORTED_PROVIDER_IDS and len(key) > 8:
                model = user_settings.active_model or SYSTEM_DEFAULT_MODELS.get(prov, "")
                return prov, model, key

        for prov, key in _system_keys():
            if key.strip():
                return prov, SYSTEM_DEFAULT_MODELS[prov], key.strip()

        raise AIError("No AI model is connected. Add an AI key in Settings.")

    @classmethod
    async def generate(
        cls,
        system: str,
        user_text: str,
        user_settings: Optional[Any] = None,
        images: Optional[List[bytes]] = None,
        json_mode: bool = False,
        history: Optional[List[dict]] = None,
    ) -> str:
        """Runs the active LLM and returns its text. Raises AIError on any failure."""
        prov, model, key = cls.get_effective_provider_and_key(user_settings)
        try:
            text = await call_llm(prov, model, key, system, user_text, images=images, json_mode=json_mode, history=history)
        except (LLMError, httpx.HTTPError) as e:
            print(f"[VisionEngine] {prov}/{model} call failed: {e}")
            raise AIError("The AI model didn't respond. Please try again.") from e
        if not (text or "").strip():
            raise AIError("The AI model returned an empty answer. Please try again.")
        return text

    @classmethod
    async def generate_json(cls, system: str, user_text: str, user_settings: Optional[Any] = None, images: Optional[List[bytes]] = None, history: Optional[List[dict]] = None) -> Dict[str, Any]:
        text = await cls.generate(system, user_text, user_settings, images=images, json_mode=True, history=history)
        try:
            data = parse_json_response(text)
        except Exception as e:
            print(f"[VisionEngine] JSON parse failed: {e}; text={text[:300]!r}")
            raise AIError("The AI model returned an unreadable answer. Please try again.") from e
        if not isinstance(data, dict):
            raise AIError("The AI model returned an unreadable answer. Please try again.")
        return data

    @classmethod
    async def analyze_media(cls, image_bytes: bytes, filename: str, user_settings: Optional[Any] = None) -> Dict[str, Any]:
        """Structured analysis of a single photo. Works for any kind of photo, not only field projects."""
        system = "You describe photos so they can be searched and turned into stories. Reply with strict JSON only."
        prompt = (
            "Look at this photo and return a JSON object with keys:\n"
            '"summary" (2 factual sentences about what is visible), '
            '"project_category" (a short 1-3 word theme you infer from the photo itself, e.g. "Tree planting", '
            '"Birthday party", "Blood donation camp", "Mountain trip", "Solar installation"), '
            '"activity_detected" (short phrase), '
            '"visual_signals" (array of 3-8 short lowercase search tags), '
            '"environmental_metrics" (object of measurable things you can actually see, e.g. {"people_visible": 12}; empty object if none), '
            '"authenticity_score" (0-1, likelihood the photo is an unedited real capture), '
            '"confidence" (0-1).'
        )
        data = await cls.generate_json(system, prompt, user_settings, images=[image_bytes])
        if not data.get("summary"):
            raise AIError("The AI model didn't describe this photo. Please retry.")
        return data

    @classmethod
    async def compare_images(cls, before_bytes: bytes, after_bytes: bytes, title: str, user_settings: Optional[Any] = None) -> Dict[str, Any]:
        system = "You compare a before photo and an after photo. Reply with strict JSON only."
        prompt = (
            f"Context: {title}. Image 1 is BEFORE, image 2 is AFTER.\n"
            "Return JSON with: "
            '"delta_summary" (one paragraph on visible changes, be honest if change is small or unclear), '
            '"impact_score" (0-10 number), '
            '"metrics_diff" (object of 2-5 metric_name -> estimated change string, e.g. "+40%").'
        )
        data = await cls.generate_json(system, prompt, user_settings, images=[before_bytes, after_bytes])
        if not data.get("delta_summary"):
            raise AIError("The AI model didn't describe the change. Please retry.")
        return data
