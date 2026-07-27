from typing import Optional

from fastapi import Header, HTTPException, status

from app.settings import get_settings


async def require_service_token(
    x_service_token: Optional[str] = Header(default=None),
) -> None:
    """Reject calls without the shared service token. Next.js is the only
    intended caller; this service is never exposed to the browser. If no token
    is configured (dev), auth is skipped.
    """
    settings = get_settings()
    if not settings.ai_service_token:
        return
    if x_service_token != settings.ai_service_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing service token",
        )
