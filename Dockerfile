# Live-сервер FOMI для VPS: мозг + управление телефоном по ADB + поток для сайта.
#   docker build -t fomi .
#   docker run -d --restart=always --env-file .env -p 8787:8787 -v $(pwd)/brain/data:/app/brain/data fomi
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends android-tools-adb && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true
COPY . .
ENV EXECUTOR=phone LIVE_PORT=8787
EXPOSE 8787
CMD ["node", "brain/live/server.js"]
