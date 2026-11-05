# Contributing to OLIMP

What OLIMP is and how to use it: [README.md](README.md). How it is built and what comes next:
[docs/](docs/). Rules for AI agents, which apply to people too: [AGENTS.md](AGENTS.md).

## Setup

```sh
mise install          # Node and pnpm from mise.toml
pnpm install          # pnpm only, no npm or yarn
```

You also need `git`, `gh` logged in (`gh auth login`) and `claude` logged in with your own account.

## Run

```sh
pnpm build            # web panel into web/dist (served by pnpm start)
pnpm start            # panel and REST API on http://127.0.0.1:4850, data in ~/.olimp
pnpm mcp              # MCP server on stdio, talks to the running API
pnpm dev:web          # panel with hot reload on http://localhost:5173, API proxied to 4850
```

`pnpm start` and `pnpm mcp` read `.env` when it exists (copy [`.env.example`](.env.example));
`OLIMP_DATABASE_URL` there switches to MySQL, e.g. the one from `docker compose up -d`.

### The web panel

The panel lives in `web/` (Vite, React 19, Tailwind 4) and is a client of the API like any other:

- Data types come from `src/` with `import type` (`web/src/lib/types.ts`), never copied.
- UI components are in `web/src/components/ui/`, shadcn style, copied from the ui-kit without Next:
  `react-router` instead of `next/link`, `use-intl` instead of `next-intl`. Form controls always
  come from there, never native `<select>` or look-alike buttons.
- Every text is a key under `web` in `messages/{en,pl}.json`, read with
  `useTranslations("web")`; `test/i18n.test.ts` checks that every key the panel uses exists.
- Colours are the tokens in `web/src/styles.css` (Graphite, Ochre, Paper from `docs/brand/`), in a
  light and a dark theme; check a change on a phone width too.
- The panel has no component tests: `pnpm typecheck` checks it with `-p web`, and `pnpm build` must
  pass.

## Verify

Before you open a pull request:

```sh
pnpm typecheck        # the API and the panel
pnpm lint
pnpm run test
pnpm build            # when the panel changed
```

CI (`.github/workflows/ci.yml`) runs the same four on every pull request and push to `main`, and
the tests again on MySQL 8.4 and on MariaDB 11.4. Every test sets up its own state, so one test also runs alone:
`node --test --test-name-pattern="<name>" test/<file>.test.ts`.

### Tests on MySQL

`pnpm run test` uses SQLite. `pnpm test:mysql` runs the whole suite on MySQL or MariaDB from
`OLIMP_TEST_MYSQL_URL` (in `.env` or the environment), one file at a time, and the MySQL-only tests
in `test/db.test.ts` stop being skipped:

- Without a database in the URL, a user who may create databases: every test gets its own
  `olimp_test_<random>`, dropped after it. Against `compose.yaml`: `docker compose up -d` and
  `OLIMP_TEST_MYSQL_URL=mysql://root:olimp-root@127.0.0.1:3306`.
- With a database in the URL, e.g. on a hosting account that may not create databases: all tests
  share it and drop its tables before and after each test, so it must hold nothing else. Add
  `?ssl-mode=REQUIRED` over a network. The two tests that create databases and users are skipped.

A change to the schema is a new entry in `MIGRATIONS` (`src/db/migrations.ts`) with SQL for both
databases; run the tests on both before you open a pull request.

## Release

OLIMP is published to npm as `olimp-run` (npm refuses `olimp`). The repository's `package.json`
stays `"private": true`; the package is built apart from it:

```sh
pnpm run package      # .package/olimp-run (src/ compiled to JS, the panel built) and its .tgz
```

Try the tarball as a user would, with a HOME, data and port of its own so no running OLIMP is
touched:

```sh
cd some-repo && HOME=/tmp/try OLIMP_HOME=/tmp/try/olimp OLIMP_PORT=4880 \
  npx --yes --package /path/to/olimp/.package/olimp-run-<version>.tgz olimp-run
```

A release is a tag on `main` matching `version` in `package.json`, which the panel's version window
compares with npm's latest. The tag runs `.github/workflows/publish.yml`: the tests, the package and
`npm stage publish` through npm's trusted publisher, without a token. The version reaches npm once
the maintainer approves it with 2FA:

```sh
git tag v0.0.7 && git push origin v0.0.7
npm stage list olimp-run          # once the workflow is done
npm stage approve <stage id>
```

## How work is done

- Work follows [docs/roadmap.md](docs/roadmap.md) stage by stage. Change only what the current
  stage needs; anything beyond it is a note in the pull request, not code.
- Code, identifiers, comments and docs are in English.
- Branches, pull request titles and the squash commit on `main` follow the Git section of
  [AGENTS.md](AGENTS.md): a branch `typ/krotki-opis` and a title `typ(zakres): opis`.
- New logic comes with a test. A new dependency is a question for the maintainer first.
