# Calorie Tracer MVP

iOS-first nutrition tracker built with Expo/React Native + FastAPI.

## Current MVP

- Sign in with Apple architecture and session tokens
- Profile onboarding: name, age, sex, height, weight, activity, goal
- Weight-loss speed: slow / moderate / fast
- Deterministic calorie + macro target calculation
- Today dashboard
- Add/analyze meals
- Nutrition AI tab
- Profile tab
- Local SQLite database
- Qwen provider interface ready for OpenRouter free inference

## Run backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

## Run mobile

```bash
cd mobile
npm install
npx expo start
```

Press `i` for the iOS simulator.

## Apple Sign In

The Apple button is wired to the backend token verification flow. Real Sign in with Apple requires the app's bundle identifier to have the Apple capability enabled in Apple's developer account. The iOS Simulator has limitations for Apple authentication; test the final sign-in flow on a real iPhone.

## Free Qwen cloud

OpenRouter currently lists `qwen/qwen3.8-27b:free` as a free model. Add the API key to `backend/.env` and set:

```text
AI_PROVIDER=openrouter
QWEN_API_KEY=your_key
```

The app keeps the AI provider behind the backend, so the API key never goes into the iPhone app.

## v0.3 UI/meal-flow changes
- Meal planner now returns structured meals and renders Breakfast/Lunch/Dinner/Snacks as user-facing cards.
- Adding a plan saves each meal separately using its own meal_type.
- Ask AI meal statements infer a meal type and require confirmation before saving.
- Today groups meals by meal type.
- Today meals can be removed with a confirmation action.
- SQLite remains unchanged.
