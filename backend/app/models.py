from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), default="Field Director")
    # Private root folder in Cloudinary, e.g. "cloudinary_impact/sarah-jenkins-12"
    cloudinary_folder = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    settings = relationship("UserSettings", back_populates="user", uselist=False, cascade="all, delete-orphan")
    folders = relationship("Folder", back_populates="user", cascade="all, delete-orphan")
    assets = relationship("MediaAsset", back_populates="user", cascade="all, delete-orphan")
    comparisons = relationship("Comparison", back_populates="user", cascade="all, delete-orphan")
    reports = relationship("ImpactReport", back_populates="user", cascade="all, delete-orphan")

class UserSettings(Base):
    __tablename__ = "user_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    
    # "system" (default zero-friction) or "byok" (bring your own key)
    llm_mode = Column(String(32), default="system")
    
    # Active Provider: "openrouter", "openai", "gemini", "anthropic", "groq", "bedrock"
    active_provider = Column(String(64), default="openrouter")
    active_model = Column(String(128), default="google/gemini-2.5-flash")
    
    # Dictionary storing keys per provider: {"openai": "sk-...", "anthropic": "sk-ant-...", ...}
    api_keys = Column(JSON, default={})
    
    # Cloudinary Config
    cloudinary_cloud_name = Column(String(128), nullable=True)
    cloudinary_api_key = Column(String(128), nullable=True)
    cloudinary_api_secret = Column(String(128), nullable=True)
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="settings")

class Folder(Base):
    __tablename__ = "folders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(128), nullable=False)
    slug = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(32), default="#0e8ce9")
    icon = Column(String(64), default="Folder")
    # Full Cloudinary path, always inside the owner's root folder
    cloudinary_path = Column(String(512), nullable=True)
    # Studio: AI-suggested creations for this folder, cached until its photos change
    ideas = Column(JSON, nullable=True)
    ideas_signature = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="folders")
    assets = relationship("MediaAsset", back_populates="folder")

class MediaAsset(Base):
    __tablename__ = "media_assets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    folder_id = Column(Integer, ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)
    
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    cloudinary_public_id = Column(String(255), nullable=True)
    secure_url = Column(Text, nullable=False)
    thumbnail_url = Column(Text, nullable=True)
    
    format = Column(String(32), default="jpg")
    resource_type = Column(String(32), default="image") # "image" | "video"
    bytes = Column(Integer, default=0)
    width = Column(Integer, default=0)
    height = Column(Integer, default=0)
    
    # EXIF & Geolocation Metadata
    captured_at = Column(DateTime, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_name = Column(String(255), nullable=True)
    
    # Project Phase
    phase = Column(String(32), default="general") # "before", "during", "after", "general"
    ai_status = Column(String(32), default="pending") # "pending", "analyzed", "failed"
    
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="assets")
    folder = relationship("Folder", back_populates="assets")
    ai_analysis = relationship("AIAnalysis", back_populates="asset", uselist=False, cascade="all, delete-orphan")

class AIAnalysis(Base):
    __tablename__ = "ai_analysis"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("media_assets.id", ondelete="CASCADE"), unique=True, nullable=False)
    
    summary = Column(Text, nullable=False)
    project_category = Column(String(128), default="General") # e.g. "Reforestation", "Solar & Renewable", "Clean Water"
    activity_detected = Column(String(255), nullable=True)
    visual_signals = Column(JSON, default=[]) # e.g. ["saplings", "solar arrays", "debris"]
    environmental_metrics = Column(JSON, default={}) # e.g. {"canopy_coverage": "35%", "units_installed": 12}
    authenticity_score = Column(Float, default=0.95)
    confidence = Column(Float, default=0.92)
    raw_response = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    asset = relationship("MediaAsset", back_populates="ai_analysis")

class Comparison(Base):
    __tablename__ = "comparisons"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    before_asset_id = Column(Integer, ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False)
    after_asset_id = Column(Integer, ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False)
    
    delta_summary = Column(Text, nullable=False)
    impact_score = Column(Float, default=8.5)
    metrics_diff = Column(JSON, default={}) # e.g. {"canopy_growth": "+65%", "erosion_reduction": "40%"}
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="comparisons")
    before_asset = relationship("MediaAsset", foreign_keys=[before_asset_id])
    after_asset = relationship("MediaAsset", foreign_keys=[after_asset_id])

class ImpactReport(Base):
    __tablename__ = "impact_reports"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    project_category = Column(String(128), default="Sustainability Impact")
    markdown_content = Column(Text, nullable=False)
    key_metrics = Column(JSON, default=[])
    # Studio creation type: document | social | before_after | reel | pack
    kind = Column(String(32), default="document")
    folder_id = Column(Integer, nullable=True)
    # Renderer output: image URLs, captions, source asset ids, etc.
    payload = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="reports")
