FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

WORKDIR /app

# Copy production requirements and install
COPY prod_requirements.txt .
RUN pip install --no-cache-dir -r prod_requirements.txt

# Copy application source code
COPY . .

EXPOSE 8000

# Run uvicorn server mapping to the dynamically assigned host PORT
CMD uvicorn app.main:app --host 0.0.0.0 --port $PORT
