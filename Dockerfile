FROM node:20-alpine AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps

RUN apk add --no-cache libc6-compat

COPY package.json yarn.lock ./

RUN yarn config set registry "https://registry.npmmirror.com/" \
  && HUSKY=0 yarn install --frozen-lockfile

FROM base AS builder

RUN apk add --no-cache git

ENV BUILD_MODE=standalone
ENV OPENAI_API_KEY=""
ENV GOOGLE_API_KEY=""
ENV PERPLEXITY_API_KEY=""
ENV ANTHROPIC_API_KEY=""
ENV EMPLOYEE_ACCESS_KEYS=""
ENV ADMIN_PASSWORD=""
ENV ADMIN_SECRET=""
ENV NEWBIE_ADMIN_CONFIG_PATH=""
ENV NEWBIE_USAGE_LOG_PATH=""
ENV CODE=""

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn build

FROM base AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV PROXY_URL=""
ENV ENABLE_MCP=""
ENV OPENAI_API_KEY=""
ENV GOOGLE_API_KEY=""
ENV PERPLEXITY_API_KEY=""
ENV ANTHROPIC_API_KEY=""
ENV BASE_URL=""
ENV GOOGLE_URL=""
ENV PERPLEXITY_BASE_URL=""
ENV ANTHROPIC_URL=""
ENV ANTHROPIC_API_VERSION=""
ENV OPENAI_ORG_ID=""
ENV EMPLOYEE_ACCESS_KEYS=""
ENV ADMIN_PASSWORD=""
ENV ADMIN_SECRET=""
ENV NEWBIE_ADMIN_CONFIG_PATH=/app/.data/newbiechat-admin.json
ENV NEWBIE_USAGE_LOG_PATH=/app/.data/newbiechat-usage.json
ENV USAGE_LOG_MAX_RECORDS=20000
ENV CODE=""
ENV ALLOW_USER_PROVIDER_KEYS=""
ENV ALLOW_FAST_LINK_SETTINGS=""
ENV ENABLE_BALANCE_QUERY=""
ENV DISABLE_GPT4=""
ENV CUSTOM_MODELS=""
ENV DEFAULT_MODEL=""
ENV WHITE_WEBDAV_ENDPOINTS=""

RUN apk add --no-cache proxychains-ng \
  && addgroup -S nextjs -g 1001 \
  && adduser -S nextjs -u 1001 -G nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/.next/server ./.next/server

RUN mkdir -p /app/.data /app/app/mcp \
  && chown -R nextjs:nextjs /app/.data /app/app \
  && chmod 700 /app/.data

COPY --from=builder --chown=nextjs:nextjs /app/app/mcp/mcp_config.default.json /app/app/mcp/mcp_config.json

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/config').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD if [ -n "$PROXY_URL" ]; then \
    protocol=$(echo "$PROXY_URL" | cut -d: -f1); \
    host=$(echo "$PROXY_URL" | cut -d/ -f3 | cut -d: -f1); \
    port=$(echo "$PROXY_URL" | cut -d: -f3); \
    conf=/tmp/proxychains.conf; \
    echo "strict_chain" > "$conf"; \
    echo "proxy_dns" >> "$conf"; \
    echo "remote_dns_subnet 224" >> "$conf"; \
    echo "tcp_read_time_out 15000" >> "$conf"; \
    echo "tcp_connect_time_out 8000" >> "$conf"; \
    echo "localnet 127.0.0.0/255.0.0.0" >> "$conf"; \
    echo "localnet ::1/128" >> "$conf"; \
    echo "[ProxyList]" >> "$conf"; \
    echo "$protocol $host $port" >> "$conf"; \
    proxychains -f "$conf" node server.js; \
  else \
    node server.js; \
  fi
