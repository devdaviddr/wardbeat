import hmac
from typing import Optional

from fastapi import Header, HTTPException, status

from app.settings import get_settings


async def require_service_token(
    x_service_token: Optional[str] = Header(default=None),
) -> None:
    """Reject calls without the shared service token. Next.js is the only
    intended caller; this service is never exposed to the browser.

    Fails closed (spec v0.12.0 NFR1): if no token is configured the service
    refuses every request rather than silently running open — an empty
    AI_SERVICE_TOKEN is a deploy-time misconfiguration, not a policy choice.
    Local development without a token must opt in explicitly via
    AI_ALLOW_INSECURE_NO_TOKEN=true (a loud warning is logged at startup).
    """
    settings = get_settings()
    if not settings.ai_service_token:
        if settings.ai_allow_insecure_no_token:
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "AI_SERVICE_TOKEN is not configured; refusing all requests. "
                "Set AI_SERVICE_TOKEN (matching the app's "
                "WARDBEAT_AI_SERVICE_TOKEN), or set "
                "AI_ALLOW_INSECURE_NO_TOKEN=true for local development only."
            ),
        )
    if x_service_token is None or not hmac.compare_digest(
        x_service_token, settings.ai_service_token
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing service token",
        )
