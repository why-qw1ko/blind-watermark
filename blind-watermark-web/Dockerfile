FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system watermark \
    && useradd --system --gid watermark --home-dir /nonexistent --shell /usr/sbin/nologin watermark

WORKDIR /workspace/blind-watermark-web

COPY blind-watermark-web/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

COPY blind-watermark-web/ ./
COPY shared/ /workspace/shared/

RUN chown -R watermark:watermark /workspace
USER watermark

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/healthz', timeout=3)"

CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "1", "--timeout", "180", "--graceful-timeout", "30", "--max-requests", "200", "--max-requests-jitter", "20", "--access-logfile", "-"]
