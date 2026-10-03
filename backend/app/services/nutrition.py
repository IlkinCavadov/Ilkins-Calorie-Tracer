from dataclasses import dataclass

from app.schemas.nutrition import FoodItem, NutritionTotals


@dataclass(frozen=True)
class Food:
    name: str
    unit: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float
    sugar_g: float
    sodium_mg: float
    gluten: bool | None = None


# Small deterministic seed catalog. External food databases plug into the same lookup interface later.
CATALOG = [
    Food("egg", "piece", 72, 6.3, 0.4, 4.8, 0, 0.2, 71, False),
    Food("chicken breast", "g", 1.65, 0.31, 0, 0.036, 0, 0, 0.74, False),
    Food("rice", "g", 1.30, 0.027, 0.282, 0.003, 0.004, 0.001, 0.005, False),
    Food("white bread", "slice", 80, 2.7, 14.8, 1.0, 0.8, 1.5, 140, True),
    Food("whole wheat bread", "slice", 100, 4.0, 17, 1.5, 2.7, 2.0, 170, True),
    Food("avocado", "piece", 240, 3.0, 12.8, 22.0, 10.0, 1.0, 11, False),
    Food("banana", "piece", 105, 1.3, 27.0, 0.4, 3.1, 14.4, 1, False),
    Food("apple", "piece", 95, 0.5, 25.0, 0.3, 4.4, 19.0, 2, False),
    Food("greek yogurt", "g", 0.97, 0.10, 0.035, 0.033, 0, 0.035, 0.36, False),
    Food("oats", "g", 3.89, 0.169, 0.663, 0.069, 0.106, 0.010, 0.002, True),
    Food("salmon", "g", 2.08, 0.20, 0, 0.13, 0, 0, 0.59, False),
    Food("turkey breast", "g", 1.35, 0.29, 0, 0.02, 0, 0, 0.55, False),
    Food("sweet potato", "g", 0.86, 0.016, 0.20, 0.001, 0.03, 0.065, 0.55, False),
    Food("broccoli", "g", 0.35, 0.024, 0.072, 0.004, 0.031, 0.015, 0.33, False),
    Food("olive oil", "ml", 7.95, 0, 0, 0.91, 0, 0, 0, False),
    Food("flour tortilla", "piece", 180, 5, 30, 5, 2, 2, 380, True),
    Food("black beans", "g", 1.32, 0.089, 0.236, 0.005, 0.086, 0.004, 1.0, False),
    Food("cheese", "g", 4.0, 0.25, 0.014, 0.33, 0, 0.002, 600, False),
    Food("salsa", "g", 0.36, 0.012, 0.08, 0.002, 0.015, 0.04, 240, False),
    Food("lettuce", "g", 0.15, 0.014, 0.029, 0.002, 0.014, 0.01, 28, False),
]

ALIASES = {
    "eggs": "egg",
    "egg": "egg",
    "chicken": "chicken breast",
    "chicken breast": "chicken breast",
    "toast": "whole wheat bread",
    "bread": "white bread",
    "wholegrain bread": "whole wheat bread",
    "whole grain bread": "whole wheat bread",
    "rice": "rice",
    "avocado": "avocado",
    "banana": "banana",
    "apple": "apple",
    "yogurt": "greek yogurt",
    "greek yogurt": "greek yogurt",
    "oatmeal": "oats",
    "oats": "oats",
    "salmon": "salmon",
    "turkey": "turkey breast",
    "turkey breast": "turkey breast",
    "sweet potato": "sweet potato",
    "sweet potatoes": "sweet potato",
    "broccoli": "broccoli",
    "olive oil": "olive oil",
    "oil": "olive oil",
    "tortilla": "flour tortilla",
    "flour tortilla": "flour tortilla",
    "black beans": "black beans",
    "beans": "black beans",
    "cheese": "cheese",
    "salsa": "salsa",
    "lettuce": "lettuce",
}


def find_food(name: str) -> Food | None:
    key = name.lower().strip()
    key = ALIASES.get(key, key)
    return next((food for food in CATALOG if food.name == key), None)


def _factor(food: Food, item: FoodItem) -> float:
    if food.unit == item.unit:
        return item.quantity
    if food.unit == "g" and item.unit == "kg":
        return item.quantity * 1000
    if food.unit == "piece" and item.unit == "pieces":
        return item.quantity
    return item.quantity


def calculate(items: list[FoodItem]) -> tuple[NutritionTotals, list[str]]:
    totals = {k: 0.0 for k in ("calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg")}
    unresolved: list[str] = []
    for item in items:
        food = find_food(item.name)
        if not food:
            unresolved.append(item.name)
            continue
        factor = _factor(food, item)
        totals["calories"] += food.calories * factor
        totals["protein_g"] += food.protein_g * factor
        totals["carbs_g"] += food.carbs_g * factor
        totals["fat_g"] += food.fat_g * factor
        totals["fiber_g"] += food.fiber_g * factor
        totals["sugar_g"] += food.sugar_g * factor
        totals["sodium_mg"] += food.sodium_mg * factor
    return NutritionTotals(**{k: round(v, 1) for k, v in totals.items()}), unresolved
