import os
import uvicorn


def run() -> None:
	host = os.getenv("HOST", "0.0.0.0")
	port = int(os.getenv("PORT", "8000"))
	reload_enabled = os.getenv("RELOAD", "true").lower() == "true"

	uvicorn.run("app:app", host=host, port=port, reload=reload_enabled)


if __name__ == "__main__":
	run()