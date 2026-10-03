from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    apple_user_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    name: Mapped[str] = mapped_column(String(100), default="User")
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sex: Mapped[str | None] = mapped_column(String(20), nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    activity_level: Mapped[str] = mapped_column(String(30), default="moderate")
    goal: Mapped[str] = mapped_column(String(30), default="maintain")
    weight_loss_speed: Mapped[str] = mapped_column(String(20), default="moderate")
    calorie_goal: Mapped[float] = mapped_column(Float, default=2200)
    protein_goal: Mapped[float] = mapped_column(Float, default=150)
    carb_goal: Mapped[float] = mapped_column(Float, default=250)
    fat_goal: Mapped[float] = mapped_column(Float, default=75)


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    meal_type: Mapped[str] = mapped_column(String(30), default="meal")
    description: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    meal_date: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    calories: Mapped[float] = mapped_column(Float, default=0)
    protein_g: Mapped[float] = mapped_column(Float, default=0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0)
    fat_g: Mapped[float] = mapped_column(Float, default=0)
    fiber_g: Mapped[float] = mapped_column(Float, default=0)
    sugar_g: Mapped[float] = mapped_column(Float, default=0)
    sodium_mg: Mapped[float] = mapped_column(Float, default=0)


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    # Lightweight migration for the original MVP SQLite database.
    if settings.database_url.startswith("sqlite"):
        import sqlite3
        path = settings.database_url.replace("sqlite:///", "")
        conn = sqlite3.connect(path)
        existing = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        additions = {
            "apple_user_id": "VARCHAR(255)",
            "email": "VARCHAR(320)",
            "age": "INTEGER",
            "sex": "VARCHAR(20)",
            "height_cm": "FLOAT",
            "weight_kg": "FLOAT",
            "activity_level": "VARCHAR(30) DEFAULT 'moderate'",
            "goal": "VARCHAR(30) DEFAULT 'maintain'",
            "weight_loss_speed": "VARCHAR(20) DEFAULT 'moderate'",
        }
        for name, sql_type in additions.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE users ADD COLUMN {name} {sql_type}")
        conn.commit()
        conn.close()
