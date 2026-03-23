# Ramp CLI

Public command-line client for Ramp.

This repository contains the CLI only. It talks to the hosted Ramp API, while
the main Ramp application/backend remains private and is not included here.

## Open Source Boundary

- This repo is the public CLI source code.
- The Ramp web app, API internals, and deployment platform are not part of this repository.
- End users can install and use the CLI normally against Ramp.
- Some local development flows in this repo expect access to a Ramp backend instance.

## Install

```bash
pnpm add -g @ramp-sh/cli
```

Or run it without installing:

```bash
pnpm dlx @ramp-sh/cli --help
```

## Login

```bash
ramp login --api-url http://127.0.0.1:8000
```

You can also provide email up front:

```bash
ramp login --email you@example.com --api-url http://127.0.0.1:8000
```

Or use an existing API token (useful for CI):

```bash
ramp login --token rmp_cli_... --api-url https://api.ramp.sh
```

Check current identity:

```bash
ramp whoami
```

Link current project (creates `.ramp/config.json`):

```bash
ramp link
```

Unlink current project:

```bash
ramp unlink
```

Show app status (auto-resolves project):

```bash
ramp status
```

List account apps and servers:

```bash
ramp apps
ramp servers
```

Fetch logs and execute commands:

```bash
ramp logs --type laravel
ramp exec "php artisan about"
ramp run migrate
ramp run --list
```

Manage env vars:

```bash
ramp env list
ramp env set APP_ENV production
ramp env delete APP_ENV
ramp env pull --output .env
ramp env push --file .env
```

Create app and auto-link current directory:

```bash
ramp create
```

Initialize a new `ramp.yaml`:

```bash
ramp init
ramp init --template laravel
ramp init --template laravel-octane
ramp init --template adonis
ramp init --template nextjs
ramp init --template static
ramp init --template worker
ramp init --template node-api --yes --print
ramp init --template laravel --yes --json
```

Trigger deploy (auto-resolves project):

```bash
ramp deploy
```

Rollback app (latest successful deploy by default):

```bash
ramp rollback
```

Logout:

```bash
ramp logout
```

## Usage

```bash
pnpm dlx @ramp-sh/cli validate
```

`validate` uses remote API validation only.
Default API URL is `http://127.0.0.1:8000` (or `RAMP_API_URL` if set).
Remote validation requires a CLI token from `ramp login`.
Use `--server <id-or-name>` to include server-level collision checks (ports/domains).

CI/CD auth can use `RAMP_TOKEN` directly (takes precedence over local credentials file).

Auto project resolution (used by `status` and `deploy`) priority:

1. `--app` / `--server` flags
2. `.ramp/config.json` link file
3. nearest `ramp.yaml` stack lookup via API

Remote validation against local app:

```bash
pnpm dlx @ramp-sh/cli validate --api-url http://localhost:8000
```

Validate a specific file:

```bash
pnpm dlx @ramp-sh/cli validate ./path/to/ramp.yaml
```

JSON output:

```bash
pnpm dlx @ramp-sh/cli validate --json
```

Strict mode (warnings fail with exit code 2):

```bash
pnpm dlx @ramp-sh/cli validate --strict
```

## Init templates

`ramp init` supports:

- `custom`
- `laravel`
- `node-api`
- `nextjs`
- `adonis`
- `static`
- `worker`

When `ramp.yaml` already exists, interactive mode offers `overwrite`, `merge`, or `cancel`.
With `--yes`, existing files default to a safe merge; use `--force` to overwrite.
Use `--json` to emit metadata for scripting. The JSON payload includes the generated YAML.

## Local development

```bash
pnpm install
pnpm sync-schema
pnpm build
pnpm test
node dist/bin.js validate fixtures/valid.ramp.yaml
```

For local development against a Ramp backend, point the CLI at a reachable API
instance with `--api-url` or `RAMP_API_URL`.

## Quality Checks

```bash
pnpm format
pnpm lint
pnpm check
pnpm verify
```

`pnpm install` also configures repo-local git hooks via `.githooks/`:

- `pre-commit` runs Biome formatting checks on staged files
- `pre-push` runs `pnpm typecheck` and `pnpm test`

The repository uses Biome as a formatter baseline in CI today. The `lint`
command is available for deeper cleanup as the codebase evolves.
