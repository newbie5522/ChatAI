# NewbieChat Docker Deployment

This guide is the Stage 6 deployment baseline for running NewbieChat as a private company AI workspace with Docker Compose.

## Files

- `Dockerfile`: builds the current repository into a Next.js standalone image.
- `docker-compose.yml`: builds and runs the local `newbiechat` service.
- `.env.template`: copy this file to `.env` and fill in runtime settings.

## Prerequisites

- Docker with Compose V2 must be installed on the deployment host.
- The deployment host must be able to reach the selected Provider APIs, directly or through `PROXY_URL`.

## Quick Start

Copy the environment template:

```powershell
Copy-Item .env.template .env
```

On Linux or macOS:

```bash
cp .env.template .env
```

Edit `.env` before starting the container:

```dotenv
HOST_PORT=3000
ADMIN_PASSWORD=change-this-admin-password
ADMIN_SECRET=change-this-long-random-secret
OPENAI_API_KEY=<openai-api-key>
GOOGLE_API_KEY=
PERPLEXITY_API_KEY=
ANTHROPIC_API_KEY=
EMPLOYEE_ACCESS_KEYS=[{"id":"emp-demo","name":"Demo Employee","accessKey":"change-this-employee-key","status":"active","monthlyQuota":100000,"allowedProviders":["OpenAI","Google","Perplexity","Anthropic"],"allowedModels":["gpt-5.5","gemini-2.5-pro","sonar-pro","claude-sonnet-4-20250514"]}]
```

Start NewbieChat:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3000
```

Admin console:

```text
http://localhost:3000/#/admin
```

Follow logs:

```bash
docker compose logs -f newbiechat
```

Stop:

```bash
docker compose down
```

## Stage 6 VPS Acceptance

Use this on a Linux VPS when you need to validate Docker deployment without spending real Provider credits. The acceptance stack starts NewbieChat plus a local mock OpenAI-compatible streaming service.

Run from the repository root:

```bash
sh scripts/stage6-docker-acceptance.sh
```

The acceptance script uses host port `3100` by default to avoid common conflicts with existing chat apps already using `3000`, `80`, or `443`.

To choose another temporary host port:

```bash
NEWBIECHAT_ACCEPTANCE_HOST_PORT=3310 sh scripts/stage6-docker-acceptance.sh
```

The script validates:

- Docker Compose can build and start the NewbieChat container.
- `http://127.0.0.1:3000/api/config` is reachable.
- `/api/config` does not expose server secrets.
- `EMPLOYEE_ACCESS_KEYS` works through `/api/employee-auth`.
- `/api/gateway/openai/v1/chat/completions` accepts `Authorization: Bearer nk-stage6-key`.
- Gateway streaming returns `pong` and `[DONE]` from the mock Provider.

By default, the script cleans up the acceptance stack after passing. To keep it running for manual inspection:

```bash
KEEP_STAGE6_ACCEPTANCE_STACK=1 sh scripts/stage6-docker-acceptance.sh
```

## Runtime Configuration

The Compose file passes these server-only variables into the container:

- `EMPLOYEE_ACCESS_KEYS`
- `ADMIN_PASSWORD`
- `ADMIN_SECRET`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `PERPLEXITY_API_KEY`
- `ANTHROPIC_API_KEY`
- `NEWBIE_ADMIN_CONFIG_PATH`
- `NEWBIE_USAGE_LOG_PATH`

Default Docker storage paths:

```dotenv
NEWBIE_ADMIN_CONFIG_PATH=/app/.data/newbiechat-admin.json
NEWBIE_USAGE_LOG_PATH=/app/.data/newbiechat-usage.json
```

`docker-compose.yml` mounts the named volume `newbiechat-data` at `/app/.data`, so administrator settings, provider settings, employee records, and usage records survive container restarts.

To use a host directory instead of the named volume, replace the volume mount with a writable directory:

```yaml
volumes:
  - ./data:/app/.data
```

On Linux servers, ensure the mounted directory is writable by container user `1001`.

## Security Notes

- Do not put provider keys into any `NEXT_PUBLIC_*` variable.
- Do not commit `.env`; it is ignored by git and Docker build context.
- Provider keys are read server-side and injected by Gateway routes.
- `/api/config` returns frontend feature flags and model rules only; it does not return provider keys.
- `ALLOW_USER_PROVIDER_KEYS` is empty by default, so employees cannot use their own provider API keys unless explicitly enabled.
- `PROXY_URL` is empty by default. Set it only when the container must access providers through a forward proxy.

## Gateway Checks

Employee access keys are accepted by the UI access flow. Direct Gateway API calls must send the employee key with the NewbieChat access-code prefix:

```bash
curl http://localhost:3000/api/gateway/openai/v1/chat/completions \
  -H "Authorization: Bearer nk-change-this-employee-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"ping"}],"stream":true}'
```

The Gateway keeps the upstream response body as a stream, so streaming responses remain available in Docker deployment.
