# ---- Build stage: Frontend ----
FROM node:22-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Runtime: Backend + statisches Frontend ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY backend/src ./src
# Gebautes Frontend einbinden, damit Express es ausliefert (SPA).
# server.js nutzt relative Pfade "../frontend/dist" (aufgelöst vom CWD).
# Im Container ist WORKDIR=/app, also muss dist nach /frontend/dist (nicht
# /app/frontend/dist), sonst findet Express die Dateien nicht ("Frontend nicht
# gebaut").
COPY --from=build-frontend /app/frontend/dist /frontend/dist

EXPOSE 8787
CMD ["node", "src/server.js"]
