# Dockerfile for Flask app (blind-watermark-web)
FROM python:3.11-slim

# system deps for some python packages (e.g., opencv-python-headless may require libgl1)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# install python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# copy application
COPY . .

ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# use gunicorn with uvicorn worker for production
CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "app:app", "-w", "4", "-b", "0.0.0.0:8000"]
