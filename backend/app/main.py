from datetime import date
import jwt
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db import Meal, SessionLocal, User, init_db
from app.schemas.nutrition import *
from app.services.calories import calculate_targets
from app.services.chat import build_chat_response
from app.services.meal_parser import parse_meal
from app.services.nutrition import calculate

app = FastAPI(title="Calorie Tracer API", version="0.2.0")

@app.on_event("startup")
def startup():
    init_db()
    with SessionLocal() as db:
        if db.get(User, 1) is None:
            db.add(User(id=1, name="Demo User"))
            db.commit()

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def token_for(user_id: int) -> str:
    return jwt.encode({"sub": str(user_id)}, settings.jwt_secret, algorithm="HS256")

def current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    if not authorization:
        return db.get(User, 1)
    try:
        token = authorization.removeprefix("Bearer ")
        user_id = int(jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])["sub"])
        user = db.get(User, user_id)
        if not user: raise ValueError()
        return user
    except Exception as exc:
        raise HTTPException(401, "Invalid session") from exc

def profile(user: User) -> ProfileResponse:
    complete = all([user.age, user.sex, user.height_cm, user.weight_kg])
    return ProfileResponse(id=user.id, name=user.name, age=user.age, sex=user.sex,
        height_cm=user.height_cm, weight_kg=user.weight_kg, activity_level=user.activity_level,
        goal=user.goal, weight_loss_speed=user.weight_loss_speed, calorie_goal=user.calorie_goal,
        protein_goal=user.protein_goal, carb_goal=user.carb_goal, fat_goal=user.fat_goal,
        onboarding_complete=complete)

@app.get("/health")
def health(): return {"status":"ok"}

@app.get("/api/profile", response_model=ProfileResponse)
def get_profile(user: User = Depends(current_user)): return profile(user)

@app.post("/api/auth/apple", response_model=AuthResponse)
def apple_auth(payload: AppleAuthRequest, db: Session = Depends(get_db)):
    try:
        header = jwt.get_unverified_header(payload.identity_token)
        kid = header.get("kid")
        with httpx.Client(timeout=10) as client:
            keys = client.get("https://appleid.apple.com/auth/keys").json()["keys"]
        key = next((k for k in keys if k.get("kid") == kid), None)
        if not key: raise ValueError("Apple signing key not found")
        # Convert Apple's JWK to a public key using PyJWT's helper.
        from jwt.algorithms import RSAAlgorithm
        public_key = RSAAlgorithm.from_jwk(key)
        claims = jwt.decode(payload.identity_token, public_key, algorithms=["RS256"], audience=settings.apple_bundle_id, issuer="https://appleid.apple.com")
        apple_id = claims["sub"]
    except Exception as exc:
        raise HTTPException(401, "Could not verify Sign in with Apple token") from exc

    user = db.scalar(select(User).where(User.apple_user_id == apple_id))
    if not user:
        user = User(apple_user_id=apple_id, email=payload.email or claims.get("email"), name=payload.name or "User")
        db.add(user); db.commit(); db.refresh(user)
    elif payload.name and user.name == "User":
        user.name = payload.name; db.commit()
    return AuthResponse(access_token=token_for(user.id), user=profile(user))

