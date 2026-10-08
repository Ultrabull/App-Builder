# Playwright's official image ships Chromium + all OS deps at a matching version.
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Persistent login profile lives here; mount a volume at /data on your host.
ENV PROFILE_DIR=/data/profile
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
