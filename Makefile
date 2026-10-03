backend-install:
	cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
backend-run:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload --port 8000
backend-test:
	cd backend && . .venv/bin/activate && pytest -q
mobile-install:
	cd mobile && npm install
mobile-run:
	cd mobile && npx expo start
