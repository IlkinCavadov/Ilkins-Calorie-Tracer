ACTIVITY_FACTORS = {
    "sedentary": 1.20,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.90,
}

LOSS_DEFICITS = {"slow": 250, "moderate": 400, "fast": 550}


def calculate_targets(age: int, sex: str, height_cm: float, weight_kg: float,
                      activity_level: str, goal: str, weight_loss_speed: str):
    if sex == "male":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    elif sex == "female":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
    else:
        # Midpoint is used when the user chooses another/doesn't want to specify.
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 78

    tdee = bmr * ACTIVITY_FACTORS[activity_level]
    if goal == "lose":
        calories = tdee - LOSS_DEFICITS[weight_loss_speed]
    elif goal == "gain":
        calories = tdee + 250
    else:
        calories = tdee

    # Avoid an aggressive target from the simple formula alone.
    calories = max(1200 if sex == "female" else 1500, round(calories))
    protein = round(weight_kg * (1.6 if goal != "gain" else 1.5))
    fat = round((calories * 0.27) / 9)
    carbs = round(max(0, (calories - protein * 4 - fat * 9) / 4))
    return calories, protein, carbs, fat, round(bmr), round(tdee)
