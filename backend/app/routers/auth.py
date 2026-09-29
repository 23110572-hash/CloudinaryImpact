from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models import User, UserSettings, Folder
from app.auth import get_password_hash, verify_password, create_access_token, get_current_user
from app.cloudinary_service import user_root_folder, ensure_folder, system_credentials

router = APIRouter(prefix="/auth", tags=["Authentication"])

class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str = "Field Director"

class LoginRequest(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    email = req.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    stmt = select(User).where(func.lower(User.email) == email)
    res = await db.execute(stmt)
    if res.scalars().first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=email,
        hashed_password=get_password_hash(req.password),
        full_name=req.full_name.strip() or "Field Director"
    )
    db.add(user)
    await db.flush()

    # Create default settings
    settings = UserSettings(user_id=user.id, llm_mode="system", active_provider="openrouter", active_model="google/gemini-2.5-flash")
    db.add(settings)

    # Every account gets its own private folder in Cloudinary (platform account by default).
    # No pre-seeded sub-folders: those come from the user's own uploads.
    user.cloudinary_folder = user_root_folder(user)
    await db.commit()
    await db.refresh(user)
    await ensure_folder(user.cloudinary_folder, system_credentials())

    token = create_access_token({"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "full_name": user.full_name}
    }

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(func.lower(User.email) == req.email.strip().lower())
    res = await db.execute(stmt)
    user = res.scalars().first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token({"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "full_name": user.full_name}
    }

@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "full_name": user.full_name}
