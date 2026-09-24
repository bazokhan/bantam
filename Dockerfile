FROM node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/sdk/package.json packages/sdk/package.json
RUN npm install --ignore-scripts=false
COPY tsconfig.json tsconfig.build.json eslint.config.js .prettierrc.json ./
COPY src src
COPY packages packages
RUN npm run build && npm prune --omit=dev

FROM node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7
ARG LITESTREAM_VERSION=0.5.16
ARG TARGETARCH
RUN set -eux; arch="${TARGETARCH}"; if [ "${arch}" = "amd64" ]; then arch="x86_64"; fi; asset="litestream-${LITESTREAM_VERSION}-linux-${arch}.tar.gz"; \
    apt-get update; apt-get install -y --no-install-recommends ca-certificates curl; \
    curl -fsSLo "/tmp/${asset}" "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/${asset}"; \
    curl -fsSLo /tmp/checksums.txt "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/checksums.txt"; \
    cd /tmp; grep "  ${asset}$" checksums.txt | sha256sum -c -; \
    tar -xzf "${asset}"; install -m 0755 litestream /usr/local/bin/litestream; rm -rf /tmp/* /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/dist dist
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/sdk/dist packages/sdk/dist
COPY --chown=node:node package.json ./
COPY --chown=node:node migrations migrations
COPY --chown=node:node config config
COPY --chown=node:node deploy/entrypoint.sh /usr/local/bin/bantam-entrypoint
RUN chmod 0755 /usr/local/bin/bantam-entrypoint && mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=3000 BANTAM_DATA_DIR=/data LITESTREAM_CONFIG=/data/litestream.generated.yml
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["bantam-entrypoint"]
