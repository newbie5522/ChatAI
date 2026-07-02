# NewbieChat

NewbieChat is an internal AI workspace based on the open-source NextChat project.

This repository is used for company-level secondary development, including:

* Internal employee access keys
* Company-managed AI provider routing
* OpenAI / Google Gemini / Perplexity gateway integration
* Usage tracking and quota control
* Admin management panel
* Company prompt and mask templates
* Multi-model chat, vision, and image generation workflows

## Project Status

This project is currently under active internal development.

Current phase:

* Base project: NextChat
* Rebrand name: NewbieChat
* Development mode: controlled file-by-file secondary development

## Development Rules

This project must follow these rules:

1. Do not rebuild the project from scratch.
2. Keep the original NextChat structure unless a change is explicitly approved.
3. Do not write any official API key into the source code.
4. Do not expose provider API keys to the frontend.
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

## Deployment

The project will be deployed as a private company AI workspace.

Recommended deployment targets:

* VPS + Docker
* Vercel
* Private cloud environment

## License

This project is based on the open-source NextChat project and keeps the original MIT license.
