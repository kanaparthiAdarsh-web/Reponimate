# Reponimate studio — everything needed to render locally inside one container.
FROM node:22-bookworm-slim AS rust
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates build-essential && rm -rf /var/lib/apt/lists/*
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
COPY crates /src/crates
RUN /root/.cargo/bin/cargo build --release --manifest-path /src/crates/reponimate-scan/Cargo.toml

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ffmpeg espeak-ng python3 python3-pip python3-venv chromium fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY python/requirements.txt python/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r python/requirements.txt
ENV PYTHON=/opt/venv/bin/python BROWSER_EXECUTABLE=/usr/bin/chromium PORT=4777 REPONIMATE_SCAN=/app/bin/reponimate-scan
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
COPY --from=rust /src/crates/reponimate-scan/target/release/reponimate-scan /app/bin/reponimate-scan
RUN npx tsx src/cli/setup-voices.ts
EXPOSE 4777
# Bind to all interfaces inside the container; docker-compose publishes it on localhost only.
ENV HOST=0.0.0.0
CMD ["npx", "tsx", "src/server/index.ts"]
