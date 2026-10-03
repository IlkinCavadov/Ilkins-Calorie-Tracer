import re

from app.core.config import settings
from app.schemas.nutrition import FoodItem
from app.services.nutrition import CATALOG
from app.services.qwen import parse_with_qwen


def parse_meal_mock(text: str) -> list[FoodItem]:
    """Deterministic fallback that preserves explicit quantities when AI is unavailable."""
    normalized = re.sub(r"\s+", " ", text.lower()).strip()
    items: list[FoodItem] = []

    for food in CATALOG:
        aliases = {food.name}
        if food.name == "egg": aliases |= {"eggs"}
        if food.name == "chicken breast": aliases |= {"chicken", "cooked chicken breast", "skinless chicken breast", "cooked skinless chicken breast"}
        if food.name == "whole wheat bread": aliases |= {"toast", "whole grain bread"}
        if food.name == "greek yogurt": aliases |= {"yogurt"}
        if food.name == "oats": aliases |= {"oatmeal"}

        for alias in sorted(aliases, key=len, reverse=True):
            if alias not in normalized:
                continue

            escaped_alias = re.escape(alias)
            quantity = None
            unit = food.unit

            # 3 x 100 g chicken breast -> 300 g
            multiplier_grams = re.search(
                rf"(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g)\s+(?:[a-z]+\s+){{0,5}}{escaped_alias}\b",
                normalized,
            )
            if multiplier_grams:
                multiplier = float(multiplier_grams.group(1))
                amount = float(multiplier_grams.group(2))
                unit_token = multiplier_grams.group(3)
                quantity = multiplier * amount * (1000 if unit_token == "kg" else 1)
                unit = "g"

            # 3 100 g chicken breast -> 300 g (common shorthand)
            if quantity is None:
                shorthand_grams = re.search(
                    rf"(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*(kg|g)\s+(?:[a-z]+\s+){{0,5}}{escaped_alias}\b",
                    normalized,
                )
                if shorthand_grams:
                    multiplier = float(shorthand_grams.group(1))
                    amount = float(shorthand_grams.group(2))
                    unit_token = shorthand_grams.group(3)
                    quantity = multiplier * amount * (1000 if unit_token == "kg" else 1)
                    unit = "g"

            # 300 g cooked skinless chicken breast -> 300 g
            if quantity is None:
                grams = re.search(
                    rf"(\d+(?:\.\d+)?)\s*(kg|g)\s+(?:[a-z]+\s+){{0,5}}{escaped_alias}\b",
                    normalized,
                )
                if grams:
                    amount = float(grams.group(1))
                    unit_token = grams.group(2)
                    quantity = amount * (1000 if unit_token == "kg" else 1)
                    unit = "g"

            # 2 eggs / 3 x eggs / 2 bananas
            if quantity is None:
                number = re.search(rf"(\d+(?:\.\d+)?)\s*(?:x\s*)?{escaped_alias}\b", normalized)
                if number:
                    quantity = float(number.group(1))

            if quantity is None:
                quantity = 1.0
                if food.unit == "g":
                    quantity, unit = 100.0, "g"

            items.append(FoodItem(name=food.name, quantity=quantity, unit=unit))
            break

    return items


def parse_meal(text: str) -> tuple[list[FoodItem], float]:
    if settings.ai_provider in {"qwen_ollama", "openrouter"} and settings.qwen_api_key:
        try:
            items = parse_with_qwen(text)
            return items, 0.85 if items else 0.15
        except Exception:
            # Keep the app usable when the local model server is unavailable.
            pass
    items = parse_meal_mock(text)
    return items, 0.55 if items else 0.10
