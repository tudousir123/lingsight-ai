from fastapi import APIRouter

from app.api.routes import agent, items, login, private, research, trials, users, utils
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(research.router)
api_router.include_router(trials.router)
api_router.include_router(agent.router)


if settings.FASTAPI_ENV == "development":
    api_router.include_router(private.router)
