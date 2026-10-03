from app.schemas.nutrition import NutritionTotals


def build_chat_response(message: str, consumed: NutritionTotals, calorie_goal: float, protein_goal: float) -> str:
    calories_left = max(0, round(calorie_goal - consumed.calories))
    protein_left = max(0, round(protein_goal - consumed.protein_g))
    lower = message.lower()
    if "dinner" in lower or "eat" in lower or "food" in lower:
        return (
            f"You have about {calories_left} kcal and {protein_left} g protein left today. "
            f"A practical target for your next meal is 400–650 kcal with 25–45 g protein. "
            "For example: chicken with rice and vegetables, salmon with potatoes, or Greek yogurt with fruit."
        )
    return (
        f"Today you are at {consumed.calories:.0f} kcal, {consumed.protein_g:.0f} g protein, "
        f"{consumed.carbs_g:.0f} g carbs and {consumed.fat_g:.0f} g fat. "
        f"You have roughly {calories_left:.0f} kcal remaining."
    )
