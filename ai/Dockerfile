# WardBeat AI plane — internal FastAPI service (spec v0.2.0).
# Pinned Python base so the host toolchain version is irrelevant.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv

RUN pip install --no-cache-dir \
    "fastapi>=0.115" \
    "uvicorn[standard]>=0.32" \
    "httpx>=0.27" \
    "pydantic>=2.9" \
    "pydantic-settings>=2.5"

COPY app ./app

# Run as non-root.
RUN useradd --create-home appuser && chown -R appuser /srv
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
