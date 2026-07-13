# NewbieChat Docker Deployment

This guide explains how to run NewbieChat as a private company AI workspace with Docker Compose.

## Files

- `Dockerfile`: builds the current repository into a Next.js standalone image.
- `docker-compose.yml`: builds and runs the local `newbiechat` service.
- `.env.template`: copy this file to `.env` and fill in runtime settings.

## Prerequisites

- Docker with Compose V2 must be installed on the deployment host.
- The deployment host must be able to reach the selected Provider APIs, directly or through `PROXY_URL`.

## Quick Start

Clone the official main branch:

```bash
git clone -b main https://github.com/newbie5522/ChatAI.git newbiechat
cd newbiechat
```

Copy the environment template:

```powershell
Copy-Item .env.template .env
```

On Linux or macOS:

```bash
cp .env.template .env
```

Edit only the required startup settings in `.env` before starting the container:

```dotenv
HOST_PORT=3000
ADMIN_PASSWORD=change-this-admin-password
ADMIN_SECRET=change-this-long-random-secret
```

Do not put employee keys or Provider API Keys in `.env` for normal use. After deployment, open `/#/admin`, configure Provider Keys in Provider Config, and create employee keys in Employee Keys.

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

## VPS Deployment

Use `main` for all production and VPS deployments:

```bash
cd /opt
rm -rf newbiechat
git clone -b main https://github.com/newbie5522/ChatAI.git newbiechat
cd newbiechat
cp .env.template .env
nano .env
```

For a normal VPS deployment, `.env` only needs the startup settings:

```dotenv
HOST_PORT=3100
ADMIN_PASSWORD=change-this-admin-password
ADMIN_SECRET=change-this-long-random-secret
```

Do not put employee keys or Provider API Keys in `.env` for normal use. `EMPLOYEE_ACCESS_KEYS`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `PERPLEXITY_API_KEY`, and `ANTHROPIC_API_KEY` are optional bootstrap or fallback variables only.

Start the service:

```bash
docker compose up -d --build
```

After deployment, open:

```text
http://YOUR_SERVER:3100/#/admin
```

Use the admin console as the normal initialization flow:

1. Log in with `ADMIN_PASSWORD`.
2. Configure OpenAI / Google / Perplexity / Anthropic Provider API Keys in Provider Config.
3. Create employee keys in Employee Keys.
4. Give employees only their employee keys for frontend access.
5. Ordinary employees should not see or enter official Provider API Keys.

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

Only `ADMIN_PASSWORD`, `ADMIN_SECRET`, and `HOST_PORT` are part of the normal first-start setup. `EMPLOYEE_ACCESS_KEYS` and Provider API Key environment variables are optional bootstrap or fallback inputs. For ongoing operations, manage employees and Provider Keys in `/#/admin`.

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
- Provider keys are managed in the admin console for normal use, read server-side, and injected by Gateway routes.
- Do not maintain employee keys or Provider API Keys in `.env` long term unless you intentionally need bootstrap or fallback behavior.
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