@app.post("/api/onboarding", response_model=ProfileResponse)
def onboarding(payload: OnboardingRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    calories, protein, carbs, fat, _, _ = calculate_targets(payload.age, payload.sex, payload.height_cm, payload.weight_kg, payload.activity_level, payload.goal, payload.weight_loss_speed)
    for field, value in payload.model_dump().items(): setattr(user, field, value)
    user.calorie_goal, user.protein_goal, user.carb_goal, user.fat_goal = calories, protein, carbs, fat
    db.commit(); db.refresh(user)
    return profile(user)

@app.post("/api/meals/analyze", response_model=AnalyzeMealResponse)
def analyze_meal(payload: AnalyzeMealRequest):
    items, confidence = parse_meal(payload.description); totals, unresolved = calculate(items)
    return AnalyzeMealResponse(items=items, totals=totals, unresolved_items=unresolved, confidence=confidence)

@app.post("/api/meals", response_model=AnalyzeMealResponse)
def create_meal(payload: CreateMealRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    items, confidence = parse_meal(payload.description); totals, unresolved = calculate(items)
    meal = Meal(user_id=user.id, meal_type=payload.meal_type, description=payload.description, meal_date=payload.meal_date or date.today(), calories=totals.calories, protein_g=totals.protein_g, carbs_g=totals.carbs_g, fat_g=totals.fat_g, fiber_g=totals.fiber_g, sugar_g=totals.sugar_g, sodium_mg=totals.sodium_mg)
    db.add(meal); db.commit()
    return AnalyzeMealResponse(items=items, totals=totals, unresolved_items=unresolved, confidence=confidence)

@app.get("/api/summary", response_model=DailySummary)
def get_summary(meal_date: date | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    target = meal_date or date.today(); meals = db.scalars(select(Meal).where(Meal.user_id == user.id, Meal.meal_date == target)).all()
    consumed = NutritionTotals(calories=round(sum(m.calories for m in meals),1), protein_g=round(sum(m.protein_g for m in meals),1), carbs_g=round(sum(m.carbs_g for m in meals),1), fat_g=round(sum(m.fat_g for m in meals),1), fiber_g=round(sum(m.fiber_g for m in meals),1), sugar_g=round(sum(m.sugar_g for m in meals),1), sodium_mg=round(sum(m.sodium_mg for m in meals),1))
    goals = NutritionTotals(calories=user.calorie_goal, protein_g=user.protein_goal, carbs_g=user.carb_goal, fat_g=user.fat_goal, fiber_g=30, sugar_g=36, sodium_mg=2300)
    return DailySummary(meal_date=target, consumed=consumed, goals=goals, remaining_calories=round(user.calorie_goal-consumed.calories,1), remaining_protein_g=round(user.protein_goal-consumed.protein_g,1))

@app.post("/api/ai/meal-plan", response_model=AIPlanResponse)
def ai_meal_plan(payload: AIPlanRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    target = payload.meal_date or date.today()
    summary = get_summary(target, db, user)
    context = (
        f"Daily calorie target: {summary.goals.calories:.0f} kcal. "
        f"Protein target: {summary.goals.protein_g:.0f} g. "
        f"Consumed today: {summary.consumed.calories:.0f} kcal, "
        f"{summary.consumed.protein_g:.0f} g protein, "
        f"{summary.consumed.carbs_g:.0f} g carbs, {summary.consumed.fat_g:.0f} g fat. "
        f"Remaining: {summary.remaining_calories:.0f} kcal and {summary.remaining_protein_g:.0f} g protein. "
        f"Goal: {user.goal}; activity: {user.activity_level}."
    )
    if settings.ai_provider == "openrouter" and settings.qwen_api_key:
        try:
            from app.services.qwen import create_meal_plan
            planned = create_meal_plan(context, payload.request)
            meals = [AIPlannedMeal(**item) for item in planned.get("meals", [])]
            return AIPlanResponse(
                message=planned.get("message", "Here is a plan for the rest of today."),
                remaining_calories=summary.remaining_calories,
                remaining_protein_g=summary.remaining_protein_g,
                meals=meals,
            )
        except Exception:
            pass
    # Useful local fallback so the feature remains testable without an API key.
    remaining = max(0, round(summary.remaining_calories))
    protein = max(0, round(summary.remaining_protein_g))
    fallback_meals = []
    if remaining >= 450:
        fallback_meals.append(AIPlannedMeal(
            meal_type="dinner",
            name="Chicken rice bowl",
            description="150 g chicken breast, 180 g cooked rice, vegetables and salsa",
            approx_calories=min(600, remaining),
            approx_protein_g=min(45, protein),
        ))
    if remaining - sum(m.approx_calories for m in fallback_meals) >= 150:
        fallback_meals.append(AIPlannedMeal(
            meal_type="snack",
            name="Greek yogurt with banana",
            description="200 g Greek yogurt and 1 banana",
            approx_calories=min(250, max(150, remaining - sum(m.approx_calories for m in fallback_meals))),
            approx_protein_g=min(15, max(0, protein - sum(m.approx_protein_g for m in fallback_meals))),
        ))
    return AIPlanResponse(
        message=f"About {remaining} kcal and {protein} g protein remain today.",
        remaining_calories=summary.remaining_calories,
        remaining_protein_g=summary.remaining_protein_g,
        meals=fallback_meals,
    )


@app.post("/api/ai/meal-plan/add")
def add_ai_planned_meal(payload: AIPlanAddRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    meal = Meal(
        user_id=user.id,
        meal_type=payload.meal_type,
        description=payload.description,
        meal_date=payload.meal_date or date.today(),
        calories=payload.approx_calories,
        protein_g=payload.approx_protein_g,
        carbs_g=payload.approx_carbs_g,
        fat_g=payload.approx_fat_g,
        fiber_g=payload.approx_fiber_g,
        sugar_g=payload.approx_sugar_g,
        sodium_mg=payload.approx_sodium_mg,
    )
    db.add(meal)
    db.commit()
    db.refresh(meal)
    return {"id": meal.id, "meal_type": meal.meal_type, "calories": meal.calories}


@app.post("/api/ai/decompose", response_model=AIDecomposeResponse)
def ai_decompose(payload: AIDecomposeRequest):
    if settings.ai_provider == "openrouter" and settings.qwen_api_key:
        try:
            from app.services.qwen import decompose_food
            parsed = decompose_food(payload.food)
            items = [FoodItem(**item) for item in parsed.get("items", [])]
            description = parsed.get("suggested_description") or ", ".join(f"{i.quantity:g}{i.unit} {i.name}" for i in items)
            notes = parsed.get("notes", "")
            message = f"Likely ingredients for {payload.food}:\n" + description
            if notes:
                message += f"\n\nNote: {notes}"
            return AIDecomposeResponse(message=message, suggested_description=description, items=items)
        except Exception:
            pass
    description = f"1 serving of {payload.food}"
    return AIDecomposeResponse(
        message=f"I can break down {payload.food}, but the cloud AI is not configured yet. For now, start with: {description}",
        suggested_description=description,
        items=[FoodItem(name=payload.food, quantity=1, unit="serving")],
    )


@app.delete("/api/meals/{meal_id}")
def delete_meal(meal_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    meal = db.get(Meal, meal_id)
    if not meal or meal.user_id != user.id:
        raise HTTPException(404, "Meal not found")
    db.delete(meal)
    db.commit()
    return {"deleted": True, "meal_id": meal_id}

@app.get("/api/activity")
def get_activity(): return {"connected":False,"provider":"apple_health","steps":0,"active_calories":0}

@app.get("/api/meals")
def list_meals(meal_date: date | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    target=meal_date or date.today(); meals=db.scalars(select(Meal).where(Meal.user_id==user.id, Meal.meal_date==target).order_by(Meal.created_at.desc())).all()
    return [{"id":m.id,"meal_type":m.meal_type,"description":m.description,"created_at":m.created_at,"calories":m.calories,"protein_g":m.protein_g,"carbs_g":m.carbs_g,"fat_g":m.fat_g,"fiber_g":m.fiber_g,"sugar_g":m.sugar_g,"sodium_mg":m.sodium_mg} for m in meals]

@app.post("/api/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    target=payload.meal_date or date.today(); summary=get_summary(target, db, user)
    if settings.ai_provider == "openrouter" and settings.qwen_api_key:
        from app.services.qwen import chat_with_qwen
        context = (
            f"Daily target: {summary.goals.calories:.0f} kcal; protein target: {summary.goals.protein_g:.0f} g. "
            f"Consumed: {summary.consumed.calories:.0f} kcal, {summary.consumed.protein_g:.0f} g protein, "
            f"{summary.consumed.carbs_g:.0f} g carbs, {summary.consumed.fat_g:.0f} g fat, {summary.consumed.sugar_g:.0f} g sugar. "
            f"User goal: {user.goal}; weight: {user.weight_kg or 'unknown'} kg."
        )
        try:
            return ChatResponse(message=chat_with_qwen(payload.message, context))
        except Exception:
            pass
    return ChatResponse(message=build_chat_response(payload.message, summary.consumed, summary.goals.calories, summary.goals.protein_g))
