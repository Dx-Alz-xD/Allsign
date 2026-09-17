# Voicematics API. One long-lived process: the caregiver relay, trigger profiles and the login throttle live
# in memory, and both SQLite databases live on the /app/data volume.
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential

COPY . .

RUN useradd --create-home --uid 10001 voicematics \
    && mkdir -p /app/data /app/grammars \
    && chown -R voicematics:voicematics /app
USER voicematics

VOLUME ["/app/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=4).status == 200 else 1)"

# --proxy-headers: the reverse proxy in front terminates TLS; the rate limiter and CORS need the real client.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
