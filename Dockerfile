# NVOCC CRM — runs on Node 22 (built-in SQLite + crypto, no npm install needed)
FROM node:22-slim
WORKDIR /app
COPY . .
# Data (the SQLite file) lives on a mounted volume so it survives redeploys.
ENV NVOCC_DB=/data/nvocc.db
ENV PORT=3000
EXPOSE 3000
# Ensure the data dir exists at runtime, then start.
CMD ["sh", "-c", "mkdir -p /data && node server.js"]
