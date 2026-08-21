FROM node:20-alpine

WORKDIR /app

# Установка системных зависимостей для сборки SQLite
RUN apk add --no-cache python3 make g++

# Установка зависимостей Node.js
COPY package*.json ./
RUN npm ci --only=production

# Копирование исходного кода
COPY . .

# Порт
EXPOSE 3000

# Переменные окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/market.db

# Запуск
CMD ["node", "src/server.js"]
