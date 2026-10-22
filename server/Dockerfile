FROM node:22-alpine AS build
WORKDIR /build
COPY server/package*.json ./server/
RUN cd server && npm ci --ignore-scripts
COPY server ./server
COPY workers/site-discovery/src ./workers/site-discovery/src
COPY workers/site-discovery/data ./workers/site-discovery/data
COPY apps/web-antd/src/views/intelligence/keyword-scoring.ts apps/web-antd/src/views/intelligence/site-discovery.ts apps/web-antd/src/views/intelligence/keyword-relevance.ts apps/web-antd/src/views/intelligence/trend-comparison.ts ./apps/web-antd/src/views/intelligence/
COPY apps/web-antd/src/views/intelligence/product-decisions.ts apps/web-antd/src/views/intelligence/discovery.ts ./apps/web-antd/src/views/intelligence/
COPY apps/web-antd/src/views/intelligence/advertisers.ts ./apps/web-antd/src/views/intelligence/
COPY apps/web-antd/src/views/intelligence/core-list-metrics.ts ./apps/web-antd/src/views/intelligence/
RUN server/node_modules/.bin/esbuild server/model.ts --bundle --platform=node --format=esm --outfile=server/model.js
RUN server/node_modules/.bin/esbuild server/collector.ts --bundle --platform=node --format=esm --outfile=server/collector.js

FROM node:22-alpine
RUN apk add --no-cache chromium
ENV NODE_ENV=production
ENV PRODUCT_BROWSER_EXECUTABLE=/usr/bin/chromium
WORKDIR /app
COPY --from=build /build/server/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /build/server/*.mjs /build/server/model.js /build/server/collector.js ./
COPY --from=build /build/server/release-manifest.json ./release-manifest.json
COPY apps/web-antd/scripts/collect-free-sources.mjs ./public-sources/collect-free-sources.mjs
COPY apps/web-antd/public/data/free-source-config.json ./public/data/free-source-config.json
USER node
EXPOSE 8080
CMD ["node", "index.mjs"]
