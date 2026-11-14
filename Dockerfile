# Tandem: a small private web app for two people.
# Built on the NAS by scripts/deploy.sh. The data lives in the volume at /app/data.
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=8790 \
    DATA_DIR=/app/data \
    TZ=Australia/Melbourne \
    CHECKIN_START_DAY=0

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only what the app needs to run, plus the script that makes the two users.
COPY src ./src
COPY migrations ./migrations
COPY prompts ./prompts
COPY public ./public
COPY scripts/create-users.mjs ./scripts/create-users.mjs
COPY scripts/reset-passphrase.mjs ./scripts/reset-passphrase.mjs

# The data folder is made here and owned by the node user, so a new named volume
# mounted over it starts out writable by the user the app runs as.
RUN mkdir -p /app/data && chown -R node:node /app/data

ARG COMMIT=unknown
LABEL org.opencontainers.image.title="Tandem" \
      org.opencontainers.image.revision="$COMMIT"

USER node
EXPOSE 8790
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8790/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
