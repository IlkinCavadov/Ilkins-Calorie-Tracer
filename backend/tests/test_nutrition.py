from app.schemas.nutrition import FoodItem
from app.services.nutrition import calculate


def test_calculate_two_eggs():
    totals, unresolved = calculate([FoodItem(name="egg", quantity=2, unit="piece")])
    assert not unresolved
    assert totals.calories == 144
    assert totals.protein_g == 12.6


def test_unknown_food_is_not_invented():
    totals, unresolved = calculate([FoodItem(name="dragon fruit pizza", quantity=1, unit="piece")])
    assert unresolved == ["dragon fruit pizza"]
    assert totals.calories == 0
