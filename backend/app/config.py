import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings
from typing import Optional

# Load .env solely from workspace root (single source of truth)
root_env = Path(__file__).resolve().parent.parent.parent / ".env"
if root_env.exists():
    load_dotenv(root_env, override=True)

class Settings(BaseSettings):
    PROJECT_NAME: str = "Cloudinary Impact AI"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    
    # Secret Key for JWT (required: no built-in default, or anyone could forge logins)
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    
    # System Cloudinary Fallback Credentials
    CLOUDINARY_CLOUD_NAME: Optional[str] = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    CLOUDINARY_API_KEY: Optional[str] = os.getenv("CLOUDINARY_API_KEY", "")
    CLOUDINARY_API_SECRET: Optional[str] = os.getenv("CLOUDINARY_API_SECRET", "")
    CLOUDINARY_URL: Optional[str] = os.getenv("CLOUDINARY_URL", "")
    
    # System Managed LLM Keys (used when a user is in System Managed mode)
    SYSTEM_GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY", "")
    SYSTEM_GROQ_API_KEY: Optional[str] = os.getenv("GROQ_API_KEY", "")
    SYSTEM_OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY", "")
    SYSTEM_ANTHROPIC_API_KEY: Optional[str] = os.getenv("ANTHROPIC_API_KEY", "")
    SYSTEM_OPENROUTER_API_KEY: Optional[str] = os.getenv("OPENROUTER_API_KEY", "")
    
    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()

if not (settings.SECRET_KEY or "").strip():
    raise RuntimeError("SECRET_KEY is not set. Add a long random value to .env (local) or the Render environment.")
