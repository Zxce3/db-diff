# db-diff

A CLI tool that connects to two database instances — local vs. staging, branch A vs. branch B — compares schemas and row-count distributions, and outputs a human-readable diff plus a migration script suggestion. Runs in CI against PR branches to catch drift before it reaches production.

## Install

```
npm install
npm run build
```

## Usage

```
db-diff --source "postgres://user:pass@staging-host/db" --target "postgres://user:pass@localhost/db"
```

Options:

- `--source <connectionString>` (required) — the reference database, e.g. staging or the base branch
- `--target <connectionString>` (required) — the database being checked, e.g. a PR branch
- `--schema <name>` — schema to compare (default: `public`)
- `--row-count-threshold <percent>` — percent row-count delta considered drift (default: `20`)
- `--fail-on-drift` — exit non-zero if schema or row-count drift is found (for CI)
- `--migration-out <path>` — write the suggested migration SQL to a file instead of stdout
- `--source-ssh <user@host[:port]>` — SSH host to tunnel through to reach `--source` (e.g. a staging bastion)
- `--target-ssh <user@host[:port]>` — SSH host to tunnel through to reach `--target` (e.g. a prod bastion)
- `--ssh-key <path>` — private key to use for tunnels (defaults to `~/.ssh/id_ed25519` or `~/.ssh/id_rsa`)

## Connecting through SSH

When staging or prod databases are only reachable through a bastion host, point `--source`/`--target`
at the connection string as it resolves *from the SSH host* (its hostname, e.g. an internal DNS name
or `localhost` if the DB runs alongside the bastion), and pass the bastion itself via `--source-ssh`
/ `--target-ssh`:

```
db-diff \
  --source "postgres://user:pass@prod-db.internal:5432/app" --source-ssh deploy@bastion.prod.example.com \
  --target "postgres://user:pass@staging-db.internal:5432/app" --target-ssh deploy@bastion.staging.example.com
```

Each side opens its own tunnel independently, so source and target can live behind different bastions
(or one side can connect directly while the other tunnels). Authentication uses your local SSH agent
(`SSH_AUTH_SOCK`) or a private key file (`--ssh-key`, defaulting to `~/.ssh/id_ed25519`/`id_rsa`) —
password-based SSH auth isn't supported.

## CI usage

```
db-diff --source "$STAGING_DATABASE_URL" --target "$PR_DATABASE_URL" --fail-on-drift
```

The suggested migration is a starting point, not a ready-to-run script — review it before applying, especially any `DROP` statements.

## Development

```
npm run dev -- --source ... --target ...
npm test
```
