# Agriculture ERP — CORWADO

A farmer registration and extension-services system for **CORWADO**, an
agricultural organisation working in South Sudan. Built by **Cyber Dhators**.

**Who uses it.** Extension officers in the field, on Android phones, often with
no signal — they register farmers, map farm boundaries and record visits
offline, and their work uploads when a connection returns. Supervisors and
administrators use a web portal to verify registrations, manage users and read
reports. Farmers themselves are reached by SMS in this phase; they do not
install anything.

**Why the rules are strict.** The records are real people's names, phone
numbers, national IDs and land. Donor reach figures are calculated from them. A
defect here is not a bad afternoon.

---

## Read these first

| Document                      | When                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`CLAUDE.md`**               | Before anything. The law: scope, stack, and the rules every change follows.                                                                                                                                                 |
| **`docs/PROJECT-STATE.md`**   | **Read at the start of every session.** What is true now and must be acted on. Under two pages.                                                                                                                             |
| **`docs/api/CONVENTIONS.md`** | **Read at the start of every session that touches an API route.** Route shapes, status codes, exact error messages. Written to be sufficient alone — you can write tests against a route from it without reading the route. |
| `docs/UNITS.md`               | What B1.4, B3, B11 and the rest mean, and who owns each.                                                                                                                                                                    |
| `docs/DECISIONS.md`           | Why things are as they are. Not needed to start work; read before undoing something.                                                                                                                                        |

`docs/scope-and-acceptance.md` is named by `CLAUDE.md` as the scope authority
and **does not exist yet**. It blocks B2. See `docs/PROJECT-STATE.md`.

---

## Running it locally

**You need** Node 24 and pnpm 11.25.0 (`corepack enable` will get the right
pnpm from `packageManager` in `package.json`).

```bash
pnpm install
cp .env.example .env.local     # then fill in the staging values
pnpm dev                       # http://localhost:3000
```

`.env.local` is git-ignored and holds **staging** values only. Never put
production values in it. Every variable is listed in `.env.example`, and
`docs/PROJECT-STATE.md` says what each is for. With no Sentry DSN set, error
reporting is simply off — nothing fails.

## Commands

| Command             | What it does                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm dev`          | Runs the web portal in development on port 3000.                                                       |
| `pnpm build`        | Production build of every package.                                                                     |
| `pnpm test`         | Runs the whole Vitest suite once.                                                                      |
| `pnpm typecheck`    | TypeScript, no emit, across every package.                                                             |
| `pnpm lint`         | ESLint across the repository.                                                                          |
| `pnpm format`       | Rewrites formatting with Prettier.                                                                     |
| `pnpm format:check` | Checks formatting without rewriting. This is what CI runs.                                             |
| `pnpm db:migrate`   | Applies pending migrations to the database in `.env.local` (staging).                                  |
| `pnpm db:seed`      | Loads generated fake data. Wired up but **empty until B2**. Never real farmer data.                    |
| `pnpm db:studio`    | Opens Prisma Studio against staging.                                                                   |
| `pnpm db:reset`     | **Destructive.** Drops and rebuilds the database. Guarded: it refuses any project that is not staging. |

**Before committing, run the same gate CI runs:** `pnpm typecheck && pnpm lint &&
pnpm format:check && pnpm test && pnpm build`. Do not leave to CI what you could
find locally.

**Never push to `main`.** Feature branches and pull requests only.

---

## What is in here

`apps/web` is the Next.js portal, `apps/mobile` is a placeholder for the Flutter
app, and `packages/shared` holds the Zod schemas and the Sentry scrubber that
both surfaces validate against. Everything else:

| File                                                            | What it is for                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `CLAUDE.md`                                                     | The law. Scope, stack, the rules, and when to stop and ask.              |
| `README.md`                                                     | This file.                                                               |
| `docs/PROJECT-STATE.md`                                         | Running state. Read every session.                                       |
| `docs/api/CONVENTIONS.md`                                       | How every API route behaves. Read before touching a route.               |
| `docs/UNITS.md`                                                 | Unit numbers, what each covers, who owns it.                             |
| `docs/DECISIONS.md`                                             | Append-only record of why.                                               |
| `.env.example`                                                  | Every environment variable, by name. Never any value.                    |
| `.github/workflows/ci.yml`                                      | CI: typecheck, lint, format, test, then a gitleaks scan of full history. |
| `.gitleaks.toml`                                                | Secret-scanning rules — the credential shapes this project uses.         |
| `.gitignore`                                                    | Notably `.env` and `.env.local`.                                         |
| `.prettierrc.json`                                              | Formatting rules.                                                        |
| `.prettierignore`                                               | What formatting skips. `CLAUDE.md` is never reformatted by tooling.      |
| `package.json`                                                  | Workspace root: the commands above, and exact dependency pins.           |
| `pnpm-workspace.yaml`                                           | Workspace layout, and which dependency build scripts may run.            |
| `pnpm-lock.yaml`                                                | The locked dependency tree. CI installs from this, frozen.               |
| `tsconfig.base.json`                                            | Shared TypeScript settings. Strict, with unchecked-index access on.      |
| `vitest.config.mts`                                             | Test setup. Loads `.env.local` so database tests can run locally.        |
| `prisma/schema.prisma`                                          | Database schema and the pooled-plus-direct connection pattern.           |
| `prisma/migrations/`                                            | Hand-written SQL migrations, applied with `migrate deploy`.              |
| `prisma/migrations/migration_lock.toml`                         | Records the provider as PostgreSQL.                                      |
| `apps/web/package.json`, `apps/web/tsconfig.json`               | Web app dependencies and TypeScript settings.                            |
| `apps/web/next.config.ts`                                       | Next config, wrapped for Sentry.                                         |
| `packages/shared/package.json`, `packages/shared/tsconfig.json` | Shared package settings.                                                 |
| `apps/mobile/.gitkeep`                                          | Placeholder. The Flutter app is not built yet.                           |

Two API routes under `/api/_dev/` exist only to prove things work and are
**deleted in B3**. They are unauthenticated, which every other route is
forbidden to be. See `docs/PROJECT-STATE.md`.
