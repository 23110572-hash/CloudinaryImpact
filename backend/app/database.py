from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.config import settings

import urllib.parse

def _normalize_database_url(url: str):
    if not url:
        return "sqlite+aiosqlite:///./cloudinary_impact.db", {"check_same_thread": False}
    if url.startswith("sqlite"):
        return url, {"check_same_thread": False}
    
    parsed = urllib.parse.urlsplit(url)
    scheme = parsed.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    elif scheme == "postgresql+psycopg2":
        scheme = "postgresql+asyncpg"

    # asyncpg parses query string params strictly and rejects unsupported params like channel_binding or sslmode
    query_dict = urllib.parse.parse_qs(parsed.query)
    query_dict.pop("channel_binding", None)
    if "sslmode" in query_dict:
        mode = query_dict.pop("sslmode")[0]
        query_dict["ssl"] = [mode]
    elif "ssl" not in query_dict and "neon.tech" in parsed.netloc:
        query_dict["ssl"] = ["require"]

    new_query = urllib.parse.urlencode({k: v[0] for k, v in query_dict.items()})
    normalized = urllib.parse.urlunsplit((scheme, parsed.netloc, parsed.path, new_query, ""))
    return normalized, {}

DATABASE_URL, CONNECT_ARGS = _normalize_database_url(settings.DATABASE_URL)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=CONNECT_ARGS
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
