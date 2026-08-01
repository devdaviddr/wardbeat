import logging
from dataclasses import dataclass
from typing import Awaitable, Callable, Literal, Optional

from app.settings import Settings

log = logging.getLogger("wardbeat.ai")

Provenance = Literal["live", "mock", "fallback"]


@dataclass(frozen=True)
class ModelResult[T]:
    """A capability's output plus how it was actually produced."""

    value: T
    provenance: Provenance
    model_used: Optional[str] = None


def deterministic[T](value: T) -> ModelResult[T]:
    """Label a result no model was ever asked for — an empty-input short circuit
    or a canned refusal. It is not `live`: nothing composed it.
    """
    return ModelResult(value, "mock", None)


async def call_model[T](
    settings: Settings,
    capability: str,
    *,
    mock: Callable[[], T],
    live: Callable[[], Awaitable[T]],
) -> ModelResult[T]:
    """Run `live` when a model is configured and `mock` otherwise, labelling the
    result with which one answered.

    Every capability degrades to the mock so an endpoint always returns
    something usable. `fallback` exists because that degradation used to be
    invisible: a failed live call produced a mock answer indistinguishable from
    a real one in the response, the UI and the logs.

    `live` should raise when the model's output is unusable (wrong shape, empty
    content) so that substituting the mock is recorded as a fallback rather than
    passing for a successful call.
    """
    if settings.use_mock:
        return ModelResult(mock(), "mock", None)

    model = settings.nim_extract_model
    try:
        return ModelResult(await live(), "live", model)
    except Exception as exc:  # noqa: BLE001 - degrade gracefully, but loudly
        # Include the exception *type*: several failure modes here (notably
        # httpx timeouts) stringify to the empty string, and "failed ()" tells
        # an operator nothing about whether to raise a budget, a timeout, or a
        # prompt.
        log.warning(
            "%s fell back to the mock: live call to %s failed (%s: %s)",
            capability,
            model,
            type(exc).__name__,
            exc,
        )
        # `model_used` is the model that was *called*, not the one that produced
        # the text — on a fallback the request did reach the endpoint, and that
        # is exactly what a later privacy audit needs to know.
        return ModelResult(mock(), "fallback", model)
