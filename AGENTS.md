# AGENTS.md: OLIMP

Instructions for AI agents working on OLIMP. What OLIMP is: [README.md](README.md); how to run,
use and configure it, with the REST API: [docs/guide.md](docs/guide.md); how it is built:
[docs/architecture.md](docs/architecture.md); what comes next: [docs/roadmap.md](docs/roadmap.md).

## Language

- Code is English: identifiers, comments, docs, log and console output. Commit messages and pull
  request titles and descriptions may be Polish (the maintainer's decision).
- Text shown to users goes only through the catalogs in `messages/*.json` (next-intl format, `en`
  default, `pl` second): `t()` from `src/i18n.ts` in the API, `useTranslations("web")` with keys
  under `web` in the panel (`web/`). Change both catalogs together: a test checks that every file in
  `messages/` has the same keys and placeholders, and that every key the panel uses exists.
- Text shown to users is in sentence case, in both catalogs: whatever stands on its own (a title,
  label, button, badge, menu item, placeholder, hint, a fact in a line of facts) starts with a
  capital letter, the rest is lowercase but for proper names, never Title Case. Lowercase only for
  a word the panel puts inside a sentence, a port of the workflow graph, a value written as in code
  (`owner/repo`, `claude.ai`) and the field name an API error starts with; `test/i18n.test.ts`
  lists them.
- API errors are `{ "error": <message in the request's locale>, "code": <catalog key> }`; the code
  is the stable part clients rely on.
- Not translated: tool descriptions written for AI agents (`src/mcp/`), logs and console output,
  and the task `error` and `log` fields (raw output of git, gh and the agents).
- Chat replies to the maintainer (Paweł) stay in Polish.

## Rules

- Work on the current roadmap stage only; anything outside it is a note in the PR, not code.
- Interfaces appear only with their second real implementation: the agent runner has one since
  stage 1 (`src/agents.ts`: Claude, Codex, Junie, OpenCode, Cursor, pi and Copilot) and the database since stage 6 (`src/db/`, SQLite
  and MySQL). Code outside `src/db/` uses only the `Store` interface; a schema change is a new
  numbered migration with SQL for both databases.
- Every capability exposed in the REST API is also an MCP tool in `src/mcp/`, and the other way
  round. The MCP server talks to the API; only the API process opens the database. The exception
  (the maintainer's decision): the panel's sign-in under `/api/auth/` and the caller's own
  password, second factor and sessions under `/api/me/` are REST only, since MCP signs in with a
  token; so are the terminals under `/api/{tasks,workflow-runs}/:id/terminals` and the
  Preview's `/api/preview`, a person's shell and browser in the panel (a step's agent has its own).
- The API trusts anything that reaches it until accounts exist: keep it bound to loopback and keep
  the host, origin and content-type checks in `src/api.ts` (tests in `test/api.test.ts`). With
  accounts every request but `/health` and the sign-in needs a token or the panel's session (a
  password and a mandatory second factor, as in Corivo), and `OLIMP_PUBLIC_HOST` is accepted only
  then (tests in `test/users.test.ts` and `test/auth.test.ts`).
- Secrets never go into the database, logs or the repository: OLIMP uses the installation's own
  `gh` login and each account's own `claude` and `codex` logins in its directory in `OLIMP_HOME`
  (a token from `claude setup-token` pasted in the panel is a file only OLIMP can read there);
  API tokens, passwords, backup codes and sessions are stored only as hashes; the authenticator
  secret, the SMTP password, a project's secrets and its webhook addresses saved in the panel are
  stored encrypted with a key in `OLIMP_HOME/auth.key`, and the API never returns them.
- While the panel loads data it shows a skeleton of the UI that will appear: the view's own layout
  (cards, grids, the same paddings) with `Skeleton` in place of the data, built from
  `web/src/components/skeletons.tsx` and wrapped in `Loading` (`web/src/components/page.tsx`),
  which announces it to screen readers. Never a spinner or loader in place of content: a `Spinner`
  only marks a running action (a button, an upload, an agent at work), and the OLIMP mark only the
  start, before the session decides between the sign-in and the panel.
- A hint or a notice in the panel (what a setting does, what happened after an action) is an
  `Alert variant="info"`, never a grey box; `warning` and `destructive` for what needs attention.
- New logic gets a test; the run pipeline is tested end to end with a local bare repository and
  fake `claude`, `codex` and `gh` (`test/flow.test.ts`).
- pnpm only. A new dependency is a question for the maintainer, not a decision.

## Git

- GitHub flow: `main` is always green (CI) and every change reaches it through a pull request from
  a short-lived branch, merged by squash. No `develop` or release branches; tags come with releases.
- The PR title becomes the commit on `main`, so it follows Conventional Commits with a Polish
  description: `typ(zakres): opis`, e.g. `feat(integrations): integracje MCP przypisane do repo`.
  Types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`, `perf`. The scope is a module
  (`api`, `mcp`, `runner`, `store`, `skills`, `workflows`, `notes`, `integrations`, `issues`,
  `scheduler`, `users`, `web` for the panel) or an area (`roadmap`, `deps`) and may be left out; `!` before the colon marks a
  breaking change. CI checks the title (`.github/workflows/pr-title.yml`).
- Branches are `typ/krotki-opis`, e.g. `chore/konwencja-git`. OLIMP's own tasks keep their
  prefix, `olimp/<task id>`. Commits on a branch are free-form: only the PR title reaches `main`.

## Verification

`pnpm typecheck` (the API and the panel), `pnpm lint`, `pnpm run test` and, when `web/` changed,
`pnpm build`.

Check a change in the app with `pnpm dev` (API on 4851, data in `~/.olimp-dev`, panel on 5175;
`--from-prod` copies the production data). Production on 4850 (`pnpm prod`, data in `~/.olimp`) is
started and stopped by the maintainer only: never start, restart, deploy or build it.
