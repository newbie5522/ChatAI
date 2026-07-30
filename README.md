# NewbieChat

NewbieChat is an internal AI workspace based on the open-source NextChat project.

This repository is used for company-level secondary development, including:

- Internal employee username/password accounts
- Company-managed AI provider credentials and routing
- OpenAI / Google Gemini / Perplexity / Claude gateway integration
- Prompt usage tracking and quota control
- Admin management panel
- Company prompt and mask templates
- Multi-model chat, vision, and image generation workflows

## Project Status

This project is currently under active internal development.

Current phase:

- Base project: NextChat
- Rebrand name: NewbieChat
- Development mode: controlled file-by-file secondary development

## Development Rules

This project must follow these rules:

1. Do not rebuild the project from scratch.
2. Keep the original NextChat structure unless a change is explicitly approved.
3. Do not write any official API key into the source code.
4. Do not expose provider API keys to ordinary employees.
5. Do not add new model providers unless explicitly approved.
6. Do not modify core chat logic unless the task requires it.
7. Each development task must list modified files clearly.
8. Each change must be reviewed before moving to the next task.

## Local Development

Install dependencies:

```bash
yarn install
```

Start development server:

```bash
yarn dev
```

Open:

```text
http://localhost:3000
```

## Build

```bash
yarn build
```

## First-time Initialization

1. Deploy NewbieChat.
2. Open `/#/admin`.
3. Log in with the bootstrap `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
4. Configure OpenAI / Google / Perplexity / Anthropic Provider Credentials.
5. One Provider Credential applies to chat, search, and image models under that Provider.
6. Use "Test" only for troubleshooting; it is not required before normal use.
7. Enable the models employees should be able to use. Models do not need per-model verification.
8. Create employee accounts with username/password.
9. Assign employee quota, allowed categories, and allowed model IDs.
10. Employees log in through the original-style Auth page.
11. Employees see the model selector grouped as Chat, Search, Image, and Video.
12. Employees can use authorized chat, search, and image models from the existing chat input.
13. Image generation uses default parameters in this first version; there are no aspect ratio, quality, style, or image count settings.
14. The Video group is shown as coming soon until video adapters are implemented.
15. Ordinary employees do not see or enter official Provider API Keys.

`.env` is startup-only configuration. Provider Keys, employee accounts, quotas, and model permissions are managed in `/#/admin`.

Feature branches are not production-ready by themselves. Before internal release, review the GitHub diff, merge to `main` only after approval, confirm the GHCR image builds successfully, pull the new image on the VPS, and verify real account login, chat, search, image generation, and prompt logs.

## Deployment

The project will be deployed as a private company AI workspace.

Recommended deployment targets:

- VPS + Docker
- Vercel
- Private cloud environment

Docker deployment guide: [docs/docker-deployment.md](docs/docker-deployment.md).

## License

This project is based on the open-source NextChat project and keeps the original MIT license.
