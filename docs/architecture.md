# Architecture

## Modules

- `src/store.ts`: the entry point to the database: `Store` is the `Database` interface and
  `Store.open({ home, databaseUrl })` picks the implementation, MySQL when `OLIMP_DATABASE_URL` is
  set and SQLite otherwise. The rest of the code knows only the interface (see
  [Database](#database)).
- `src/db/database.ts`: the `Database` interface and the types it stores and returns.
- `src/db/sqlite.ts`: SQLite through the built-in `node:sqlite`, WAL mode, one file in
  `OLIMP_HOME`, with the adoption of databases from before numbered migrations.
- `src/db/mysql.ts`: MySQL through a `mysql2` pool: parsing the URL, creating a missing database,
  the migration lock and errors that never carry the password.
- `src/db/migrations.ts`: the numbered migrations, each with its SQL for SQLite and for MySQL.
- `src/db/rows.ts`: what both share: rows to objects (workflow definitions saved before stage 5
  get `integrations: []` on their agent nodes when read), ids and the SET clause of a patch.
- `src/agents.ts`: the agent runner interface, one entry per coding agent (`claude`, `codex`): the
  binary, its arguments and extra environment for a prompt, a working directory and the step's
  MCP servers and the repository's commands. How MCP servers and commands reach an agent differs
  per agent, so it lives here.
- `src/sandbox.ts`: what an agent may see and run: the allowed environment of an agent process
  (with an account's `HOME` for its steps), `OLIMP_AGENT_ENV`, and the validation of a
  repository's commands.
- `src/users.ts`: accounts: roles, tokens and their SHA-256 hashes, the account directories in
  `OLIMP_HOME` and the `HOME` of an account's agent step, with the check of its agent login.
- `src/agent-login.ts`: `pnpm agent-login <claude|codex> [login]`: asks the API whose `OLIMP_TOKEN` it is
  and starts the agent CLI interactively with that account's `HOME`; it never opens the database.
- `src/proc.ts`: child processes: OLIMP's own tools (git, gh) get its environment without the
  database URLs, an agent only the environment the runner gives it. An agent runs in a process
  group of its own, its stdout read line by line; a timeout or a cancel stops the group (SIGTERM,
  SIGKILL after 5 seconds), and `main.ts` kills every group still running when OLIMP stops.
- `src/trace.ts`: reading an agent's JSON lines (Claude's `stream-json`, Codex's `exec --json`)
  into events, the final answer and usage; the event limits and the retention purge.
- `src/bus.ts`: the in-process event bus and `publishing(store, bus)`, the store that publishes
  every change of a task, a run or an agent event once it is stored.
- `src/integrations.ts`: MCP integrations of a repository: the `stdio` and `http` configurations,
  their validation (names, `${NAME}` references, the `Authorization` rule), the variables a
  configuration refers to and their expansion for agents that do not expand them.
- `src/issues.ts`: GitHub issues as a task source: the poll of every repository with issues
  switched on and the timer that runs it.
- `src/github.ts`: a project's issues and pull requests through `gh` for the panel, a pull
  request's merge state from GitHub's `mergeStateStatus` and checks, merging pinned to the head
  SHA, labels on the pull requests OLIMP opens (the agent's `OLIMP:TYPE` marker read and taken
  off its answer) and the auto-merge poll.
- `src/changes.ts`: what a job's branch changes against the default branch, read from the clone
  with git (no fetch): changed files with line counts and the unified diff, both capped; the
  branch's own commits, one commit's diff, the files of its head and one file's content.
- `src/web.ts`: serving the built panel from `web/dist`: content types, cache headers, the fallback
  to `index.html` for panel routes and the panel's security headers.
- `web/`: the web panel (Vite, React 19, Tailwind 4), a client of the REST API (see
  [Web panel](#web-panel)).
- `src/clones.ts`: where a repository works and how it gets there through the installation's
  `gh`: its own folder (a local one the admin picked, or a clone in `OLIMP_PROJECTS`), OLIMP's
  clone in `OLIMP_HOME/repos/` for one registered before folders, clones of skills repositories in
  `OLIMP_HOME/skills/`, fetched on every use (a skills repository: see [Skills](#skills)); registering a project, which fetches or clones it
  first; new repositories through `gh repo create` (with a README or from a template); the `gh`
  account and its organizations; the folder picker, which lists only visible subfolders inside
  `OLIMP_BROWSE_ROOT` and resolves symlinks before checking.
- `src/jobs.ts`: what every job shares: the jobs running now with their `AbortController`s
  (cancelling them, and their count for the self-update), the claim of a queued job, its final
  status after an error or a cancel, and the runs `parked` with their worktree kept.
- `src/worktrees.ts`: a job's worktree (or the project's checkout, or a folder without git) from
  creation to removal: the project's setup and cleanup scripts, the finished worktrees a project
  keeps and the reopening of a parked run's. It owns the worktree's `.olimp/` directory: the check
  that the repository has none and the `info/exclude` entry.
- `src/terminals.ts`: a task thread's interactive shells (see [Terminal](#terminal)): one PTY each
  through the optional `@lydell/node-pty`, the scrollback, the host's shells, the process table
  that names a tab and stops its tree, and the addresses printed in the output.
- `src/project-commands.ts`: the commands a worktree's `package.json` and `Makefile` offer the
  terminal's Run menu.
- `src/preview.ts`: the Preview's proxies (see [Preview](#preview)): one listener per app, the
  script it adds to pages and the WebSocket splice.
- `src/agent-step.ts`: one agent step, the same for a task and a workflow node: the prompt, the
  CLI call (retried when Claude's login refresh collided with another Claude process), its trace
  events, the knowledge base's MCP server and token when the project has it on, and the `.olimp/`
  cleanup after it; also `askAgent`, one answer outside any worktree.
- `src/pull-requests.ts`: the commit, push and pull request that end a task or a workflow's PR
  node, with the line counts of the change and the account that asked for it.
- `src/workflow-runner.ts`: a workflow run walks its graph with a plain `switch` on the node type,
  parks while it waits and is woken by an answer, CI, its children or a timeout (`startWaits`); a
  task or run that ends wakes the run waiting for it.
- `src/runner.ts`: runs a task (worktree, agent with its skill, commit, push and PR, cleanup, with
  threads, dispatch and subtasks) and the worker that takes up to the parallel limit of tasks and
  workflow runs at once.
- `src/memory.ts`: repository memory: slug and text rules shared with the API, the search, the
  graph, and the knowledge base of an agent step: its token, its `olimp-memory` server and the
  paragraph of its prompt.
- `src/workflow-graph.ts`: the workflow graph shared with the panel: node types, ports, outputs,
  validation, the walk through ports and loops, templates, the layout, import of older workflow files and
  the built-in templates.
- `src/workflows.ts`: the field validation of a definition on save.
- `src/workflow-nodes.ts`: what the check, if, git and GitHub nodes and the webhook node do.
- `src/workflow-builder.ts`: a workflow planned by the project's agent from a description.
- `src/skills.ts`: skills repositories: registration and removal, the skill list read from the
  clone, resolving a skill name, and copying a skill into a task's worktree.
- `src/settings.ts`: the settings the panel changes (parallel jobs, agent time limit, the projects
  and browse folders): checked, saved in the `settings` table as JSON and applied to the running
  configuration at once; the environment gives the defaults, and a saved value that no longer holds
  (a folder that is gone) falls back to it with a warning at start.
- `src/machine.ts`: the machine for the panel (host, user, CPU use since the previous call, memory,
  load, cores, OLIMP's own process), the installed agents with their versions and whether the
  caller is logged in, and OLIMP's version: the git checkout it runs from, a check of `origin` at
  start and every six hours, and the self-update (see [Version and update](#version-and-update)).
- `src/cron.ts`: the five-field cron parser and matcher, without a dependency.
- `src/limits.ts`: input limits shared by the API checks and the MCP tool schemas; it imports
  nothing, so the MCP process stays a thin client.
- `src/scheduler.ts`: every minute queues the tasks of due automations.
- `src/api.ts`: REST API on loopback, with the host, origin and content-type checks and, once
  accounts exist, the token check, the event stream (`GET /api/events`) and the error format; it
  asks the route modules in `src/api/` in turn, one per domain (users, projects, GitHub, system,
  agents, project settings, integrations, memory, skills, tasks, automations, workflows, the panel's
  sign-in and a dispatched task's subtasks), each a `…Route` function that answers or returns
  `undefined` for a path not its own; the input checks several of them share are in
  `src/api/shared.ts`. `src/main.ts` refuses `OLIMP_PUBLIC_HOST` without accounts, wraps the store
  with the bus and starts the API, the worker, the scheduler, the issue poller and the event purge.
- `src/mcp.ts`: MCP server on stdio, a thin client of the API; it sends `Accept-Language` from
  `OLIMP_LOCALE` and `Authorization: Bearer` from `OLIMP_TOKEN`. With `OLIMP_STEP_TOKEN` it is an
  agent step's `olimp-memory` server: only the memory and note tools, the token in `x-olimp-step`. The tools live in `src/mcp/`, one
  module per domain (projects, project settings, GitHub, integrations, tasks, workflows,
  automations, skills, memory, users, agents, system), each a `register…Tools` function given
  the server and the API client; the schemas several of them share are in `src/mcp/shared.ts`.
- `src/i18n.ts` and `messages/{en,pl}.json`: text shown to users. The catalogs use the next-intl
  format (nested keys, `{name}` placeholders), so the panel reads the same files through `use-intl`
  (its texts under `web`); `t(locale, key, params)` is typed against `en.json`, and the locale
  comes from `Accept-Language` (fallback `en`).

## Error format

Every API error is JSON `{ "error": "<message>", "code": "<key>" }`. `code` is the catalog key
(e.g. `repo.notRegistered`, `skill.unknown`, `automation.invalidCron`, `request.notFound`) and
stays stable; `error` is the message in the request's locale. Unexpected failures are
`request.internal` with the raw cause (git, gh, database output) inside the message, untranslated.
The task `error` and `log` fields are raw output too.

## Data model

- `users`: `id` (12 hex characters), `name` (unique), `role` (`admin` or `member`), `created_at`.
- `tokens`: `id`, `user_id` (a foreign key to `users`), `hash` (unique: the SHA-256 hex of the
  token, never the token), `created_at`.
- `repos` (projects): `id` (a short slug from the folder's name, `[a-z0-9-]`, `-2` when taken;
  migration 9 turned the `owner/name` ids of all tables into slugs: the repository name, or
  `owner-name` when two share it), `github` (`owner/name` on GitHub, null for a local project;
  migration 9), `default_branch` (`""` for a folder without git), `added_at`, `issue_label` (the label of issues
  that become tasks, null when issues are off), `issue_author` (the account that switched issues
  on, whose tasks they become; migration 5), `commands` (JSON list of the shell commands agents check
  their work with, null for none; migration 4), `path` (the folder the repository works in; null for one
  registered before migration 7, which keeps OLIMP's clone in `OLIMP_HOME/repos/`), and from
  migration 17 three JSON columns, null for none: `settings` (the project's system prompt, where a
  task works by default, how many finished worktrees stay), `secrets` (name to a value sealed with
  `OLIMP_HOME/auth.key`) and `webhooks` (receivers with a sealed address and, for ntfy, an
  optional sealed `token`, absent in older rows). The last two never appear in a `Repo`: the
  store reads them on their own, so no project listing carries them.
- Every table of things people make (`tasks`, `automations`, `workflows`, `workflow_runs`,
  `notes`, `memory_pages`, `memory_sections`) has `author`: the account id, null without accounts
  and for rows from before migration 5. No foreign key: a deleted account stays the author.
- `skill_sources`: `id`, `default_branch`, `added_at`, for skills repositories.
- `integrations`: primary key `repo` and `name` (`[\w-]{1,50}`), `kind` (`stdio` or `http`),
  `config` (JSON: `command`, `args`, `env`, or `url`, `headers`; values of `env` and `headers`
  hold `${NAME}` references, never secrets), `created_at`, `updated_at`.
- `tasks`: `id` (12 hex characters), `repo`, `title`, `body`, `agent` (`claude` by default or
  `codex`), `skill` (`owner/repo:name` or null), `integrations` (JSON list of integration names of
  the repository, `[]` by default), `automation` (id of the automation that queued it, or null;
  kept after the automation is deleted), `issue` (the GitHub issue number or null; a unique
  index on `repo` and `issue` keeps one task per issue), `thread` (the first task of the thread a
  continuation belongs to, null for a first task; indexed with `created_at`), `retry_of` (the task
  it retries), `status` (`queued`, `running`, `done`, `failed`, `cancelled`), `branch`, `pr_url`,
  `error`, `log` (the agent's final answer, or the last 100 kB of its raw output when it gave
  none), usage (`turns`, `cost_usd`, `input_tokens`, `output_tokens`, `duration_ms`; null until an
  agent ran, `cost_usd` null for Codex; `input_tokens` counts the cache too, and
  `cache_read_tokens` and `cache_write_tokens` are its share, null before migration 21; the panel
  shows the input without the cache and the split on hover), `archived_at` (set while the task is archived; migration
  8), `lines_added` and `lines_deleted` (what the task's own commit adds and deletes, counted
  before it is made; null in a folder without git and for tasks before migration 12), `session_id`
  (the agent's session after the task's step, which a continuation on Claude resumes; migration
  20), timestamps.
- `task_pins`: primary key `user_id` and `task` (a foreign key to `tasks`), `created_at` (the pin
  order): an account's pinned tasks; `user_id` is `""` for the installation while there are no
  accounts (migration 8).
- `job_reads`: primary key `user_id`, `kind` (`task` or `run`) and `job`, `read_at`: the tasks
  and runs an account has read, `""` for the installation; a finished one without a row is
  unread. No foreign key, since `job` points at either table. Migration 12 marks everything
  finished before it as read for the installation and every account.
- `automations`: `id`, `name`, `cron`, either the task template (`repo`, `title`, `body`,
  `agent`, `skill`, `integrations`) or `workflow` (the other side null), `enabled`, `last_run_at` (last job
  queued, by schedule or by hand), `last_slot` (internal: the last scheduled minute claimed, as UTC
  ISO), `created_at`, `builtin` (`weave` or `lint` for a project's memory upkeep, else null; unique
  with `repo`).
- `workflows`: `id`, `name`, `description`, `repo` (registered), `definition` (JSON, normalised, with skills
  resolved to `owner/repo:name` and agent node integrations checked against `repo`),
  `created_at`, `updated_at`.
- `workflow_runs`: `id`, `workflow` (kept after the workflow is deleted), copies of the workflow's
  `name`, `repo` and `definition` taken when queued, `automation` (or null), `retry_of`, `status`
  (`queued`, `running`, `waiting`, `done`, `failed`, `cancelled`), `parent_run` (the run whose
  sub-workflow node started it), `state` (JSON: node outputs, loop counters, sessions, transitions
  and what it waits for), `current_node` (null when done), `steps`
  (JSON: per node reached `node`, `type`, `status` (`running`, `done`, `failed`, `cancelled`),
  `startedAt`, `finishedAt`, `log` (last 20 kB), `error`, and for an agent step its `agent` and
  usage), `branch`, `pr_url`, `error`, usage (the sum of its agent steps), timestamps. The list
  endpoint leaves out `definition` and `steps`.
- `agent_events`: `seq` (integer primary key, the order), the source (`task`, or `run` and `node`),
  `position` (order within the step), `kind` (`text`, `tool`, `result`, `error`), `summary` (at
  most 500 characters), `created_at` (indexed for the retention purge). No foreign keys, like
  notes; rows older than 30 days are deleted.
- `notes`: `seq` (integer primary key, the insertion order: notes of one step share
  `created_at`), `id` (unique), `repo` (registered), `text` (at most 2000 characters), the source:
  `task` (task id), or `run` and `node` (workflow run and its agent node), all three null for a
  note added through the API; `created_at`. No foreign key to tasks or runs: a note outlives them.
- `memory_pages`: primary key `repo` (registered) and `slug`, `title`, `description`, `kind`
  (`page` or `hub`), `version` (from 1, raised by every change of title, description or kind), the
  source of the last change (`task`, or `run` and `node`, all null for the API), `created_at`,
  `updated_at`.
- `memory_sections`: `id`, `repo` and `page` (a foreign key to the page), `position` (order on the
  page), `heading` (unique on the page), `body`, `version` (from 1, raised by every change), the
  source of the last change as above, `updated_at`.
- `memory_sources`: `section`, `note`, `position`: the notes a section cites, in order. No foreign
  key to `notes`, so deleting a cited note leaves the id in the section. A note no section cites is
  unwoven.
- `schema_migrations`: `version`, `applied_at`, one row per migration applied.

Skill files live only in the clones under `OLIMP_HOME/skills/`, never in the database.

## Database

**One interface, two databases.** `Database` (`src/db/database.ts`) is everything the API, the
runner, the scheduler and the issue poller ask of the database; every method returns a Promise.
`Store.open({ home, databaseUrl })` opens SQLite in `OLIMP_HOME` without `OLIMP_DATABASE_URL`
and MySQL with it, applies the migrations, and gives back the interface; `main.ts` logs its
`description` (`SQLite <path>` or `MySQL <user>@<host>:<port>/<database>`, never a password).
Both databases hold the same schema from the same numbered migrations; data does not move
between them.

**Atomic operations are whole methods.** There is no transaction API outside the
implementations. The methods that must be atomic are `runAutomation` (claim the slot and queue
the job), `failInterrupted`, `addNotes`, `createIssueTask`, `addMemorySection` and
`updateMemorySection` (the section with its citations), `createUser` (the account with its first
token; with `first`, only while there is no account: in MySQL the locking read of the empty
`users` table makes a concurrent first account deadlock, and its retry finds this one),
`deleteUser` (with its tokens, never the last admin) and each migration. Memory writes check
the version in the same statement (`UPDATE … WHERE version = ?`, in MySQL `SELECT … FOR UPDATE`
first), so of two writes from one version only one succeeds; `addMemorySection` locks the page row
in MySQL, so concurrent additions get distinct positions. MySQL reads a whole memory in one
transaction, so its pages, sections and citations come from the same moment.

- SQLite: `node:sqlite` is synchronous and all requests share one connection, so a transaction
  must never span an `await`, or another request would run inside it (and be rolled back with
  it). Each atomic method goes from `BEGIN IMMEDIATE` to `COMMIT` without yielding; the type of
  `transaction()` refuses a callback that returns a Promise, which would commit before its work
  ended. A task from an issue is a single `INSERT … ON CONFLICT DO NOTHING`.
- MySQL: each atomic method takes its own connection from the `mysql2` pool and runs in a
  transaction there, so concurrent requests never share it. Row locks order them: the `UPDATE`
  that claims an automation's slot, `SELECT … FOR UPDATE` on running workflow runs, and the unique
  index for issue tasks. A transaction InnoDB picks as a deadlock victim is retried, at most three
  times. Connections are opened without `FOUND_ROWS`, so an `INSERT … ON DUPLICATE KEY UPDATE`
  that changes nothing reports 0 rows, which is how a skipped insert is told from a new row.

**Numbered migrations.** `MIGRATIONS` in `src/db/migrations.ts` is an ordered list that is never
reordered or rewritten; each entry has a `version` and its SQL per database: `sql.sqlite` (one
script) and `sql.mysql` (statements run one by one). On open the store creates
`schema_migrations` if needed and applies, in order, every migration whose version is missing,
together with its row; a restart applies nothing. In SQLite each migration runs in one
transaction. In MySQL DDL commits implicitly, so a migration is not atomic with its row and every
statement is safe to repeat (`CREATE TABLE IF NOT EXISTS` with the indexes inside it); a named
lock (`GET_LOCK`) keeps two processes starting at once from migrating together.

1. The stage 5 schema (every table and index, `IF NOT EXISTS`). In MySQL `notes` has `seq` from
   the start.
2. `notes` rebuilt with the explicit `seq` column, copied from SQLite's `rowid`, so the order of
   notes no longer depends on `rowid`, which MySQL does not have. Nothing to do in MySQL.
3. Repository memory: `memory_pages`, `memory_sections` (unique index on `repo`, `page`,
   `heading`) and `memory_sources` (index on `note`). Existing notes stay as they are and are all
   unwoven until a section cites them.
4. `repos.commands`.
5. Accounts: `users`, `tokens`, `author` on the tables above and `repos.issue_author`. Existing
   rows keep a null author and the database has no account, so OLIMP goes on working as before
   until someone creates the first one. Like migration 4 in MySQL, its `ALTER TABLE` statements
   are not safe to repeat after a failure halfway.
6. Trace and threads: usage columns and `retry_of` on `tasks` and `workflow_runs`, `tasks.thread`
   with its index, and `agent_events`. Existing tasks and runs keep null usage and each task is a
   thread of its own. In MySQL each table gets one `ALTER TABLE`, which InnoDB applies whole.

A database from before numbered migrations (stages 0 to 5) has tables but no
`schema_migrations`. Inside migration 1 the store first brings its existing tables up to the
stage 5 schema, the way the old start-up checks did (`PRAGMA table_info`, `ALTER TABLE ADD
COLUMN`, and the one-time rebuild of the stage 2 `automations` table whose template columns were
`NOT NULL`), then migration 1 creates whatever tables and indexes are missing and records version
1; migration 2 follows. No row is lost. This step is SQLite-only: a MySQL database always starts
from migration 1.

**How the databases differ.** The queries are the same where it costs nothing; the rest:

- Text compares the same way: SQLite compares bytes, and the default MySQL collation ignores
  case, which would make `Acme/Demo` and `acme/demo` one repository. Every MySQL table is
  `InnoDB`, `utf8mb4` with `utf8mb4_bin`, the database OLIMP creates too, and connections use
  `utf8mb4_bin`, so ids, names and labels compare and sort byte by byte in both.
- `VARCHAR` for primary keys, foreign keys and indexed or short columns (`VARCHAR(64)` for ids,
  states and node names, `VARCHAR(255)` for repositories, branches, names, titles, skills, cron
  and labels; MySQL cannot index `TEXT` without a prefix length); `LONGTEXT` for bodies, logs,
  errors, notes, definitions and every JSON column. Times are the same ISO strings as in SQLite
  (`VARCHAR(32)`), so ordering by them is ordering text.
- The same foreign keys to `repos (id)`: `node:sqlite` enforces `REFERENCES`, so MySQL has them too.
- `INSERT … ON DUPLICATE KEY UPDATE` instead of `ON CONFLICT`: with `AS new … default_branch =
  new.default_branch` for repositories and skill sources, and an update that changes nothing
  (`id = id`, `name = name`, `slug = slug`) where SQLite does nothing (integrations, tasks, memory
  pages and sections). Not `INSERT IGNORE`, which would also swallow other errors (a too long
  value, a missing repository).
- A changed memory section is found with `UPDATE … RETURNING id` in SQLite and with `SELECT …
  FOR UPDATE` before the `UPDATE` in MySQL, which has no `RETURNING` on `UPDATE` (nor has MariaDB).
- A plain unique index on `tasks (repo, issue)` instead of the partial one with `WHERE issue IS
  NOT NULL`: MySQL allows many NULLs in a unique index, so the meaning is the same.
- `notes.seq` as `BIGINT AUTO_INCREMENT PRIMARY KEY`.
- No `PRAGMA` and no `BEGIN IMMEDIATE` in MySQL, and no legacy adoption: a MySQL database always
  starts from migration 1.

**Connecting to MySQL.** `OLIMP_DATABASE_URL` is `mysql://user:password@host:port/database`
(port 3306 and database `olimp` by default; the name may hold letters, digits, `_` and `$`). On
open OLIMP connects without a database, and when the database is missing it runs `CREATE DATABASE
IF NOT EXISTS … CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`; a user without that right gets an
error naming the database, host, port and user. A server that cannot be reached or refuses the
login fails the start with host, port and user. No message quotes the URL or the password, and
the driver's own message has the password replaced in case a server echoes it.

**Encryption.** The only URL parameter is `ssl-mode`, with the MySQL client's values: `DISABLED`
(default), `REQUIRED` (TLS without checking the certificate, for the self-signed one of shared
hosting such as MariaDB on seohost) and `VERIFY_IDENTITY` (certificate and host name checked). Any
other parameter is refused, so a misspelt `sslmode=require` cannot leave the connection plain.
MariaDB is tested in CI next to MySQL.

## Skills

A skills repository has the skills.sh layout: a folder `<name>/SKILL.md` up to five levels deep
(`skills/<name>`, `skills/<group>/<name>`, `plugins/<plugin>/skills/<name>`), the shallowest one
of a name winning; the directory name is the skill's name and the frontmatter gives its
`description`. A source reads the branch given when it was registered, the remote default branch
otherwise. Registering a source, `POST /api/skill-sources/refresh` (the panel's Refresh) and
every run that uses one of its skills fetch the clone and reset its checkout to that branch.
Listing skills, and resolving a task's or automation's skill to `owner/repo:name`, read the clone
as last fetched, so a list never waits on GitHub; only a source without a clone yet is fetched
then. A source that cannot be fetched is logged and left out of the list, so it does not hide the
other sources; the refresh names it in its error.

`DELETE /api/skill-sources/:owner/:name` removes the `skill_sources` row and the clone under
`OLIMP_HOME/skills/`. Tasks and automations keep their `skill` (`owner/repo:name`): nothing
resolves it again until the run, which then fails with "skill source … is not registered", the
same way as a skill that disappeared from its source.

Skills from the agent's HOME (the author's account, or `HOME` of the installation without
accounts) need no source: `~/name` is the account's own in `~/.claude/skills/<name>`, and
`claude.ai/name` one that Claude Code synced from claude.ai into `~/.claude/skills/synced/<id>/`
(the first folder of a name wins). The API resolves and lists them in the caller's HOME, the
runner copies them from the author's HOME the same way as a source's skill, following a linked
folder. `POST /api/own-skills`, `PUT` and `DELETE /api/own-skills/:name` write only real folders
and files there (a linked one is `409 skill.notEditable`) and need a `description` in the
frontmatter. A workflow or automation with `~/name` run by another account fails like a skill
that disappeared from its source.

`GET /api/skill-search?q=` passes the query to skills.sh's `/api/search` (the one `npx skills find`
uses, without a documented contract) and keeps only hits whose source is `owner/name` and whose
skill id is a valid skill name; a failed call is `502 skill.searchFailed`.

When a task has a skill, the runner copies the skill's folder to `.olimp/skills/<name>/` in the
worktree (see `.olimp/` below) and starts the prompt with "Start by reading
.olimp/skills/<name>/SKILL.md and follow that skill". Nothing about the agent call changes, so
Claude and Codex get the skill the same way.

A project skill (`./name`) is looked up in the repository itself, in `.claude/skills/`,
`.agents/skills/` and `skills/` in that order. Creating the task checks the project's checkout;
the run finds it in the worktree and points the agent at it there, without a copy.

The panel's Skills page of a project (`/project/<id>/skills`) is a list beside a detail. The list
reads `GET /api/skills?repo=`, filters it by text and source, and groups it by `source`: the
project's own (`.`), one group per team source (`owner/repo`; with `teamSkills` off a note pointing
to the setting instead), and the account's (`~` and `claude.ai`). Refresh calls
`POST /api/skill-sources/refresh`. The chosen skill (`?skill=<id>`, else the default, else the
first) shows the project's workflows and automations that name it and its `GET /api/skill`
without the frontmatter; the default skill is set and cleared with the same `PATCH …/settings` as
Project settings → Tasks, and "New task" opens `/tasks/new?repo=<id>&skill=<id>`, which takes a
skill's id in any of its forms.

## The `.olimp/` directory

Every agent step gets a fresh `.olimp/` in the worktree for its skill copy:

1. Right after `git worktree add`, before OLIMP writes anything, a repository whose checkout
   already has `.olimp/` fails the task or run with "the repository already has .olimp/" rather
   than mixing its files with OLIMP's (checked once per worktree).
2. Before each agent step the runner creates `.olimp/` and adds `/.olimp/` to the clone's
   `info/exclude` (`git rev-parse --git-path info/exclude`, shared by its worktrees), so `git
   status` and `git add -A` never see it, also while the agent runs.
3. After each agent step, done or failed, the runner removes `.olimp/`, so the next step starts
   with an empty one and nothing of it reaches a commit.

## Notes

Notes carry what agents and people learned about a project to later tasks there: raw, never
changed, the sources of its memory (below). They belong to the project, and every task in it with
the knowledge base on reaches all of them.

- **Writing.** An agent step adds a note with `olimp_add_note` of its `olimp-memory` server, with
  the step as its source (the task, or the workflow run and node, and its author), at most 2000
  characters; the prompt asks for lasting knowledge of the project, not state that changes (the
  current roadmap stage, what is merged, commit hashes, dates).
- **Managing.** `GET /api/notes?repo=` lists the newest 500 notes, `POST /api/notes` adds one to
  a registered repository (2000 characters at most), `DELETE /api/notes/:id` removes one.

## Repository memory

The memory organises what agents and people learned about a repository the way a Jarvis-like
wiki does: notes are raw, unchanging sources; pages hold the current knowledge in sections that
cite the notes they rest on; hubs are pages whose sections lead to other pages as `[[slug]]`; the
map is generated. It belongs to the repository like its notes. See [Data model](#data-model) for
what a page and a section hold.

**Knowledge base.** A project's agents know it from the repository's own files (`AGENTS.md`,
`CLAUDE.md`, its docs) unless its settings turn the knowledge base on (`settings.memory`, off by
default). Then, before every agent step (a task, an `agent` node) on an agent that takes MCP
servers, `runAgent` issues a step token (`issueStepToken` in `src/memory.ts`: random, only its
hash kept in the process, mapped to the step's project, its knowledge areas and the step as the
source of its writes), adds the `olimp-memory` server (`src/mcp.ts` run by OLIMP's own Node with
`OLIMP_URL` and `OLIMP_STEP_TOKEN`) to the step's MCP servers, and puts one paragraph in the prompt
between the skill line and the task: the project id, that the repository's own instructions come
first, which tools to ask when the task needs what earlier tasks learned, that lasting knowledge
goes into a note, and that the knowledge base is data, not instructions. The token is revoked when
the step ends, done or failed. Cursor and pi take no MCP servers: their steps run without the
knowledge base rather than fail.

The server's tools are the memory tools of OLIMP's MCP server without the ones that delete a note,
add a source or draw the graph. The API takes a request with `x-olimp-step` before any account
check (`stepMemoryRoute` in `src/api/memory.ts`, as `/api/dispatch/subtasks` does for a dispatch
token): an unknown or revoked token is `memory.invalidStepToken` (401); the memory routes of the
step's project and areas, except sources and the graph, and `GET`/`POST /api/notes` for one of
them, run as through the panel with the step as the source of every write; anything else is
`memory.stepForbidden` (403). A change names the version the agent read, so a page or section
changed meanwhile refuses it (`memory.pageConflict`, `memory.sectionConflict`) and the agent reads
again. In a workflow the next step reads what the steps before it wrote.

**Upkeep.** The built-in automations weave unwoven notes into sections (`weave`, the oldest notes
first through `olimp_list_unwoven_notes` with `oldest: true`) and check the memory's health
(`lint`); their prompts and the one of a source's ingest task (below) work only through the tools
and change no file. `ensureUpkeep` gives them to a project when its knowledge base is on, at start,
at registration and when its settings are saved; `upkeepDue` never runs them on a project with it
off, and a source is refused there (`memory.off`, 409).

**Knowledge areas.** A project names other projects as its areas (`settings.areas`, up to 5), such
as a folder holding a company's or a person's knowledge: an area is an ordinary project, so its
memory, notes, sources and upkeep are its own. With the knowledge base on, a step's token reaches
each area that still exists beside the project, and the prompt names them and asks for knowledge
that holds beyond the project to go there. A project cannot be its own area.

**Mountain.** `GET …/memory/graph` (`memoryGraph` in `src/memory.ts`, MCP `olimp_get_memory_graph`)
gives the memory as nodes and edges: the project as summit, its hubs, the pages each hub links as
`[[slug]]` outside code (a page no hub links hangs from the summit), and the notes sections cite;
unwoven notes are a count. The panel's Memory view draws it in 3D on top, with `3d-force-graph` (as
Jarvis, loaded only there): `web/src/lib/mountain.ts` pins every node to a cone, the summit on the
axis and a wider ring per level, each node turned towards its parents, with contour links round
rings of three or more and unwoven notes as scree round the foot. It turns slowly until someone
drags it, pulses climb the links from notes to the summit, both stop under
`prefers-reduced-motion`, a page or hub opens on click, and the open page is the one ochre node.
The wheel scrolls the view and never zooms the mountain.

**Sources.** A person adds a source, as the raw sources of a Jarvis-like wiki: `POST
…/memory/sources` takes a staged upload or a link. OLIMP fetches a link itself (http or https,
30 s, at most 5 MB, only text, JSON, XML or PDF), so only an admin may add one; an agent could not,
since Claude runs without web tools and Codex without network. The source becomes a note that
records its origin, type and size (the person as its source), then a task with the file attached
whose prompt names that note: the agent reads the source, weaves it into the memory through the
`olimp-memory` tools, cites the note and changes no file. The note comes first, so it exists when the task's
memory files are written. MCP: `olimp_add_memory_source`.

**API and MCP.** `GET /api/repos/:owner/:name/memory` is the map as JSON (hubs and pages with
`sections` as a count, `unwoven` as a count), `GET …/memory/unwoven` the newest 500 unwoven notes
with their total, `GET …/memory/pages/:slug` a page with its sections. `GET …/memory/search?q=`
searches the memory (`searchMemory` in `src/memory.ts`): the query (2 to 200 characters,
`memory.invalidQuery`) is split into words, each to be found ignoring case; a page is a hit when
every word occurs in its title or description, a section when every word occurs in its heading or
text. A word scores 4 in a title, 3 in a heading and 1 in a description or text, and the whole
query found as a phrase adds its place's score once more; ties keep slug and section order. The
answer is `{total, hits}` with the best 20 (`MEMORY_SEARCH_HITS`), each the page's slug, title and
kind, the section's heading (null on the page) and up to 200 characters of the description or
text on one line around the first word found. It reads the whole memory through
`Store.memoryPages`, as every write already does for its size check: a memory is at most 1 000 000
characters, so there is no search index and no Store method of its own. `POST …/memory/pages`
creates a page, `PATCH …/memory/pages/:slug` changes it with the `version` read before
(`memory.pageConflict`, 409, when it changed since). `POST …/pages/:slug/sections` appends a
section, `PATCH …/sections/:heading` (URL-encoded) changes its text or sources with its `version`
(`memory.sectionConflict`). Titles, descriptions and headings are one line (whitespace collapses);
a section's text must not hold a `## ` line outside a code fence (`memory.headingInBody`), since
it would become a new section in the step's file; sources must be notes of the repository
(`memory.unknownNote`); the page and section limits and the size of the whole memory are checked
on every write (`memory.tooManyPages`, `memory.tooManySections`, `memory.tooLarge`). Writes through
the API have no source. Each endpoint is an MCP tool: `olimp_get_memory_map`,
`olimp_list_unwoven_notes`, `olimp_get_memory_page`, `olimp_search_memory`, `olimp_create_memory_page`,
`olimp_update_memory_page`, `olimp_add_memory_section`, `olimp_update_memory_section`.

**Panel.** `web/src/pages/memory.tsx` (`/project/:id/memory/:slug?`) uses only these endpoints and
`/api/notes`. Sections render with the panel's `Markdown` component; `[[slug]]` becomes a link the
router follows. A section is edited in `CodeEditor` and saved with the version it was opened at;
every write refetches the memory, also a refused one, so after `memory.sectionConflict` the editor
shows the API's message and the section's new version and text, and saving waits until the user
applies the draft to that version. "New page" derives the slug from the title (lowercase,
diacritics dropped, other characters to single hyphens) until it is edited; the API checks it. The
search box asks `…/memory/search` 250 ms after typing stops, and a hit opens its page at the
section (`#s-<URL-encoded heading>`). The unwoven notes tab adds a note with `POST /api/notes`.
Writes follow the API's rules: any account may change the memory.

## MCP integrations

A repository is the unit of access, so an integration belongs to one repository and only its
tasks, automations and workflows can name it. Choosing is per step: `integrations` of a task, of
an automation's task template and of a workflow's `agent` node. The API refuses an unknown name
with `integration.unknown` when it saves one of them (a workflow against its repository, also when
only the repository changes; an automation again only when its repository changes). Before every
agent step the runner reads the named integrations of the repository as they are then: a deleted
one fails the step with "integration … is not defined in …", and a `${NAME}` reference to a
variable missing from the OLIMP process environment and the project's secrets fails it with
"integration …: environment variable … is not set in the OLIMP process nor a secret of the
project", and a reference to an `OLIMP_*` variable with
"… belongs to OLIMP and is never passed to agents" (otherwise an integration could carry
`OLIMP_DATABASE_URL` into a Codex step). The errors name things, never values, and the agent does
not start.

Validation on save: `command`, `args` and `url` are plain text without `${`; `url` is `http` or
`https`; `env` names are environment variable names and header names HTTP tokens; in `env` and
header values every `${` must be a whole `${NAME}` reference (so Claude's `${NAME:-default}` is
refused), and `Authorization` or `Proxy-Authorization` needs at least one reference. A literal
secret elsewhere (say, `X-Api-Key: abc`) cannot be told from a harmless value; the docs ask for
references.

The panel adds them from a preset catalog (`web/src/lib/integration-catalog.ts`, plain data that
`test/integration-catalog.test.ts` runs through `parseServer`): a preset only fills the add form,
with `${NAME}` references for its tokens, and is shown as connected when an integration has its
name. The workflow editor opens the same view (`ProjectIntegrations` in
`web/src/components/integrations/`) in a side sheet from its toolbar and from an agent node's
integration chips, so a server can be added without leaving the draft.

How the step's servers reach the agent (`AgentRunner.call` in `src/agents.ts`):

- Claude: `--strict-mcp-config --mcp-config <json>` on every call. The JSON has exactly the chosen
  servers (`{"mcpServers":{}}` without any), with the references as they are stored: Claude
  expands `${NAME}` from its environment, where the runner passes exactly the variables the chosen
  servers refer to, so no value is written to disk or to the arguments. `--allowedTools
  mcp__<name>,…` allows every tool of each chosen server; without it `--permission-mode
  acceptEdits` refuses MCP tools in print mode.
  `--strict-mcp-config` keeps out the user's own servers (from `~/.claude.json`, plugins or a
  project `.mcp.json` in the worktree).
- Codex: `-c mcp_servers={…}` with the chosen servers as one inline TOML table (`{ }` without
  any). Codex does not expand references, so each `env` value with a reference is expanded into
  the `codex` process environment under its own name and listed in `env_vars`, and each header
  with a reference into `OLIMP_MCP_<server>_<header>` named in `env_http_headers`; values without
  references stay literal (`env`, `http_headers`). Values reach only the environment of the child
  process, never its arguments (visible in the process list) or a file. Known limitation: there
  is no strict flag; that the one override replaces the user's `mcp_servers` table from
  `~/.codex/config.toml` follows from how Codex applies `-c` today and is not a documented
  guarantee.

## Accounts

OLIMP serves owners of companies and developers who add or create repositories on one machine. A
repository is a shared area: everyone with an account sees and works on all of them. What is per
person is who did what (`author`) and whose agent subscription a step uses.

**Without accounts** nothing changes from earlier stages: the API trusts loopback, needs no token
and every agent runs on the logins of the user running OLIMP. **The first account** is created
through `POST /api/users` without a token, only while there is none (`createUser(…, first)` decides
that in the same transaction as the insert), and is always an `admin`; it may set its password at
once. **From then on** every request but `GET /health` and `POST /api/auth/*` needs a sign-in:
`createApi` asks `store.hasUsers()` on every request, then `authenticate` takes a token's SHA-256
from `Authorization: Bearer` or, without one, the panel's session (`auth.missingToken`,
`auth.invalidToken`, 401 with `WWW-Authenticate: Bearer`). An `admin` manages accounts and tokens
(`auth.adminOnly` for a member); everything else is the same for both roles. Anyone may list and
revoke their own tokens. The last admin can neither be deleted nor made a member, so an
installation never falls back to no accounts by accident.

**Panel sign-in** (`src/auth.ts` for the primitives, `src/api/auth.ts` for the routes), modelled
on Corivo's. `POST /api/auth/login` checks the e-mail and an scrypt password hash (a missing
account is checked against a throwaway hash, so the time does not tell), counts failures per
e-mail and per address (3 in 5 minutes lock both, in memory, as in Corivo), and starts a session:
a random cookie value whose SHA-256 is the `sessions` row. The second factor is mandatory and
answered within 10 minutes: a TOTP code (RFC 6238, SHA-1, 6 digits, 30 s, one step either way, each
step once per account) or a backup code (ten, single use, hashed) when the account set up an app;
otherwise a 6-digit code e-mailed to it, stored hashed on the session, with at most 5 attempts.
Without e-mail an account without the app sets it up right there (`two-factor/setup` and
`enable`). Only then does the session sign anyone in. A session ends after 30 minutes without a
request (`seen_at`, written at most once a minute) or 8 hours after the sign-in; sign-ins purge the
old rows. The cookie is `HttpOnly; SameSite=Strict; Path=/` and `Secure` when the request came
through `OLIMP_PUBLIC_HOST`; with `guard`'s origin and JSON checks a foreign page can neither read
nor use it. The TOTP secret is encrypted (AES-256-GCM) with `OLIMP_HOME/auth.key` (mode 600, made
on first use), so the database alone does not give it away. `/api/me/*` changes the caller's own
name, e-mail (with the password), password (ending their other sessions), app and backup codes,
and lists or ends sessions; these and the sign-in are REST only, since MCP signs in with a token.
Auth events (`auth.login`, `auth.denied`, `auth.rate_limited`, `auth.logout`, …) go to the log as
one JSON line each.

**E-mail** (`src/mail.ts`, nodemailer as in Corivo) goes through the server saved in Settings,
Mail (`GET`/`PUT`/`DELETE /api/mail`, the `mail` setting with the password sealed by
`OLIMP_HOME/auth.key`; it never leaves the API) or, without it, `OLIMP_SMTP_URL` from
`OLIMP_MAIL_FROM`, in the requester's language from the catalogs (`mail.*`). An admin invites an
account with an e-mail (`POST /api/users` with `email`, or `POST /api/users/:id/link` later): a
one-time link (`auth_links`, the hash of 32 random bytes, valid 7 days, replacing the account's
earlier one) to `/accept-invitation`, or to `/reset-password` once the account has a password;
`POST /api/auth/forgot` sends the reset for any address without telling whether it has an
account. Setting the password ends the account's sessions. An admin resets a lost second factor
(`DELETE /api/users/:id/two-factor`), which also signs the account out everywhere.

**Tokens.** `olimp_` and 32 random bytes in base64url, shown once in the response that creates it
(`Cache-Control: no-store`). The database keeps the SHA-256 hex in a unique column; no salt is
needed for 256 random bits, and the lookup is by that hash, so no comparison leaks timing about
the token. A token does not expire; it is revoked by deleting it. The MCP server and `pnpm
agent-login` read it from `OLIMP_TOKEN`, an `OLIMP_*` variable, so it never reaches an agent.

**Authorship.** The API passes the caller's id as `author` to everything it creates: tasks,
automations, workflows, runs started by hand, notes and memory writes (the source of a memory
write has `author` next to `task`, `run` and `node`). An automation keeps its author when someone
else changes or starts it, and its tasks and runs are queued with that author in the same
transaction (`runAutomation`). `PUT …/issues` stores the caller as `issue_author`, and the issue
poller queues each issue's task with it. Notes and memory written by a step get the author of its
task or run.

**Agent logins.** Each account has `OLIMP_HOME/users/<id>/home` (mode 700), made when the account
is created and removed with it. Before an agent step of a task or run with an author, `agentHome`
checks that the account still exists and that the step's agent has its login there
(`.claude/.credentials.json` for Claude, `.codex/auth.json` for Codex, as they store it on Linux);
otherwise the step fails with a message naming the account and `pnpm agent-login`, before the
agent starts. The agent process then gets that directory as `HOME`, and `agentEnv` leaves out the
installation's `ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*` and `CODEX_*` variables, so neither a key nor
a `CLAUDE_CONFIG_DIR` or `CODEX_HOME` can make it use the installation's login. Names listed in
`OLIMP_AGENT_ENV` still pass. A step without an author runs as before. `pnpm agent-login` runs on
the same machine: it asks `GET /api/me` with `OLIMP_TOKEN`, creates the directory if needed and
starts `claude` (which asks for a login in a fresh `HOME`) or `codex login` interactively with the
same environment a step would get.

**A pasted token.** Without a terminal on the OLIMP machine, Claude takes a long-lived token from
`claude setup-token`, run anywhere the user is logged in: `PUT /api/agents/claude/logins/<name>/token`
(MCP `olimp_set_agent_token`, the Connect dialog in the panel) writes it to `olimp-oauth-token`
(mode 600) in the login's folder, beside the CLI's own login file, for the caller's account (the
installation's without accounts); `DELETE` removes it. A login with that file counts as logged in,
and its steps get the token as `CLAUDE_CODE_OAUTH_TOKEN`; the API never returns it. Only agents
with a `tokenEnv` in `AGENT_SPECS` take one (`login.noToken`), and the value must be printable,
without spaces and start with its `tokenPrefix` (`sk-ant-` for Claude), so OLIMP's own token pasted
by mistake is refused before a run (`login.invalidToken`).

**Second logins and a project's agents.** A second login is a folder
`logins/<agent>/<name>` in the account's directory (in `OLIMP_HOME` for the installation), listed
from the disk rather than the database; `GET /api/agents` reports the caller's logins with whether
each is logged in. A project's choice is `repos.agents` (JSON, migration 16): its agent, a model per
agent and a login name per agent; the installation's defaults (agent and models) are the
`agentDefaults` row of `settings`. The agent is settled when a task, automation or issue task is
created (`projectAgent`); the model and the login when the step starts: `step.model`, then the
project's, then the default, then the CLI's own. A named login makes `agentHome` check that author's
(or the installation's) folder of that name and add `CLAUDE_CONFIG_DIR` or `CODEX_HOME` after
`agentEnv`; a missing or logged-out one fails the step, never falling back to another login.
Workflow agent steps keep `claude` when they name no agent.

`git` and `gh` keep the installation's login: repositories are shared, so cloning, pushing,
opening pull requests, reading issues and `gh repo create` stay one identity. The pull request
description names the account behind the task or run (`requested by <name>`).

**Remote access.** The API still binds to `127.0.0.1`. `OLIMP_PUBLIC_HOST` names a TLS proxy on the
same machine (Caddy or nginx); while accounts exist, `guard` accepts that `Host` and
the `https://` origin too. Without accounts the public host is ignored per request, and `main.ts`
refuses to start with it, so a proxy never exposes an API that asks for no token.

## Agent sandbox

No containers (a deliberate decision, 2026-10-28): the worktree separates files and
the branch but not permissions. What limits an agent is its environment, its own sandbox and the
commands its repository allows.

**Environment** (`agentEnv` in `src/sandbox.ts`). The runner spawns an agent with a whole
environment built from the OLIMP process, never with OLIMP's environment plus extras:

- system: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `LC_*`, `TZ`, `TERM`,
  `TMPDIR`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY` (also in lower case);
- the agent's login and configuration: `ANTHROPIC_*` and `CLAUDE_*` for Claude, `OPENAI_*` and
  `CODEX_*` for Codex, except in a step of an account, which gets that account's `HOME` instead
  (see [Accounts](#accounts));
- the variables the step's integrations refer to;
- the names in `OLIMP_AGENT_ENV` (comma-separated; a name that is not a variable name or starts
  with `OLIMP_` is left out and named in the start-up log, which never prints values);
- then the call's own extras (`AgentCall.env`: for Codex the expanded integration values,
  including `OLIMP_MCP_<server>_<header>`).

No `OLIMP_*` variable passes the filter, whatever lists it. `git` and `gh` are OLIMP's own tools
and keep its environment without `OLIMP_DATABASE_URL` and `OLIMP_TEST_MYSQL_URL`: they need the
user's GitHub login, the agent does not, because OLIMP commits, pushes and opens the PR itself.

**Commands.** `PUT /api/repos/:repo/commands` with `{"commands":[…]}` replaces the list,
`DELETE` clears it (MCP: `olimp_set_commands`, `olimp_clear_commands`). `parseCommands` trims each
command, collapses runs of spaces, drops duplicates and refuses (`commands.invalid`) a list that
is empty or longer than 20, a command longer than 200 characters, and any of `;`, `&`, `|`,
`` ` ``, `$`, `<`, `>`, `(`, `)`, `,`, `*`, `\` or a control character (line breaks, tabs), so each
entry stays one plain command. The runner reads the list when an agent step starts and names it in
the prompt; it does not limit any agent's shell (the maintainer's decision):

- Claude gets `Bash` in `--allowedTools`, next to the `mcp__<name>` rules and
  `--permission-mode acceptEdits`: in print mode `acceptEdits` refuses every shell command not
  allowed there, so without it Claude would have no shell at all.
- Codex keeps `--full-auto`: its own `workspace-write` sandbox (writes limited to the worktree, no
  network) where it runs any command without asking. The list only reaches its prompt.
- Junie, OpenCode, Cursor, pi and Copilot run with every tool allowed (Junie's
  `brave_mode`, `cursor-agent --force`, `copilot --allow-all-tools`, pi's `--tools` with `bash`,
  OpenCode's defaults), and nothing sandboxes them: the list only reaches their prompt.
- Every prompt with a list asks the agent to check its change with these commands before it
  finishes and names them.

## GitHub issues

`startIssuePoller` runs in the API process: on start and then 5 minutes after the end of each
poll it calls `gh issue list --repo <id> --state open --label <label> --limit 30 --json
number,title,body` with the user's `gh` for every repository with `issue_label` set. Each issue
becomes a task through `Store.createIssueTask`, an `INSERT … ON CONFLICT DO NOTHING` (in MySQL
`ON DUPLICATE KEY UPDATE id = id`) against the unique index on `repo` and `issue`, so a second
poll, a restart or a reopened issue never queues it again. The title is cut to 200 characters, the body to 20,000. A repository whose `gh` call
fails or prints something else than a JSON list is logged and skipped.

An issue task runs like any task with Claude and no integrations, as the account that switched
issues on in the repository (`issue_author`, null without accounts). Its prompt quotes the body in
`<github-issue number="N">` after a sentence that says it is text from GitHub, labelled by a
maintainer but written by someone else, and `</github-issue` inside the body is escaped. The pull
request description is `Closes #N` and the task id; GitHub closes the issue when the PR is
merged. OLIMP does not comment on or label issues.

## Scheduler

`startScheduler` runs in the API process: on start and then just after every minute boundary it
takes the enabled automations whose cron matches the current local minute and calls
`Store.runAutomation(id, slot)`, where `slot` is the minute as UTC ISO. That call, in one
transaction, sets `last_slot` only if it is empty or earlier than the slot and then inserts the
task, so a minute queues at most one task per automation, even when a restart happens within it.
There is no catch-up: minutes while the server was down are skipped. "Run now" queues a task
without touching `last_slot`. Either way the task or run has the automation's author.

**Memory upkeep.** A project with the knowledge base on has two built-in automations
(`src/memory-upkeep.ts`), made turned on when the project is registered, when its settings are
saved and, for projects from before, on start: memory weaving (`weave`, daily at 03:00) and memory
lint (`lint`, Sundays at 04:00). Each queues a task whose prompt asks the agent to work only
through the `olimp-memory` tools, change no file and add no notes, so it normally ends without a
pull request. On its schedule a built-in automation is skipped while there is no work:
weaving needs more than 10 unwoven notes or the oldest older than a week (Jarvis's alarm), lint a
page or section changed since its last run, and neither runs on a project whose knowledge base is
off; a skipped minute is not claimed, and "Run now" always runs. A weaving task lists the oldest
unwoven notes first, so a backlog larger than one step's worth drains. A built-in automation can be turned off, rescheduled
and given another agent or prompt, but not deleted, renamed or moved to another project or a
workflow (`automation.builtin`, 409); it stays with a removed project, does not keep the project
from being removed, and runs again when the project is added back. The panel names it from its
catalogs; the API keeps an English name.

Cron times are the server's local time zone (`TZ` of the OLIMP process). At a daylight-saving
change a skipped local hour never matches and a repeated local hour matches twice (two different
UTC minutes).

## Task flow

1. `POST /api/tasks` (or the scheduler, or "run now") stores a `queued` task.
2. The worker picks the oldest queued task, claims it (`queued` to `running` in one `UPDATE`, so
   a task cancelled meanwhile never starts), fetches the repository's folder (or its clone in
   `OLIMP_HOME/repos/`) and adds a worktree in `OLIMP_HOME/worktrees/` on a new branch
   `olimp/<id>` from the default branch, so the folder's own checkout is never touched. A continuation takes its
   thread's branch and folder instead (see [Task threads](#task-threads)).
3. `.olimp/` is prepared as above; with a skill, the skill is copied into it.
4. With the project's knowledge base on, the step gets its memory token and the `olimp-memory`
   server. The task's agent runs in the worktree with the task as prompt (with the knowledge base
   paragraph when it is on, and the repository's commands) and only the allowed environment: `claude -p` with `--permission-mode acceptEdits`,
   the step's MCP servers and `Bash` allowed as above and
   `--output-format stream-json --verbose`, or `codex exec --json --full-auto -C <worktree> -c
   mcp_servers={…}` (workspace-write sandbox); see [Trace and cost](#trace-and-cost). The other
   agents (`AGENT_SPECS` in `src/agents.ts`): `cursor-agent -p --force --trust
   --output-format stream-json <prompt>` and `opencode run --format json <prompt>` (the step's MCP
   servers as JSON in `OPENCODE_CONFIG_CONTENT`, references expanded) end on their own; Junie
   (`junie --acp=true -p <worktree>`) and Copilot (`copilot --acp --allow-all-tools
   --no-auto-update`) get one prompt over ACP on stdin (`src/sessions.ts`: initialize, Junie's
   authenticate, session/new with the MCP servers, Junie's `brave_mode` and model options,
   session/prompt; permission requests are allowed) and pi (`pi --mode rpc`) one `prompt`
   command; OLIMP closes stdin when the answer came, and a process that ends before it failed.
   Cursor and pi take no MCP servers, so a step with integrations or a dispatched task fails on
   them, and a step there runs without the knowledge base. Binaries are resolved once at start; without one of the optional agents the server still
   starts and a step on it fails with a message saying so. A task with an author runs with that account's `HOME` and fails before
   the agent starts when the account has no login of the agent. A Claude run that lost its login
   refresh to another Claude process (same login, e.g. the maintainer's own session) tries again
   up to three times after 60 s plus up to 45 s of jitter, holding its worker slot; a failure the
   CLI blames on the account (HTTP 402, out of credits, a usage or N-hour limit) is the task's
   error with the CLI's own line, which tells when the limit resets.
5. The step's memory token is revoked and `.olimp/` is removed, also when the agent failed.
6. With changes: commit, push the branch, `gh pr create` (for an issue task the description is
   `Closes #N`; with an author it ends with `requested by <name>`). Without changes: done, no PR.
   A project without GitHub stops after the commit: the branch stays in its folder. The branch is
   pushed to the clone's `remote.pushDefault` when it names a remote, else to `origin`; on a fork
   the pull request's head is `owner:branch`, so an account that may only read the repository
   (a bot) works from its fork: `git remote add fork https://github.com/<bot>/<name>.git` and
   `git config remote.pushDefault fork` in the clone. The base stays `origin`, and a continuation
   finds its thread's branch on the push remote. Labels and auto-merge need write access there.
7. The worktree is always removed; the branch stays on the remote. A restart marks tasks left
   `running` as failed.

A folder without git has no worktree, branch or commit: the agent works in the folder itself,
so such a project takes one job at a time, and only `.olimp/` is removed after it. An empty folder
added as a project, and a new local project, get git at once (`initGit` in `src/clones.ts`: `git
init -b main`, a `.gitignore` when there is none, `node_modules/` and `.env` files in
`.git/info/exclude`, the files in a first commit, OLIMP's identity when git has none), since a
worktree starts from HEAD; a repository without a commit gets that commit when it is added, and a
folder with files only when an admin asks (`POST /api/repos/:id/git`, MCP `olimp_init_git`).
Without `origin`, a local project's worktree and change view start from its own default branch
(`refs/heads/`), not `origin/`.

A job fetches `origin` but never moves the folder's own branches, so the project's Git page shows
`origin/<branch>` wherever the folder's branch is behind it (a diverged one stays the folder's).
The page's Refresh fetches first (`POST /api/repos/:id/fetch`, MCP `olimp_fetch_repo`), so what
was merged on GitHub appears without waiting for a task; the folder's checkout is not touched.

The worker takes the oldest queued jobs of both kinds, tasks and workflow runs, up to the
parallel limit (`OLIMP_MAX_PARALLEL` or the panel's Resources, 1 by default). A job waits, and a
younger one goes ahead, while its folder without git is busy or an earlier task of its thread is
still at work. Jobs of one repository share its clone, so fetching and adding or removing
worktrees there (and checking a skills clone out) go one after another; the agents themselves run
side by side in their own worktrees.

## Workflows

A definition is a `version: 2` graph: `{ nodes, edges, layout? }`. `nodes` is a list of at
most 50 typed nodes with an id (`[A-Za-z0-9][A-Za-z0-9_-]{0,49}`, no dots) and a `name`; `edges`
connects `<node>.<port>` to a node id; `layout` is where the editor drew each node and the engine
never reads it. The types, their fields, ports and outputs live in `src/workflow-graph.ts`, which
imports nothing at run time, so the panel's editor validates, simulates and lays out with the same
code; `src/workflows.ts` checks every field's type and length on save and normalises the
definition (known fields only, empty optional fields dropped, defaults filled in).

Validation on save (`graphIssues`, the first issue refused as `workflow.<code>`): one start node;
every edge from a port its node has and to an existing node other than the start; one connection
per port; required text fields; agent rules (review and budget only on a fork branch, distinct
verdicts, `session.continue` naming another agent node); the fork shape (each port to an agent
without session or verdicts that nothing else reaches, every branch's `done` and `failed` into the
same join, which only those agents reach); every cycle through a loop's `repeat` port (a
depth-first search with the `repeat` edges left out); every node reachable; something to run;
`{{nodes.<id>…}}` and an `if` output naming existing nodes. The API also resolves skills to
`owner/repo:name`, checks the integrations of agent nodes against the repository and refuses a
sub-workflow that is not another workflow of the same repository (`workflow.unknownSubWorkflow`).
Definitions saved before the graph editor (`{ start, nodes }` of `agent`, `condition`, `pr`) are
converted when read (`fromLegacy` in `src/db/rows.ts`): `next` becomes the `done` edge, a `done`/
`failed` condition after an agent its two ports, `changes` an `if` on `diff-files > 0`, `includes`
an `if` on the previous agent's summary.

A run (`runWorkflow` in `src/workflow-runner.ts`):

1. `POST /api/workflows/:id/run` or an automation stores a `queued` run with a copy of the
   workflow and the user's `input`, the `{{task}}` of every text field. The worker picks it like a
   task.
2. One worktree on `olimp/<run id>` from the default branch (a sub-run from its parent's branch in
   the clone), for the whole run; the project's setup scripts run first.
3. From the start node `advance` follows the port a node left by to the next node that does work,
   counting loop visits on the way (`repeat` while the count is within `max`, then `exhausted`;
   the counters never reset) and recording the transitions. An unwired port ends the run, failed
   for a failure port, done for any other; an `end` node ends it with its status. A run walks at
   most 500 nodes.
4. Each visit is a step (stored before and after it runs, the port it left by included);
   `current_node` follows it; node outputs, loop counters, Claude sessions and the transitions are
   kept in the run's `state` (JSON, migration 18), so templates read them and a resumed run goes on
   where it stopped. Agent nodes run like a task's agent (fresh `.olimp/`, skill, memory, notes,
   integrations); a failed check's output is added to the next agent's prompt unless that prompt
   reads it itself. A `check` runs `sh -c` in the worktree with the process environment and the
   project's secrets, without OLIMP's variables, with the task timeout. Git and GitHub nodes are in
   `src/workflow-nodes.ts`; they autosave (commit what the steps left) before a push, a merge, a
   fork, a dispatch or a sub-workflow.
5. A gate, a question, CI and children park the run: `status` `waiting`, `state.wait` says what for
   (with the rendered question, the deadline, the PR number or the children), the step is
   `waiting`, the worker slot is released and the worktree kept (`parked` in `src/jobs.ts` keeps a
   reclaim or another job's cleanup from removing it). `resumeRun` puts it back to `queued` in one
   conditional `UPDATE`, so a second answer or a late timeout changes nothing; the worker reopens
   the worktree and settles the waiting node from what ended the wait. Resumers: the answer API, a
   child's end (`runTask` and `runWorkflow` wake their `parentRun`) and `startWaits`, every 10
   seconds: timeouts, `gh pr view <n> --json headRefOid,mergeable,statusCheckRollup` every
   `pollMs` (in memory; the checks are classified as on the merge panel, which also works with gh
   2.46 that has no `gh pr checks --json`; a conflict ends the wait, checks of another head than the
   worktree's commit kept in `wait.sha` do not count), and children that ended while nobody was
   told (a restart). A check records the files it wrote that were clean before it
   (`state.checkOwned`, path and blob hash); commits, autosaves and the pull request unstage those
   still unchanged.
6. A fork queues one task per branch with `parent_run` (migration 18), all from the run's branch
   in the clone; a reviewer branch is told to change nothing and commits nothing, the others push
   their branch without a pull request; nothing merges back. A `join` with `any` cancels the other
   branches once one is done. A dispatch node is one such task; a sub-workflow node a run with
   `parent_run`, at most three deep.
7. An agent with verdicts gets a request to end with `OLIMP:VERDICT <name>` (an imported
   workflow's `CEZ:` prefix is read too); without one it is asked once more in the same Claude session, then leaves by `failed`.
   `session.continue` passes `--resume` with the session of the named node; other agents, a
   missing session or another agent start fresh with a note in the log.
8. The worktree is removed (or kept, per `keepWorktrees`) when the run ends; cancelling a waiting
   run removes it and cancels its children; a restart fails `running` runs and keeps `waiting` ones.

`POST /api/workflows/build` asks the project's agent once, outside any worktree (a temporary
folder, no MCP), for a short chain of steps as JSON, and returns it as a
validated linear graph, not saved; one retry on an answer that does not parse.

## Trace and cost

Claude runs in print mode with `--output-format stream-json --verbose` (stream-json needs
`--verbose` there), Codex with `exec --json`; both print one JSON object per line. `TraceReader`
(`src/trace.ts`) reads the lines as they arrive:

- Claude: `assistant` messages give a `text` event per text block and a `tool` event per
  `tool_use` block (`<name>: <summary of the input>`, the first of `command`, `file_path`, `path`,
  `pattern`, `url`, `query`, `description`, else the input as JSON); the closing `result` gives the
  answer (`result`), `total_cost_usd`, `num_turns`, `duration_ms` and `usage` (input tokens with
  cache reads and writes, output tokens) and a `result` event (`error` when `is_error`).
- Codex: `item.completed` gives `text` for `agent_message` (the last one is the answer) and `tool`
  for `command_execution`, `file_change`, `mcp_tool_call` and `web_search`; `turn.completed`
  counts a turn and adds its tokens; `turn.failed` and `error` give `error` events. Codex reports
  no cost, so `costUsd` stays null; the duration is measured by OLIMP.
- A line that is not JSON (a CLI error, a fake agent in tests) is kept as raw output: the `log`
  is the answer, or the raw output when there is none; a failed step adds its stderr.

Before the agent starts, the runner stores a `prompt` event with the whole prompt and a `command`
event: the folder, the command line with the prompt left out and the agent's environment by name,
with values only for `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `TZ`, `PATH`,
`CLAUDE_CONFIG_DIR` and `CODEX_HOME` (any other may hold a secret, which never goes into the
database). From Claude's stream the reader also keeps its `system`/`init` message as a `session`
event, every `tool_result` as an `output` event, and the whole JSON of the input of a tool call
(an edit's `-`/`+` lines instead) and of the `result`.

Every summary is one line of at most 500 characters and `detail` keeps the whole content (a guard
cuts it at 1,000,000 characters); a step stores at most 1000 events, in order
(`position`), each written before the next one, and the purge in `main.ts` deletes events older
than 30 days on start and then hourly. Usage goes to the task, or to the step in the run's JSON
with the run's sum in its columns. `GET /api/costs` groups tasks and runs in SQL (the same query
for both databases): by the UTC day of `created_at`, `repo`, `agent` (`workflow` for runs, whose
steps may mix agents) or `author`, over jobs with a duration (that reached an agent); `unpriced`
counts jobs without a cost.

## Event bus and live events

`EventBus` (`src/bus.ts`) is a set of listeners in the API process. `main.ts` wraps the store with
`publishing(store, bus)`, a proxy that, after `createTask`, `createIssueTask`, `runAutomation`,
`createRun`, `update`, `updateRun`, `startJob`, `cancelQueued` and `addAgentEvent`, reads the task
or run back and publishes it (a task without `log`, a run without `definition` and `steps`), or the
agent event as stored. The API, the worker, the scheduler and the issue poller all get the wrapped
store, so every change reaches the bus without the runner knowing about it; with no listener
nothing is read back. The bus is in-process only, like the worker: one OLIMP, one bus.

`GET /api/events` subscribes one Server-Sent Events stream per connection: `id` counts the events
of that connection, `event` is `task`, `run` or `agent`, `data` the JSON. It passes the same host,
origin and token checks as every path, with the token only in `Authorization` (never a query
parameter, which would land in proxy and server logs). A comment line every 25 seconds keeps
proxies from closing an idle stream. At most 10 streams are open; the 11th gets
`503 events.tooMany`. A closed connection unsubscribes at once, and a client whose unsent data
passes 1 MB is disconnected, so a slow or gone reader holds no memory. There is no replay: a
client that reconnects reads the current state through the REST API. The panel keeps one stream
per tab and closes it 30 seconds after the tab is hidden, unless browser notifications are on
(they come from the stream); a tab shown again reconnects and refetches lists and traces.

## Cancelling

The runner tracks every job it claims in a map of `AbortController`s, before it claims it. `POST
…/cancel` first tries `cancelQueued` (`queued` to `cancelled` in one `UPDATE`): the worker's claim
of that job then fails and it never starts. Otherwise it aborts the tracked job and waits (up to 15
seconds) until it has stopped: the agent's process group gets SIGTERM, then SIGKILL after 5
seconds; the step stores its notes and memory as after a failure and an `error` event; the runner
checks the signal before the worktree, between workflow steps and before the commit, so nothing is
pushed after a cancel; the worktree is kept or removed as after any job and the task or run, and its running step, end
`cancelled` with `error` `cancelled by <account>` (or `cancelled` without accounts). A job that has
finished is `409 task.notCancellable` or `run.notCancellable`.

## Task threads

A retry (`POST /api/tasks/:id/retry`, only for a finished task) is a new task with the template of
the old one (repository, title, body, agent, skill, integrations, thread) and `retry_of`; the
caller is its author. It has no `issue` (one task per issue), but the runner follows `retry_of` to
the first task, so a retried issue task still quotes its issue and closes it. A run retry copies
the run's own definition, so it works after the workflow changed or was deleted.

A continuation (`POST /api/tasks/:id/continue`) is a new task with `thread` set to the thread's
first task (`thread ?? id` of the task continued), the template of that task, the caller's `body`
and its author. When it runs:

1. Its branch is the thread's, `olimp/<first task id>`, and so is its worktree folder,
   `OLIMP_HOME/worktrees/<first task id>`, because Claude keeps a session by the folder it ran in
   (a kept worktree of the thread is removed first, and the folder is parked while the
   continuation works, so nothing reclaims it). If that branch is on GitHub, the worktree starts
   from it (`git worktree add -B`, resetting the clone's stale copy); otherwise from the default
   branch.
2. Each task stores its agent's session (`session_id`, migration 20). When the task before it ran
   on Claude, on the same account, with a session, the continuation resumes it (`--resume`) and
   its prompt leaves the thread out: the session holds it. If Claude finds no such session
   (another login, a cleared session folder), the step starts over once without it. Otherwise
   (another agent or author, no session) the prompt gets, before the request, the last 5 earlier
   tasks of the thread (title, request, status and answer, each cut to 6000 characters, together
   at most 20 000) inside `<thread>`, marked as context. A request from a GitHub issue is labelled
   as such, and no entry can close the block.
3. With changes it commits and pushes the branch. If an earlier task of the thread has a pull
   request, that is the continuation's `prUrl` and the push updates it; `gh pr create` runs only
   when the thread has none yet.

A continuation waits while an earlier task of its thread is at work, so the continuations of one
thread run in order on top of each other, also with parallel jobs. A thread whose pull request was merged or closed still takes the push; the PR
is not reopened.

The panel shows a thread as one task (`threadsOf` in `web/src/lib/reads.ts`): the task list, the
dashboard and the sidebar have one entry per thread with the first task's id, title and origin, the
newest step's status and the thread's whole cost. Pinning and archiving act on the first task;
reading, cancelling and retrying on the newest step. The API keeps listing every task.

## Composer: models, attachments and variants

A task's `model` (migration 13, with `attachments`, `variant_group` and `variant`) reaches the
agent's command line through `CallOptions`: `--model` for Claude, `-m` for Codex; null leaves the
CLI's default. `src/uploads.ts` keeps staged files in `OLIMP_HOME/uploads/<id>` with a JSON side
file and prunes those older than a day on the next upload. Creating a task moves them to
`OLIMP_HOME/attachments/<task>` under names made safe (`safeName`: no folders, no control
characters) and unique within the task (`a.png`, `a-2.png`); the move happens right after the
insert, long before the worker can reach the agent step. The prompt lists the files' absolute
paths, and Claude gets the folder with `--add-dir`; Codex's sandbox reads the whole disk. The API
serves a file inline only for raster images and as a download otherwise, with `nosniff`, so an SVG
or HTML file never runs on the panel's origin.

Variants are ordinary tasks sharing `variant_group`, each with its own `olimp/<id>` branch and
worktree; B and C get one line of approach hints appended to the body. Picking one needs
every variant finished, closes the others' pull requests with `gh pr close --delete-branch` (or
deletes a local project's branch) and archives them; a failed close is reported, not fatal.

A dispatched task (`dispatch`) gets, besides its integrations, the `olimp-dispatch` MCP server
(`src/dispatch-mcp.ts`, run by OLIMP's own Node) with `DISPATCH_URL` and `DISPATCH_TOKEN` in its
environment. The token is 256 random bits issued when the task starts and revoked when it ends; the
process keeps only its SHA-256 (`src/dispatch.ts`), never the database. `/api/dispatch/subtasks`
takes the token in `x-olimp-dispatch` instead of an account, answers only while that task runs, and
only adds or lists its subtasks: tasks with `parent` set and no `thread`, which copy the task's
agent, model, integrations and author. The queue (`queuedJobs`) skips a task whose parent is not
`done`, and the worker runs at most `inFlight` subtasks of one parent at once. A subtask's worktree
starts from the parent's branch and its branch is pushed without a pull request. The last subtask
to finish calls `queueMerge`, which claims `dispatch_merge` with one conditional `UPDATE`, so two
subtasks finishing together queue one step: a continuation of the parent's thread with `parent`
set. Before its agent runs, the runner merges each finished subtask's branch with `--no-ff`; a
conflict is committed with its markers so the next one still merges, and the prompt names the
files. The prompt tells the agent not to commit, so OLIMP does the merges and the step's own commit;
its push carries the merge commits even when the agent changed nothing more.

The base branch is the repository's `default_branch`, now changeable to any branch its folder or
clone has (`for-each-ref` over `refs/heads` and `refs/remotes/origin`, without `olimp/*`): the
worktree, the pull request's `--base` and the changes view all follow it. Prompt templates are one
`settings` row (`promptTemplates`), capped at 60,000 bytes for MySQL's TEXT column.

## Branch changes

`GET /api/tasks/:id/changes` and `GET /api/workflow-runs/:id/changes` answer from the repository's
folder (or its clone in `OLIMP_HOME/repos/`), read-only and without a fetch: a job pushes its branch
from a worktree of that folder, so `refs/remotes/origin/<branch>` is there once it pushed (and the clone's
own `refs/heads/<branch>` stands in when the remote one is gone). The range is
`origin/<default>...<branch>` (three dots: from the merge base), so what the default branch gained
later is left out. `git diff --numstat -z` gives the files and `git diff` the patch, both with
`--no-ext-diff --no-textconv --no-renames`, so no diff driver or textconv from the repository's
configuration runs. Output is read up to 200,000 characters and the process stopped there; the file
list keeps 1000 entries. Nothing is cached: both commands take milliseconds on agent-sized
branches.

The task page browses the same branch: `git log <default>..<branch>` for its commits (two dots: only
what the branch adds), `git diff <sha>^ <sha>` for one of them after `merge-base --is-ancestor`
confirms it is on the branch and not on the default branch, `git ls-tree -r` for its files and
`git cat-file blob <head>:<path>` for one file. A path is checked before git sees it (relative, no
empty, `.` or `..` part), so the tree spec cannot leave the branch's tree.

## Web panel

`web/` is a Vite single-page app (React 19, Tailwind 4, `react-router`, TanStack Query, `use-intl`),
built by `pnpm build` into `web/dist`. It imports the API's types from `src/` with `import type`,
so there is no second copy of them, and its UI components are copies of the ui-kit's as the infra
panel uses them, in `web/src/components/ui/` (shadcn style, Radix primitives, the shadcn variants
and utilities in `web/src/shadcn.css`), with the infra panel's palette as the theme tokens of a
light and a dark theme; the brand's Ochre stays in the mark only. The layout follows the infra
panel: a sidebar that collapses to icons (Ctrl+B) and becomes a sheet below 1024 px, with
the horizontal lockup (the symbol when collapsed, the reversed files on dark) imported from
`docs/brand`, "New task" (C, with the current repository) and "Add project" (open
a local folder with a folder picker, clone from GitHub into a named folder, or a new repository with
an owner, private or public, empty or from a template), Dashboard and All tasks, then the repositories:
each with its tasks, memory, skills, git, GitHub (for a project on GitHub), automations, workflows,
settings and four recent threads, reordered by drag and drop
or the arrow keys on the handle (order and folding kept in the browser's `localStorage`); a header
with breadcrumbs (repository, then section).

A workflow run is a task in the panel: the task list shows runs beside tasks (the Workflow filter
picks them out), and `/tasks/:id` opens either, with no Runs section. The page knows the kind from
the task and run lists it already holds, otherwise it asks `GET /api/tasks/:id` and, on a `404`,
`GET /api/workflow-runs/:id` (`web/src/lib/job-kind.ts`). Both kinds share one shell
(`web/src/components/job-page.tsx`): the full-height layout, the header with its metadata line and
usage, the underlined tabs and the actions (Cancel while the job is active; Retry and the rest in
the "…" menu, never where Cancel was). A run's metadata line links its workflow's editor, project,
branch, pull request, retry-of and parent run; its tabs are Flow (the card that answers a gate or a
question, the graph with each node's visits in a side panel, every step in order), Changes, Trace
and Notes (`web/src/components/run/`), since commits and files exist only for tasks. There are no
`/runs` pages.

The API process serves it (`src/web.ts`): a `GET` outside `/api/` and `/health` returns a file of
`web/dist`, or `index.html` for a path whose last segment has no dot (a panel route); a missing file
with an extension is `404`. Hashed files under `assets/` are `immutable` for a year, `index.html` is
`no-store`, other files revalidate. Paths are decoded and must stay inside `web/dist`. The panel's
responses carry a CSP of `'self'` only (scripts, connections, frames refused), `nosniff`,
`no-referrer` and `DENY` framing. The `Host` and `Origin` checks run first, as for the API; the
files need no token, since they hold no data. Without `web/dist/index.html` the API behaves as
before and `/` answers `404 panel.notBuilt`, which says to run `pnpm build`.

Signing in: on start the panel asks `GET /api/me`. `account.none` means OLIMP has no accounts and
trusts loopback, so the panel opens without a sign-in; `401` shows the sign-in (e-mail and
password, then the second factor; see [Accounts](#accounts)), with `/forgot-password`,
`/reset-password` and `/accept-invitation` for the e-mail links. The session cookie is `HttpOnly`,
so no credential is readable by the page; the panel's `fetch` calls and the live event stream
carry it on their own. "Sign out" ends the session, and the first `401` (an expired session)
drops every cached response and shows the sign-in again. The live event stream is read with
`fetch` and a stream reader; a lost stream reconnects after 1 second, doubling up to 30, and the
lists are fetched again after every reconnect, since the stream has no replay.

`pnpm dev:web` runs Vite's dev server with a proxy for `/api` and `/health` to the API; the proxy
sends the API's own host and drops the dev server's `Origin`, so the API's checks stay unchanged.

## Terminal

The Terminal tab of a task and of a workflow run (`web/src/components/terminal-panel.tsx`, its own
chunk with xterm) opens shells in the folder of its owner: a task's thread (`task:<first task>`,
the steps share a folder) or a run (`run:<id>`); a project has no terminal of its own. A job's
folder is its worktree while it is there (`OLIMP_HOME/worktrees/<first task or run>`), or the
project's folder for a job that works in it; a finished job has it while the project keeps its
worktree (the last 10 by default, see Worktrees below), after that none (`409 terminal.noFolder`). REST only (`src/api/terminals.ts`), for any account, since projects are
shared; the paths below are under `/api/tasks/:id` or `/api/workflow-runs/:id`:

- `GET …/terminals`: `available` (with `reason` when `@lydell/node-pty` did not load, and OLIMP
  runs on without it), `shells` (the host's `/etc/shells` that exist, `$SHELL` first; a request may
  only pick one of them), the owner's `sessions`, `folder`, `host` and, for a task, `takeOver`: the
  line that resumes the thread's last Claude session by hand, `cd <folder> && [HOME=…
  CLAUDE_CONFIG_DIR=… CLAUDE_CODE_OAUTH_TOKEN="$(cat …)"] claude --resume <id>`, on the login the
  step ran on, a pasted token read from its file rather than shown.
- `POST …/terminals` `{shell?, cols?, rows?, input?}` opens one (at most 32 across the
  installation); `input` is typed into it, which is how a command picked from the Run menu runs in
  a new tab. The shell gets OLIMP's environment without `OLIMP_*`, with `TERM=xterm-256color`.
- `GET …/terminals/:sid/output?cursor=` returns what came since the cursor and the next cursor; the
  last 256,000 characters are kept, so a page opened again replays them (`truncated` when the
  cursor is older). `POST …/input {data}`, `POST …/resize {cols, rows}`, `DELETE …/:sid`.
- `GET …/terminals/urls`: the addresses the owner's terminals printed (`localhost`, `127.0.0.1`,
  `0.0.0.0` read as `localhost`, `*.local`; ANSI colours stripped; at most 50, newest first), each
  port asked with a TCP connect, never a request, whether something listens.
- `GET …/terminals/commands`: `package.json` scripts as `<manager> run <name>` (the manager from
  `packageManager` or the lockfile), `Makefile` targets as `make <target>`, and `<manager> install`
  when there is a `package.json` without `node_modules` and the project has no setup scripts.

Output reaches the panel through the event stream as `{type: "terminal", owner, id}`, at most every
25 ms per session and never with the output itself; the panel then reads it from its cursor, also
after a reconnect. A tab is named by the shell's first direct child in the process table (`ps`,
read at most once a second while the panel polls every 3 seconds), which also says whether closing
it would stop something; a host that cannot read the table makes the panel ask. Closing a tab sends
SIGHUP and, 2 seconds later, SIGKILL to every process group under the shell, read before the first
signal, since an interactive shell gives each job a group of its own; the shell must still be
OLIMP's child, so a recycled pid is never signalled. Archiving a thread, removing a worktree
(before the project's cleanup scripts run) or a project closes their terminals, and stopping OLIMP
kills them all. A shell that exits by itself is kept a minute, so its last lines can be read.
Ctrl+` (the `terminal` shortcut) goes to the tab and back.

## Preview

The Preview tab of a task and of a run shows the app the owner's terminals serve. `POST /api/preview {url, parent}` (`src/api/preview.ts`, REST only) opens a proxy
for one app (`src/preview.ts`): an http address on this machine only (`localhost`, `127.0.0.1`,
`0.0.0.0` read as `localhost`, `[::1]`), never OLIMP's own API or dev panel port, and only for a
panel opened on this machine (`409 preview.remote` through a public host, whose browser could not
reach the app's local address). Each app gets a listener on `127.0.0.1` with a port of its own
(at most 8, closed after 30 idle minutes and when OLIMP stops), so the app's code runs in an origin
apart from the panel's and never reaches its session. The proxy forwards every request with the
app's own `Host` and `Origin`, asks for it uncompressed, drops `X-Frame-Options`, lets only the
panel's origin in `frame-ancestors`, points redirects back at itself, splices WebSockets (hot
reload) byte for byte, and puts a script (`/__olimp_preview__.js`) at the top of every HTML page.
The script posts to the panel's origin only, and obeys only it: where the page is (also after
`pushState`), that the app does not answer (the proxy's 502 page), and, in Design Mode, the element
clicked instead of acting on the page: a selector, the start of its HTML and text. The panel frames
the proxy with a sandbox without top navigation (the panel's CSP allows `frame-src` of
`http://localhost:*` and `http://127.0.0.1:*` only), opens the first address a terminal printed that
answers and tries a page that does not answer again every few seconds. Without a page it offers to
run the app: the worktree's `dev` script (else `start`, else its first command, or another from the
Run menu) in a new terminal tab, after `<manager> install` in a tab of its own when the worktree has
no `node_modules` and the project no setup scripts, and opens the first address that tab printed
once it answers, or says the command ended or printed none in two minutes. It offers widths of a phone and a tablet, and hands the picked elements with a note each to
the thread's reply field, or, in a run or a project, to a new task.

## Project settings

A project's settings, under `/project/<id>/settings/<section>` in the panel; in the sidebar the
projects fold out under the general settings. `src/api/project-settings.ts` serves them with the
project's agents and commands, beside the routes of its issues, integrations and base branch:

- **Settings** (`PATCH /api/repos/:id/settings`): `instructions`, read after the global ones in a
  `<project-instructions>` block that wins over them; `workspace`, the default of a task that does
  not say `worktree` (dispatch and variants still take a worktree); `keepWorktrees`;
  `worktreeScripts` (admin only), Bash scripts in two phases, `afterCreate` after a new worktree
  is made and before the agent, `beforeRemove` before every removal (`retireTree` in
  `src/worktrees.ts`: after the job, beyond `keepWorktrees`, Reclaim now, by hand, or a kept one a
  continuation takes over), each `bash -c` in the worktree with the OLIMP environment without
  `OLIMP_*` plus `OLIMP_PROJECT_PATH`, `OLIMP_WORKTREE_PATH`, `OLIMP_JOB_ID` and `OLIMP_BRANCH`,
  its own timeout (30 minutes by default), checked with `bash -n` when saved; a failing setup
  fails the job, a failing cleanup keeps the folder (`worktree.cleanupFailed` when removed by
  hand); settings saved with the older `setupCommands` read back as setup scripts; `defaultSkill`, made canonical when saved, which the composer preselects;
  `teamSkills: false`, which leaves the skill sources out of `GET /api/skills?repo=`; `draftPr`,
  which adds `--draft` to `gh pr create`; `prLabels` and `typeLabel`, added after the pull
  request opens with `gh pr edit --add-label` (best effort: a failure is logged and the pull
  request stays); `autoMergeLabel` (admin only), read by the poll every two minutes. A prompt goes to most agents as one argument, which
  Linux caps at 128 KiB: a longer one goes to Claude (`-p` without it) and Codex (`exec -`) on
  stdin and fails any other agent's step by name before the spawn, which would only say `E2BIG`;
  the system prompts may be 100,000 characters each (on MySQL the `settings` value is
  MEDIUMTEXT from migration 17).
- **Secrets** (admin): values for the `${NAME}` references of the project's integrations. A step
  resolves its references in the OLIMP environment with the project's secrets over it
  (`projectEnv`), so a secret reaches the agent process only through an integration that refers to
  it; names agents get anyway (system variables, an agent's own prefixes, `OLIMP_*`) are refused.
- **Webhooks** (admin): when a task or workflow run ends (`done`, `failed`, `cancelled`), the
  runner's `finally` calls `notifyJob` without waiting, which posts to every enabled receiver of
  the project with that event: Slack `{text}`, Discord `{content}`, ntfy or OLIMP's JSON with a
  `text` line, in the language of the admin who added it. A workflow run that parks at a gate or
  a question calls it too, once per park, for `waiting` (a wait for CI or subtasks sends nothing);
  the message carries the gate's message or the question. ntfy gets its JSON form at the
  server's root (the topic URL without its last segment): `topic`, `title` OLIMP, `message`,
  `click` (the job's panel URL, `/tasks/<id>` for a task and a run alike), an emoji tag and a
  priority (4 for `failed` and `waiting`, 2 for `cancelled`, 3 otherwise), with
  `Authorization: Bearer` when the receiver has a token. HTTPS
  only, no redirects, 10 s; the last delivery is kept in memory (`shortcut:` in
  `src/webhooks.ts`), a failure is logged, not retried, and never touches the job.
- **Agent config**: the catalog of the agents' own files (`src/agent-config.ts`) in three scopes:
  user (the caller's HOME), project, and local (git-ignored, personal). A worktree made from git
  never sees the local layer, so the seeded files (Claude's `.claude/settings.local.json` and
  `CLAUDE.local.md`) are copied from the project's folder into each new job worktree before its
  setup scripts, only when `git check-ignore` confirms they are ignored there, so they never
  reach a commit. Project and local files are written in the project's folder (admin only; a path
  that leads outside it, also through a link, is refused), user files in the caller's HOME. JSON
  is parsed before it is written. `GET …/agent-config` returns `{files, mcpServers}`, the latter
  only the names of Claude's MCP servers in the caller's `~/.claude.json` (`mcpServers`, and the
  project folder's entry under `projects`), never their entries, which may hold keys.
- **Worktrees**: `git worktree list` of the project's clone, limited to `OLIMP_HOME/worktrees/`.
  With `keepWorktrees` above 0 (10 by default) a job's worktree stays when it ends (only `.olimp/` goes) and the
  oldest finished ones beyond that are removed; a continuation goes on in its thread's kept worktree when its branch only moves forward
  (`git merge --ff-only` to the branch where jobs push it), so the person's terminals, installed
  dependencies and env files stay and the setup scripts do not run again; otherwise, and for any
  other job that needs the branch, that worktree is removed first. Removing one keeps its branch; `POST
  …/worktrees/reclaim` removes the finished ones beyond `keepWorktrees` at once. The list carries
  each worktree's size from `du`.

## Version and update

`GET /api/version` reports `package.json`'s version, how OLIMP was installed (`install`) and the
checkout it runs from (commit, branch, uncommitted changes). A checkout is a git repository whose
top folder is OLIMP's own: a package inside another repository (a project's `node_modules`, the npx
cache in a home kept in git) is not one, so an update never pulls someone else's repository.
Outside a checkout, `install` is `global` when OLIMP's folder is in `npm root -g`, `npx` when it is
in npx's cache (`_npx`), and `package` otherwise, which offers no update. For a checkout the
check (`POST /api/version/check`, also at start and every six hours) runs `git fetch origin
<branch>` and counts the commits behind and ahead. At start and every six hours OLIMP also reads its own repository's
star count from the GitHub API, which `GET /api/version` returns as `stars` (`null` until it
answers) for the version window's GitHub button. `POST /api/version/update`
(admin only) first pauses the worker, then refuses while jobs run, with uncommitted changes, with
own commits or when nothing is new; otherwise it runs `git pull --ff-only`, `pnpm install
--frozen-lockfile` and `pnpm build`, answers `202` and exits; under the systemd service
(`olimp service install`, `OLIMP_SERVICE=1` in the unit) systemd starts the new version, otherwise
OLIMP first starts a detached copy of its own command line (logging to `OLIMP_HOME/olimp.log`) that
listens once the old process has exited. A failed
step resumes the worker and leaves the checkout as far as it got. The panel waits for `/health` and
reloads.

From npm the check asks the registry for `olimp-run`'s latest version (`version`, `behind` 1 when it
is newer). The update refuses while jobs run or when nothing is new; a global install runs `npm
install -g olimp-run@<version>` and restarts as above, npx restarts as `npx --yes
olimp-run@<version>` with the same arguments. The service installs only from a checkout or a
lasting npm install, never from npx's cache; from the package its unit starts `src/main.js` without
`pnpm install` and `pnpm build`.

**The npm package.** `pnpm run package` (`scripts/package.ts`) writes `olimp-run` to
`.package/olimp-run`, laid out as the repository: `tsc -p tsconfig.build.json` compiles `src/` to
JavaScript beside `messages/` (Node strips no types under `node_modules`, and `.ts` imports become
`.js`), Vite builds the panel into its `web/dist`, and its `package.json` has the server's
dependencies only and the bins `olimp-run` and `olimp`. Code that starts a file of its own (the
`olimp-memory` and `olimp-dispatch` servers, the service's CLI) takes the extension of the module it
runs from. `npx olimp-run` started inside a git repository other than OLIMP's checkout adds that
repository as a project before the sandbox is made, as `POST /api/repos {path}` would (inside
`OLIMP_BROWSE_ROOT`); a folder that is a project already is left alone. Before it opens the database
OLIMP checks that its port is free, since a second OLIMP on the same home would mark the first one's
running jobs interrupted.

## Threat model

| Asset or risk | Today | Later |
|---|---|---|
| The installation's GitHub, Claude and Codex logins | Never stored by OLIMP: it calls the installation's `gh`, `claude` and `codex`. An agent gets only its own agent's login variables, and none at all in a step of an account; `GH_TOKEN`, `GITHUB_TOKEN` and the other agent's keys stay in the OLIMP process, which runs git and gh itself | |
| An account's Claude and Codex logins | Kept by the CLIs themselves in `OLIMP_HOME/users/<id>/home` (mode 700), never in the database or logs; created by `pnpm agent-login` on the OLIMP machine and deleted with the account. Only that account's steps run with that `HOME`; a step without the login fails instead of using the installation's. The files are readable by the OS user running OLIMP, which therefore runs everyone's agents: whoever administers the machine can use every login in it | logins outside the OLIMP user's reach (containers or OS users per account) |
| An API token | Treated as a password: 256 random bits, shown once, only its SHA-256 in the database, sent only in `Authorization`, never logged, never passed to agents (`OLIMP_TOKEN` is an `OLIMP_*` variable). Revoked at once by deleting it; an account's deletion revokes all of its tokens. No expiry and no rate limit: guessing 256 bits is not a practical attack | expiry, last use, scopes |
| An account acting beyond its role | Two roles: only an `admin` creates or deletes accounts and creates tokens; the last admin cannot be deleted. Repositories and everything in them are shared by design, so a member may change any automation, workflow or memory; `author` shows who created what | per-repository access |
| Everything else in OLIMP's environment (`.env` holds the database URLs, tokens and the secrets of every integration) | An agent process gets a whole environment built from an allow-list: system variables, its own agent's login and configuration, the variables of the integrations its step chose and the names in `OLIMP_AGENT_ENV`. No `OLIMP_*` variable reaches it, also not through `OLIMP_AGENT_ENV` or an integration reference (which fails the step). The start-up log names, never prints, values | |
| The MySQL password | Only in `OLIMP_DATABASE_URL`, set in the environment or in `.env` (ignored by git; only `.env.example` with the development login of `compose.yaml` is committed). The start-up log shows user, host, port and database; errors name the same and never the URL, and a driver message has the password replaced. The API never returns configuration. No child process (git, gh, the agents, which run prompts with untrusted content) inherits it or `OLIMP_TEST_MYSQL_URL`. Readable by the same OS user, like any variable of the process | a secret store |
| Secrets of MCP integrations | Never in the database, logs or repository: `env` and header values hold `${NAME}` references to the OLIMP process environment, an `Authorization` header without one is refused, references are not allowed in `command`, `args` or `url`. A missing variable fails the step by name. Claude expands the references itself; for Codex the values go only into the child process environment (readable by the same OS user, like the variables themselves), never into arguments or files. A step sees only the variables of the integrations it chose, not those of the repository's other integrations | a secret store |
| MCP tools that write (an issue tracker, a database, chat) in a step whose prompt carries repository content, notes or an issue: prompt injection can make the agent use them | A step has no MCP server unless it names it: `--strict-mcp-config` on every Claude call (the user's own servers, e.g. a personal wiki or mail, never reach a step) and one `mcp_servers` override for Codex; the user chooses integrations per step and should choose write-capable ones only where the step's input is trusted. All tools of a chosen server are allowed | allow-lists of tools per integration, read-only defaults |
| Issue text from third parties | Only labelled issues become tasks, and on GitHub only people with triage access can label: an outsider's issue in a public repository starts nothing until a maintainer decides. The prompt quotes the body as text from GitHub, not instructions beyond the change; an issue task gets no integrations; OLIMP writes nothing to GitHub but the PR, which a person reviews | per-repository rules for issue tasks (agent, skill, integrations) |
| An agent runs arbitrary edits | Claude: `acceptEdits` and the whole `Bash` tool, so it can run any command as the OLIMP user. Codex: `--full-auto` runs commands without asking, inside its workspace-write sandbox (writes limited to the worktree, no network). Junie, OpenCode, Cursor, pi and Copilot: every tool allowed and no sandbox, so they can run any command as the OLIMP user. All in a throwaway worktree; changes reach the default branch only through a reviewed PR. No containers: a deliberate decision, the agent's environment and its own sandbox are the boundary | |
| A repository's commands run code | The commands run the repository's own code (e.g. `package.json` scripts, which the agent may have just edited) with the OLIMP user's permissions and the agent's environment, so the list is the repository owner's choice and should name only commands whose code they would run themselves. The API refuses characters that chain, substitute or redirect commands, so a rule cannot hide a second command; Claude itself refuses compound commands whose parts are not all allowed. Repositories are shared, so so are their commands | |
| Prompt injection from repository content | Same limits as above; the agent cannot merge, and it has neither the GitHub token nor OLIMP's configuration | per-source policies |
| The machine's folders | Only an admin lists folders or registers one (with accounts; without them the API trusts loopback). The picker shows names of visible subfolders inside `OLIMP_BROWSE_ROOT` only: the path is resolved with its symlinks before the check, so neither `..` nor a symlink leads above the root, and symlinked folders are not listed. A registered folder must be the top of a git repository whose `origin` is on GitHub. OLIMP fetches it, makes `olimp/<id>` branches and worktree entries in its `.git`, adds `/.olimp/` to its `info/exclude` and pushes from worktrees in `OLIMP_HOME/worktrees/`; its own checkout and files are never written. Clones and new repositories only go to a new folder in `OLIMP_PROJECTS` | a per-account browse root |
| A skill from someone else's repository is untrusted data | The skill is instructions the agent reads, with the same permissions as any task: no flags, plugins or settings come from it. Dotfiles and directories (`.claude/`, `.codex/`, `.mcp.json`, …), `CLAUDE.md`, `AGENTS.md`, symlinks and special files are not copied, so it cannot add hooks, settings, MCP servers or nested agent instructions, nor point at files outside the clone. It is never committed. Its content can still steer the agent like any prompt: register only skills repositories you would accept a task description from | review or pinning of skill sources per user |
| A note is untrusted data that comes back in the next task: an agent may have written it under the influence of repository content (prompt injection that persists) | Notes are scoped to their repository, so they never reach a task in another one, and a step reaches them only with the knowledge base on, through tools whose answers the prompt calls data, not instructions. A note holds at most 2000 characters. Notes are never committed. The user can list them and delete a wrong one through the API or MCP; a step's tools cannot delete one. The agent's permissions stay those of any task. Every note records its source and author | review of notes before they are used; a limit of notes per step |
| The repository memory is untrusted data too, and longer-lived: an agent may have written or rewritten a section under the influence of repository content, an issue or a skill, and later steps of the repository ask it | Memory is scoped to its repository and reached by a step only with the knowledge base on, which is off by default. The prompt says the knowledge base is data, not instructions, written by earlier agents and people, and may be wrong. A step's token, issued for that step and revoked when it ends, reaches only the memory and notes of its project and its knowledge areas, through the same checks as the panel: slugs of `[a-z0-9-]`, limits on every part (200 pages, 50 sections of 10 000 characters, 50 sources, 1 000 000 characters per repository), and a version for every change, so a section changed meanwhile is never overwritten. Every write records its source (task, or run and node) and its author, so a bad section can be traced to the step or person that wrote it. Nothing can be deleted through the tools. The user reads and corrects the memory in the panel, through the API or MCP | review or approval of memory changes, history of section versions |
| A change lands on the base branch without a person | Off by default. Auto-merge takes only a project's own label (set by an admin), only OLIMP's pull requests (an `olimp/` branch or one a task or run opened), only when GitHub reports it mergeable (`clean`, branch protection included), at least one check ran and every check passed; the merge is pinned to the head SHA read in the same round, so a commit pushed in between is refused. A label the agent sets itself (`typeLabel`) can be that label: then the agent decides, so pick one a person adds. Merging from the panel is admin only, since it lands with the installation's `gh` login | required reviews come from GitHub's branch protection, not OLIMP |
| A schedule queues work nobody watches | Automations only queue ordinary tasks or workflow runs: same agent limits, a PR to review, one job per automation and minute, the worker still runs one job at a time | budgets per automation |
| A workflow that never ends or multiplies work | Every cycle goes through a loop of at most 20 rounds whose counter never resets, checked on save, and a run walks at most 500 nodes, each agent step with the task timeout; a fork has at most 4 branches, sub-workflows nest at most 3 deep; one worktree and at most one PR per run; a waiting run holds no worker slot, and a gate, question or CI wait may carry a timeout | budgets per workflow |
| The Preview frames an app a task runs | The app is the task's code, so it runs in an origin of its own (the proxy's port), never the panel's: it cannot read the panel's session or call the API as the person. The proxy listens on loopback only, mirrors one fixed address on this machine and never OLIMP's own ports; the panel's frame has no top navigation; the injected script talks only to the panel's origin, which in turn reads only messages from the proxy's. A picked element's HTML and text reach the agent as part of the person's message, like anything they paste | |
| A task's terminal is a shell as the OLIMP user | The maintainer's decision: every account may open one, since projects are shared, so a member gets what an admin's worktree scripts get and more: any command as the OLIMP user, which can read `OLIMP_HOME` (the SQLite database, `auth.key`, every account's agent logins). The shell's environment has no `OLIMP_*` variable and no project secret; the executable is one of the host's own shells, never a path from the request; writes need `application/json` like every write, so a web page cannot type into it; output travels only through the API, the event stream says only which terminal changed | admin only, or a shell in a container per account |
| A worktree script runs any Bash | Only an admin saves them, and the panel says they run as the OLIMP user with its privileges; they get the OLIMP environment without OLIMP's own variables and without the project's secrets | per-repository access |
| A workflow's `check` runs any shell command | The maintainer's decision: whoever may edit workflows (any account, repositories being shared) runs code as the OLIMP user, with the project's secrets in its environment and without OLIMP's variables; the same reach as an agent without a sandbox. The command is stored in plain text in the definition | per-repository access, commands limited to the repository's list |
| A project's webhooks send job titles, errors and a waiting run's question out | Only an admin adds a receiver; HTTPS only, no redirects, 10 seconds. The address and an ntfy token are sealed with `OLIMP_HOME/auth.key`; the API shows only the host and whether a token is set. A public ntfy topic is readable by anyone who knows its name, so the panel says to pick a hard-to-guess one; a protected topic takes a token | |
| A workflow's `notify.webhook` calls out | Only HTTPS, no redirects, 15 seconds; a secret address goes in as `${NAME}` of a project secret, filled in only when the node runs, so it stays out of the definition | |
| A user-given text matched against agent output | An `if` on an output compares as a number or a plain string (`contains` is a substring test), never a regular expression: a pattern from the API on agent output in the API process could hang the server (ReDoS); globs are compiled from `*`, `**` and `?` only | |
| A failed agent step whose half-done changes reach a PR | A failed step leaves by `failed`, which ends the run as failed unless the definition wires it, so a PR after a failure is always a choice in the definition | |
| Anyone who can reach the API can run agents | API bound to 127.0.0.1; `Host` must be a loopback name (DNS rebinding); a cross-origin `Origin` is refused and writes (also `PATCH` and `DELETE`) need `application/json` (web pages cannot post). With accounts every request but `/health` needs a token, also from loopback. Until the first account exists anyone on the machine may create it, as the API already trusted loopback | |
| The API reached from outside the machine | Only through a TLS proxy on the same machine with `OLIMP_PUBLIC_HOST`: that `Host` and its `https://` origin are accepted only while accounts exist, checked per request, and OLIMP refuses to start with a public host and no account, so a proxy never exposes an API without tokens. The README warns against exposing the port without TLS, which would send tokens in clear text | |
| A crashed run leaves state behind | Restart fails `running` tasks and workflow runs (and the running step); worktrees are removed in `finally`; a `waiting` run keeps its worktree and state and goes on when woken | |
| Cost runaway | One job at a time, agent timeout per task and per agent step; cost, turns and tokens recorded per task and step and reported by day, repository, agent and author; a running job can be cancelled, which stops the whole process group of its agent | budgets per user and per repo |
| The live event stream leaks a token or holds the server | `GET /api/events` takes the token only from `Authorization` (a token in the URL would end up in logs, so the panel uses `fetch` with a stream, not `EventSource`), with the same `Host` and `Origin` checks as every path. At most 10 streams; a closed connection is released at once and a client that falls more than 1 MB behind is dropped. Events carry no `log`, only summaries cut to 500 characters | per-account limits |
| A dispatched task's agent adds work to the queue | Its only door is `/api/dispatch/subtasks` with a token valid for that one task while it runs (kept as a hash in memory, revoked when it ends, never in the database or logs): it can add at most `maxSubtasks` subtasks of the same repository, agent, model, integrations and author, which wait until it is done and run with the same limits as any task. The token sits in the agent's MCP configuration, so the agent could read it, but it opens nothing else and nothing after the task | a budget per dispatch |
| Traces keep what agents saw | An event is a summary of a message or of a tool's input (a command, a path), at most 500 characters, kept 30 days; agents get no secrets in their environment beyond their own login, which tool inputs do not carry. The full answer stays in `log`, as before | redaction rules |
| A continuation carries text into another task | The earlier tasks of the thread reach the prompt only as marked context, with issue text labelled as coming from GitHub and no way to close the block; the continuation's own request is the caller's, who is its author | |
| Cancelling someone else's work | Repositories are shared, so any account may cancel, retry or continue any task or run, as it may change any automation; the cancel records who did it in `error` | per-repository access |
| The token in the browser | Kept in memory and in `sessionStorage`: per tab, gone when it closes, never in a cookie (so no CSRF: a cross-site request carries no credential), never in a URL, sent only in `Authorization` to the panel's own origin. Script on the panel's origin could read it, so the panel serves a CSP that allows only its own scripts (no inline script, no eval, no third-party origin) and connections to its own origin, renders agent output, diffs and notes as text (React escapes it, nothing is set as HTML), and opens pull request links with `noopener` and `no-referrer`. A revoked token signs the tab out on its next request | a session cookie per login (`HttpOnly`, `SameSite=Strict`) once the panel needs longer sessions |
| The panel used from another site | Same origin only: the API's `Origin` check refuses cross-origin calls and the panel never sends a token elsewhere; `frame-ancestors 'none'` and `X-Frame-Options: DENY` stop clickjacking. The panel's files are public but hold no data | |
| A diff of a huge or hostile branch | Read-only git on OLIMP's clone with external diff drivers and textconv off; the output is capped at 200,000 characters and 1000 files and the git process stopped at the cap, so a branch cannot exhaust memory | |
