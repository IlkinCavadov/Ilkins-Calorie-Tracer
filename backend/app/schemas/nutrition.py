from datetime import date
from typing import Literal
from pydantic import BaseModel, Field

MealType = Literal["breakfast", "lunch", "dinner", "snack", "meal"]

class FoodItem(BaseModel):
    name: str
    quantity: float = Field(gt=0)
    unit: str

class AnalyzeMealRequest(BaseModel):
    description: str = Field(min_length=2)
    meal_type: MealType = "meal"
    meal_date: date | None = None

class NutritionTotals(BaseModel):
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float
    sugar_g: float
    sodium_mg: float

class AnalyzeMealResponse(BaseModel):
    items: list[FoodItem]
    totals: NutritionTotals
    unresolved_items: list[str] = []
    confidence: float

class CreateMealRequest(AnalyzeMealRequest):
    pass

class DailySummary(BaseModel):
    meal_date: date
    consumed: NutritionTotals
    goals: NutritionTotals
    remaining_calories: float
    remaining_protein_g: float

class ChatRequest(BaseModel):
    message: str = Field(min_length=2)
    meal_date: date | None = None

class ChatResponse(BaseModel):
    message: str

class AppleAuthRequest(BaseModel):
    identity_token: str
    authorization_code: str | None = None
    email: str | None = None
    name: str | None = None

class OnboardingRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=13, le=120)
    sex: Literal["female", "male", "other"]
    height_cm: float = Field(gt=100, le=250)
    weight_kg: float = Field(gt=30, le=300)
    activity_level: Literal["sedentary", "light", "moderate", "active", "very_active"]
    goal: Literal["lose", "maintain", "gain"]
    weight_loss_speed: Literal["slow", "moderate", "fast"] = "moderate"

class ProfileResponse(BaseModel):
    id: int
    name: str
    age: int | None
    sex: str | None
    height_cm: float | None
    weight_kg: float | None
    activity_level: str
    goal: str
    weight_loss_speed: str
    calorie_goal: float
    protein_goal: float
    carb_goal: float
    fat_goal: float
    onboarding_complete: bool

class AuthResponse(BaseModel):
    access_token: str
    user: ProfileResponse


class AIPlanRequest(BaseModel):
    request: str = Field(default="Plan my remaining meals for today.", min_length=2)
    meal_date: date | None = None

class AIPlannedMeal(BaseModel):
    meal_type: Literal["breakfast", "lunch", "dinner", "snack"]
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(min_length=2, max_length=500)
    approx_calories: float = Field(ge=0)
    approx_protein_g: float = Field(ge=0)
    approx_carbs_g: float = Field(default=0, ge=0)
    approx_fat_g: float = Field(default=0, ge=0)
    approx_fiber_g: float = Field(default=0, ge=0)
    approx_sugar_g: float = Field(default=0, ge=0)
    approx_sodium_mg: float = Field(default=0, ge=0)

class AIPlanAddRequest(AIPlannedMeal):
    meal_date: date | None = None

class AIPlanResponse(BaseModel):
    message: str
    remaining_calories: float
    remaining_protein_g: float
    meals: list[AIPlannedMeal] = []

class AIDecomposeRequest(BaseModel):
    food: str = Field(min_length=2, max_length=300)

class AIDecomposeResponse(BaseModel):
    message: str
    suggested_description: str
    items: list[FoodItem] = []
