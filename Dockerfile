# ---- builder ----------------------------------------------------------------
# Install build tools needed to compile the 'ioctl' native addon via node-gyp.
# These are NOT carried into the final image.
FROM node:24-slim AS builder

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

# ---- runner -----------------------------------------------------------------
# Lean final image: only ALSA userland tools added on top of node:24-slim.
FROM node:24-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends alsa-utils libasound2 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src         ./src
COPY package.json ./

ENV NODE_ENV=production

# --max-old-space-size caps Node heap at 256 MB — important on Pi 3 (1 GB total RAM)
CMD ["node", "--max-old-space-size=256", "src/index.js"]
