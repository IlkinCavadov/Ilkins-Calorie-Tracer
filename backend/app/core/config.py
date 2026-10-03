from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str = "sqlite:///./calorie_tracer.db"
    ai_provider: str = "mock"
    qwen_base_url: str = "https://openrouter.ai/api/v1"
    qwen_model: str = "qwen/qwen3.8-27b:free"
    qwen_api_key: str = ""
    jwt_secret: str = "dev-only-change-this-secret"
    apple_bundle_id: str = "com.example.calorietracer"
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
