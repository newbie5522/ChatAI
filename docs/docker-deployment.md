# NewbieChat Docker Deployment

NewbieChat production deployment uses the GHCR prebuilt image. A small VPS should pull the image and run it; it should not build the Next.js image locally.

## Files

- `Dockerfile`: used by GitHub Actions to build the prebuilt image.
- `docker-compose.yml`: development/local build only.
- `docker-compose.prod.yml`: production VPS deployment using `ghcr.io/newbie5522/newbiechat:latest`.
- `scripts/deploy-vps.sh`: pulls the production image and starts the stack.
- `.env.template`: startup-only configuration.

## VPS Production Deployment

Use `main` for production and VPS deployment:

```bash
cd /opt
rm -rf newbiechat
git clone -b main https://github.com/newbie5522/ChatAI.git newbiechat
cd newbiechat
cp .env.template .env
nano .env
sh scripts/deploy-vps.sh
```

For a normal VPS deployment, `.env` only needs startup settings:

```dotenv
HOST_PORT=3100
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
ADMIN_SECRET=change-this-secret
ADMIN_COOKIE_SECURE=
```

For direct HTTP access such as `http://SERVER_IP:3100`, leave `ADMIN_COOKIE_SECURE` empty. Only set `ADMIN_COOKIE_SECURE=1` when NewbieChat is served through HTTPS.

If admin login succeeds but the page still says admin authentication is required, check whether `ADMIN_COOKIE_SECURE` is incorrectly enabled while using HTTP.

Open NewbieChat:

```text
http://SERVER_IP:3100
```

Then initialize the workspace in the admin panel:

1. Open `http://SERVER_IP:3100/#/auth`.
2. Log in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
3. Open `http://SERVER_IP:3100/#/admin`.
4. Add Provider Credentials for OpenAI, Anthropic, Google, and Perplexity.
5. One Provider Credential applies to chat, search, and image models under that Provider.
6. Use "Test" only for troubleshooting; it is not required before normal use.
7. Enable the models that should be available to employees. Per-model verification is not required.
8. Create employee accounts with username/password.
9. Assign employee quota, allowed categories, and allowed model IDs.
10. Employees log in through `/#/auth`.
11. Employees see Chat, Search, Image, and Video groups in the existing model selector.
12. Employees can use authorized chat, search, and image models from the existing chat input.
13. Image generation uses default parameters in this first version; there are no aspect ratio, quality, style, or image count settings.
14. The Video group is shown as coming soon until video adapters are implemented.

Do not maintain Provider API Keys, employee accounts, quotas, or model permissions in `.env` for normal operations. They belong in `/#/admin`.

## Production Image

GitHub Actions publishes:

```text
ghcr.io/newbie5522/newbiechat:latest
ghcr.io/newbie5522/newbiechat:<commit-sha>
```

`docker-compose.prod.yml` uses `image:` only and does not contain `build:`.

If the GHCR package is private, log in on the VPS before running the deploy script:

```bash
docker login ghcr.io
```

For simpler one-command deployment, set the GHCR package visibility to public.

## Do Not Build On VPS

Do not use this for formal VPS deployment:

```bash
docker compose up -d --build
```

A 1GB VPS is not suitable for local `yarn install`, `yarn build`, or `next build`. Formal deployment should use:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

or:

```bash
sh scripts/deploy-vps.sh
```

## Release Gate

Do not use a feature branch directly for internal production. Before opening NewbieChat to employees:

1. Review the GitHub diff for the feature branch.
2. Merge to `main` only after approval.
3. Confirm GitHub Actions builds and publishes the GHCR image successfully.
4. Pull the new image on the VPS.
5. Verify real account login, chat, search, image generation, and usage logs.

## Runtime Storage

By default, Docker stores administrator configuration and prompt usage logs in the named volume `newbiechat-data`:

```dotenv
NEWBIE_ADMIN_CONFIG_PATH=/app/.data/newbiechat-admin.json
NEWBIE_USAGE_LOG_PATH=/app/.data/newbiechat-usage.json
```

The stored admin configuration contains account records, password hashes, Provider Credentials, model catalog overrides, quota settings, and model permissions. Provider Keys are only read server-side and are not returned to employees.

## Vercel Deployment

Vercel can deploy directly from the GitHub `main` branch.

Set these Environment Variables in Vercel:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
ADMIN_SECRET=change-this-secret
ADMIN_COOKIE_SECURE=1
NEWBIE_ADMIN_CONFIG_PATH=
NEWBIE_USAGE_LOG_PATH=
```

Do not put real Provider API Keys into source code. Configure Provider Credentials after deployment in `/#/admin`.

Vercel builds in the cloud and does not consume VPS resources.

## Security Notes

- Employees log in with username/password through `/#/auth`.
- Employees do not see official Provider API Keys.
- Employees only see models that are enabled, implemented, credential-backed, and assigned to their account.
- Gateway performs login checks, role checks, model permission checks, quota checks, credential selection, and prompt logging.
- Usage logs record employee prompts only; model output is not stored.
- The Settings page only contains a lightweight admin entry for admin roles. The actual management UI is isolated in `app/components/admin-panel.tsx`.
