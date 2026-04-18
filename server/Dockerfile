FROM python:3.12-slim

# Install system dependencies (removed software-properties-common)
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .

# FORCE PIP TO USE THE CPU-ONLY PYTORCH INDEX
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Now install the rest of your app's dependencies
RUN pip install --no-cache-dir -r requirements.txt

# PRE-CACHE THE MODEL: Downloads the model into the image during the build
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Copy the rest of the server code
COPY . .

# Ensure the chroma_db directory exists
RUN mkdir -p /app/chroma_db

EXPOSE 8000

CMD ["python", "main.py"]