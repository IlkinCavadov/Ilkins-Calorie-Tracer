import json
import re
import httpx
from app.core.config import settings
from app.schemas.nutrition import FoodItem

SYSTEM_PROMPT = """You are a nutrition meal parser. Convert a user's meal description into JSON only.
Return exactly: {\"items\":[{\"name\":\"simple canonical food name\",\"quantity\":number,\"unit\":\"g|kg|piece|pieces|ml|serving\"}]}
Never calculate calories or macros. Preserve explicit quantities exactly.
Examples: "300g chicken" MUST return quantity 300, unit "g"; "3 x 100g chicken" MUST return quantity 300, unit "g"; "2 eggs" MUST return quantity 2, unit "piece".
Do not reduce, round down, or replace an explicit quantity with a default serving. If quantity is omitted, use a reasonable serving only when obvious.
"""

def _extract_json(text: str) -> dict:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        raise ValueError("AI did not return JSON")
    return json.loads(match.group(0))


def parse_with_qwen(description: str) -> list[FoodItem]:
    url = settings.qwen_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.qwen_api_key}"} if settings.qwen_api_key else {}
    payload = {
        "model": settings.qwen_model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": description}],
        "temperature": 0,
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=45) as client:
        response = client.post(url, json=payload, headers=headers)
        response.raise_for_status()
    parsed = _extract_json(response.json()["choices"][0]["message"]["content"])
    return [FoodItem(**item) for item in parsed.get("items", [])]


def chat_with_qwen(message: str, context: str) -> str:
    url = settings.qwen_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.qwen_api_key}"} if settings.qwen_api_key else {}
    system = """You are a concise nutrition assistant inside a calorie tracking app. Use the supplied user nutrition context. Do not diagnose disease or give medical treatment. Give practical food and nutrition guidance. If the user asks for calories/macros, distinguish database-derived numbers from estimates."""
    payload = {"model": settings.qwen_model, "messages":[{"role":"system","content":system},{"role":"user","content":f"Context:\n{context}\n\nUser question:\n{message}"}],"temperature":0.2,"stream":False}
    with httpx.Client(timeout=60) as client:
        response=client.post(url,json=payload,headers=headers)
        response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


PLAN_SYSTEM_PROMPT = """You are a nutrition meal-planning assistant inside a calorie tracking app.
Create a practical plan for the rest of the user's day using the supplied remaining calories and protein.
Return ONLY valid JSON. Do not wrap it in markdown.
Use these exact meal_type values: breakfast, lunch, dinner, snack.
Create one or more meals as appropriate; use breakfast/lunch/dinner/snack sections when they are still relevant to the user's day.
Do not exceed the supplied remaining calorie target.
Nutrition values are approximate and should be realistic. Include calories, protein, carbs, fat, fiber, sugar and sodium for every meal.
JSON shape:
{
  "summary": "one short sentence",
  "meals": [
    {
      "meal_type": "dinner",
      "name": "Chicken rice bowl",
      "description": "150 g chicken breast, 180 g cooked rice, vegetables and salsa",
      "approx_calories": 600,
      "approx_protein_g": 45,
      "approx_carbs_g": 55,
      "approx_fat_g": 18,
      "approx_fiber_g": 8,
      "approx_sugar_g": 6,
      "approx_sodium_mg": 700
    }
  ]
}
"""

DECOMPOSE_SYSTEM_PROMPT = """You are a nutrition meal decomposition assistant.
The user gives a dish they ate. Break it into likely ingredients and quantities so the user can copy the result into a calorie-tracking meal entry.
Return exactly JSON: {"items":[{"name":"simple canonical food name","quantity":number,"unit":"g|kg|piece|pieces|ml|serving"}],"suggested_description":"copyable ingredient description","notes":"short uncertainty note"}.
Do not calculate calories or macros. If the dish is ambiguous, choose a common serving and clearly mention that it is an estimate in notes.
"""

def _call_qwen(system: str, user_message: str, temperature: float = 0.2, json_mode: bool = False) -> str:
    url = settings.qwen_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.qwen_api_key}"} if settings.qwen_api_key else {}
    payload = {
        "model": settings.qwen_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_message}],
        "temperature": temperature,
        "stream": False,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    with httpx.Client(timeout=60) as client:
        response = client.post(url, json=payload, headers=headers)
        response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def create_meal_plan(context: str, request: str) -> dict:
    raw = _call_qwen(PLAN_SYSTEM_PROMPT, f"User nutrition context:\n{context}\n\nRequest:\n{request}", 0.3, json_mode=True)
    parsed = _extract_json(raw)
    meals = parsed.get("meals", [])
    if not isinstance(meals, list) or not meals:
        raise ValueError("AI returned no meal plan")
    return {
        "message": str(parsed.get("summary") or "Here is a plan for the rest of today."),
        "meals": meals,
    }


def decompose_food(food: str) -> dict:
    raw = _call_qwen(DECOMPOSE_SYSTEM_PROMPT, food, 0.0)
    parsed = _extract_json(raw)
    return parsed
