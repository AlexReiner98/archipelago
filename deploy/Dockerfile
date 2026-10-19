# The Archipelago server as an image: Node 24 runs the TypeScript as it is, so there is no build step.
# Built from the repository's root: docker build -f deploy/Dockerfile .
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

# Which commit this is, for /health: the image has no .git to read it from.
ARG PELAGO_COMMIT=""
ENV PELAGO_COMMIT=$PELAGO_COMMIT \
    PELAGO_HOST=0.0.0.0 \
    PELAGO_PORT=3100 \
    PELAGO_AUTH=tokens \
    PELAGO_DATA=/var/archipelago/data

RUN mkdir -p /var/archipelago && chown node:node /var/archipelago
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server.ts"]
