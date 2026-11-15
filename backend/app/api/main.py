from fastapi import APIRouter

from app.api.routes import (
    agent,
    agent_authorization,
    inference,
    login,
    private,
    preannotations,
    projects,
    results,
    trials,
    users,
    utils,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(trials.router)
api_router.include_router(projects.router)
api_router.include_router(results.router)
api_router.include_router(agent.router)
api_router.include_router(agent_authorization.router)
api_router.include_router(inference.router)
api_router.include_router(preannotations.router)


if settings.FASTAPI_ENV == "development":
    api_router.include_router(private.router)
