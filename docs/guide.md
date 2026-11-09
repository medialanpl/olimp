# Guide

How to run, use and configure OLIMP: the panel, projects, workflows, memory, the REST API and the
MCP server. How it is built: [architecture.md](architecture.md).

## Requirements

- Node 24.2 or later; pnpm only to run it from a clone (`mise install` reads `mise.toml`)
- `git`, and for GitHub projects the GitHub CLI `gh` logged in (`gh auth login`)
- At least one agent CLI logged in with your own account: Claude Code `claude` is the default
  agent (with [accounts](#accounts-and-tokens), each account logs in its own); Codex, Copilot,
  Cursor, Junie, OpenCode and pi are optional, and without one OLIMP starts and only its steps fail
- Optional: MySQL 8.4 instead of SQLite, e.g. Docker for `compose.yaml`

## Run

From npm, the package `olimp-run`:

```sh
cd your-repo && npx olimp-run   # panel and API on http://127.0.0.1:4850, data in ~/.olimp
npm install -g olimp-run        # installed: `olimp` starts it, `olimp service install` keeps it
```

Started inside a git repository, it adds that repository as a project, as Add a local folder would
(inside `OLIMP_BROWSE_ROOT`, your home folder by default); a fresh installation started elsewhere
gets the `sandbox` project instead. It reads no `.env`: set variables in the environment. The
panel's version window and `olimp deploy` update it from npm.

From a clone:

```sh
pnpm install            # once, and after every pull
pnpm prod               # production: build the panel, then panel and API on http://127.0.0.1:4850, data in ~/.olimp
pnpm dev                # development: panel on http://127.0.0.1:5175 with hot reload, API on 4851, data in ~/.olimp-dev
pnpm dev --from-prod    # the same on a fresh copy of the production data
pnpm check              # types, lint, tests and the panel build, as CI
```

Each runs in the foreground until Ctrl+C; nothing starts with the system unless you install the
service below. `pnpm start` starts production without building the panel again.

`pnpm start` and `pnpm mcp` read `.env` when it exists; [`.env.example`](../.env.example) lists every
variable.

### As a service

On Linux and WSL (with `systemd=true` in `/etc/wsl.conf`) OLIMP runs as a systemd user service, so it
starts with the system, comes back after a crash and restarts with one command. From npm, install
the package globally (npx's cache is no place for a service):

```sh
npm install -g olimp-run && olimp service install
```

From a clone, the service runs whatever its checkout holds, so it gets a clone of its own on
`main`, not the folder you edit code in; `install` refuses another branch or uncommitted changes:

```sh
git clone https://github.com/medialanpl/olimp ~/.olimp/app && cd ~/.olimp/app && pnpm install
pnpm olimp service install   # writes ~/.config/systemd/user/olimp.service, links ~/.local/bin/olimp
olimp deploy                 # after a merge: once no job works, pull main, install, build, restart
olimp service restart        # restart now: pnpm install, pnpm build, start; running tasks are interrupted
olimp service status         # also start, stop
olimp service logs           # follow the log (journalctl)
olimp service uninstall
```

The unit runs `src/main.ts` from this checkout (`src/main.js` from the package, without `pnpm
install` and `pnpm build`) with `.env` and the `PATH`, `OLIMP_HOME` and `OLIMP_PORT` of the shell
that installed it, so the agents' CLIs are found; install again after moving the checkout or
changing Node; installing from another clone moves the `olimp` link there.
`olimp deploy`, like the update in the panel, asks the running OLIMP to update itself (with accounts
it needs an admin's `OLIMP_TOKEN`); it exits and lets the service start the new version.

### Working on OLIMP

Work in a clone of your own on any branch; the service's clone only ever moves with `olimp deploy`:

```sh
pnpm dev               # API on 4851 restarting on every change, data in ~/.olimp-dev; panel on http://127.0.0.1:5175
pnpm dev --from-prod   # the same, starting from a copy of the service's SQLite data in ~/.olimp
```

It has data of its own (`OLIMP_DEV_HOME` changes the folder) and ignores `.env`, so the service's
tasks and data stay untouched. `--from-prod` keeps the previous dev database as `olimp.db.bak`; in
the copy no project polls issues and no automation is on, since the service already does both. A
project with a folder of its own is the same folder in both, so a dev task works on it too. The
schema of a branch reaches the service's data only with the merge and `olimp deploy`.

### Web panel

The panel is served by the same process and port as the API: open `http://127.0.0.1:4850`. It
shows the tasks (filtered by status and repository, updated live from `GET /api/events`), a task in
tabs (the conversation with its whole thread and a form to continue it, the branch's changes with
the diff, the agent's trace, the notes it saved, a terminal in its folder and a preview of the app
it serves) with cancel, retry and continue, a form for a new
task, workflow runs as tasks of the same list and page (their graph with the steps, changes,
trace and the gate or question they wait at),
the workflows and their graph editor, a GitHub project's open issues and pull requests (labels in
their colors, a label filter, the conversation, checks and merging, and "Hand it to an agent"),
each project's automations (a list with the last runs, a
week calendar and an editor with schedule presets, templates and the next runs), each project's
memory (see [Repository memory](#repository-memory)), each project's skills (its own, the team's and
yours, with a preview, the default skill and a new task with a skill), the repositories
(register, create on GitHub, and each project's own settings) and the cost report. It follows the system's light or dark theme (or the one you choose), speaks English and
Polish, and works on a phone.

The general settings: appearance, browser notifications when a job finishes while the
tab is in the background, the keyboard shortcuts, resources (the machine's CPU, memory and load
live, parallel jobs, the agent time limit), skill sources, agent accounts (whether `claude` and
`codex` are installed and logged in), accounts, and projects (the browse and checkout folders and
the registered projects). The menu at the bottom of the sidebar shows the machine (without
accounts) or the account, and OLIMP's version: its window checks `origin` for newer commits and
updates OLIMP from a git checkout (pull, `pnpm install`, `pnpm build`) and restarts it: the
service starts the new version, otherwise a copy in the background logs to `OLIMP_HOME/olimp.log`.

Without accounts the panel opens straight away, like the API on loopback. With accounts it shows
the sign-in (see [Accounts and tokens](#accounts-and-tokens)); the session cookie is out of the
page's reach, and "Sign out" ends it. Without `web/dist` the API works as before and `/` says how to build the panel.

`pnpm dev` runs the panel with Vite's dev server, which reloads on every change and proxies `/api`
and `/health` to the dev API on 4851; the API itself sends the panel's pages on to it
(`OLIMP_DEV_PANEL`), so 4851 never shows an old build. OLIMP's banner names both addresses and
Vite's own stays quiet. `pnpm dev:web` alone runs the same panel on 5175 with Vite's banner;
`OLIMP_URL` or `OLIMP_PORT` point it elsewhere, e.g. at the service.

### Database

SQLite needs nothing: the database is `olimp.db` in `OLIMP_HOME`. For MySQL set one variable:

```sh
docker compose up -d  # MySQL 8.4 on 127.0.0.1:3306 with the development login from .env.example
echo 'OLIMP_DATABASE_URL=mysql://olimp:olimp@127.0.0.1:3306/olimp' >> .env
pnpm start            # logs "database: MySQL olimp@127.0.0.1:3306/olimp"
```

OLIMP creates a missing database (`utf8mb4`) when its user may, and applies its migrations on
start. The password stays in the variable or in `.env` (ignored by git); the start-up log, errors
and the API never show it, and agents do not inherit the variable. Data does not move between
the two databases.

### REST API

The panel's *API reference* (`/docs/api`, also in the account menu and the command palette) is the
interactive reference: every operation with its parameters and body, and *Try it* sends a request
as you. Its OpenAPI 3.1 description is `GET /api/openapi.json`, made from the MCP tools' own
requests (`src/openapi.ts`), so it never differs from what they do; the table below is the same API
in short. In the terminal `olimp docs` lists every operation and `olimp docs <words>` shows the ones
that match in full, with their parameters and body (`pnpm olimp docs` in a clone).

```sh
curl -s -X POST localhost:4850/api/repos -H 'content-type: application/json' -d '{"repo":"owner/name"}'
curl -s -X POST localhost:4850/api/tasks -H 'content-type: application/json' \
  -d '{"repo":"name","title":"Fix the typo in README","body":"…"}'
curl -s -X POST localhost:4850/api/tasks -H 'content-type: application/json' \
  -d '{"repo":"name","title":"Add a test","agent":"codex"}'
curl -s localhost:4850/api/tasks
```

| Method and path | What it does |
|---|---|
| `GET /health` | liveness, the only path that never needs a token |
| `GET /api/repos`, `POST /api/repos` `{repo, folder?}` | list projects (`id`, `github` (owner/name or null), `git`, `path`, the folder it works in, `issueLabel`, `issueAuthor`), register: clone with your `gh` login into `OLIMP_PROJECTS/<folder>` (`repo` is owner/name or a GitHub address, `folder` the repository's name by default, never an existing folder: `repo.folderExists`); a repository registered before is fetched again |
| `POST /api/repos` `{path}` | register any local folder (admin) inside `OLIMP_BROWSE_ROOT`, except your home folder (`repo.homeFolder`); OLIMP then works in that folder. A git repository whose `origin` is on GitHub is that repository (`repo.otherFolder` when it works elsewhere already), any other folder a local project (see [Projects](#projects)). An empty folder becomes a git repository with a first commit, and a repository without a commit gets one (`repo.gitInit` when git fails) |
| `POST /api/repos` `{repo, create: true, visibility?, description?, template?, folder?}` | create the repository on GitHub with `gh repo create` (`private` by default, with a README or from a `template` repository), clone it into a new folder and register it |
| `POST /api/repos` `{name, create: true, github: false}` | create a local project: `git init -b main`, a `.gitignore` and an empty first commit in `OLIMP_PROJECTS/<name>` |
| `POST /api/repos/:id/git` | make a local project's folder without git a repository (admin): `git init -b main`, a `.gitignore` when it has none, `node_modules/` and `.env` files in `.git/info/exclude`, its files in a first commit (OLIMP's identity when git has none); `repo.alreadyGit` 409 |
| `POST /api/preview` `{url, parent}` | the panel's Preview of an app on this machine (`url`: `3000`, `localhost:3000/path` or an http address of `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`): `{origin, target, url}` of its proxy; REST only (see [Preview](architecture.md#preview)) |
| `GET /api/folders?path=` | the folder picker (admin): the visible subfolders of a folder inside `OLIMP_BROWSE_ROOT` (the root by default) with whether each is a git repository, and the parent; no symlinks, nothing above the root |
| `POST /api/folders` `{path, folder}` | create an empty folder named `folder` (letters, digits, dots, dashes, underscores) in `path` inside `OLIMP_BROWSE_ROOT` (admin; `repo.invalidFolder`, `repo.folderExists` 409): the new folder as the picker lists it |
| `GET /api/github/owners` | where a new repository can go: your `gh` account and its organizations |
| `GET /api/github/status` | whether the installation's `gh` is signed in, and as whom: `{loggedIn, login}` |
| `GET /api/repos/:id` | one project: `github`, `git`, `folder` (where it works), `defaultBranch`, `issueLabel`, `issueAuthor`, `commands`, `path`; `repo.notRegistered` if it is not registered |
| `DELETE /api/repos/:id` | unregister a project: nothing on disk is deleted and its tasks, runs, notes, memory and integrations stay, so adding it again finds them; refused while its jobs are queued or running (`repo.busy`) or an automation uses it (`repo.inUse`); admin only |
| `GET /api/me` | your account with its tokens (ids only); `account.none` without accounts |
| `GET /api/users`, `POST /api/users` `{name, role?}` | list accounts, create one with its first token (admin; the first account needs no token) |
| `DELETE /api/users/:id` | delete an account, its tokens and its agent logins (admin; never the last admin) |
| `GET`, `POST /api/users/:id/tokens` | list an account's tokens (admin or the account), create a token (admin) |
| `DELETE /api/tokens/:id` | revoke a token (admin or its account) |
| `GET /api/repos/:id/integrations`, `POST …/integrations` `{name, kind, …}` | list (each with `missing`: references neither a project secret nor the OLIMP process fills), add an MCP integration |
| `PATCH`, `DELETE /api/repos/:id/integrations/:integration` | change (the given fields), delete |
| `PUT /api/repos/:id/issues` `{label?}`, `DELETE …/issues` | take tasks from labelled issues (`olimp` by default) or change the label (`repo.noGithub` for a project not on GitHub); stop |
| `GET /api/repos/:id/branches` | `{base, branches}`: the project's branches (local and origin's, without `olimp/*`) and its base; `repo.noGit` for a folder without git |
| `POST /api/repos/:id/branches` `{name}` | create a local branch from the base (origin's for a project on GitHub) without checking it out or pushing it; `{base, branches}` as above (`repo.invalidBranch` for a name git refuses or one under `olimp/`, `repo.branchExists`) |
| `PUT /api/repos/:id/branch` `{branch}` | set the base: new tasks start from it and their pull requests target it (`repo.unknownBranch`) |
| `PATCH /api/repos/:id/settings` `{instructions?, workspace?, keepWorktrees?, worktreeScripts?, defaultSkill?, teamSkills?, draftPr?, prLabels?, typeLabel?, prReview?, autoMergeLabel?, memory?, areas?}` | the project's own settings, see [Project settings](#project-settings); `prReview` only for a project on GitHub (`github.localProject`), with `prReviewAuthor` set to the caller who turns it on; `autoMergeLabel` and `worktreeScripts` admin only; `memory`: the knowledge base, off by default (see [Repository memory](#repository-memory)); `areas`: up to 5 other projects whose memory is a knowledge area of this one (`project.unknownArea`) |
| `GET /api/repos/:id/github/issues`, `…/github/prs` | the project's open issues or pull requests on GitHub (up to 100) with their labels and colors (`github.localProject` for a project not on GitHub, `github.unavailable` when `gh` fails) |
| `GET /api/repos/:id/github/issues/:n`, `…/github/prs/:n` | one with its body and comments; a pull request also with `merge`: GitHub's `status`, `ready` (a person may merge), `auto` (every check passed, at least one ran), `headSha`, the repository's `methods` and each check |
| `POST /api/repos/:id/github/prs/:n/merge` `{method, sha}` | merge with the installation's `gh` login, pinned to the head commit read before (`github.mergeRefused` when GitHub refuses, e.g. a newer commit); admin only |
| `GET /api/repos/:id/secrets`, `PUT`, `DELETE …/secrets/:name` `{value}` | the project's secrets by name, when they changed and the integrations that use them, never a value (admin) |
| `GET`, `POST /api/repos/:id/webhooks` `{name, url, format?, token?, events?, enabled?, automations?}` | list, add a receiver of the project's job updates (admin); `format` is `json`, `slack`, `discord` or `ntfy` (`token`: a protected ntfy topic's access token, shown only as `hasToken`); `events` from `done`, `failed`, `cancelled`, `waiting`; `automations: false` leaves out the jobs an automation queued |
| `PATCH`, `DELETE /api/repos/:id/webhooks/:webhook`, `POST …/:webhook/test` | change (`token: ""` removes the token), delete, send a test message (admin) |
| `GET /api/repos/:id/agent-config`, `GET`, `PUT …/agent-config/:file` `{content}` | the agents' own config files of the project and of your HOME, with a project file's state in git and the agent's docs; read, write one (a project file: admin) |
| `GET /api/repos/:id/worktrees`, `DELETE …/worktrees/:job`, `POST …/worktrees/reclaim` | the project's job worktrees on disk with their size; remove one of a job that is not working, or the finished ones beyond `keepWorktrees` (admin) |
| `GET /api/tasks`, `POST /api/tasks` `{repo, title, body?, agent?, model?, skill?, integrations?, attachments?, variants?, dispatch?}` | list, queue a task (`agent`: `claude` by default or `codex`; `model`: an id the agent's CLI knows, none is its default; `attachments`: upload ids; `variants` 2 or 3 replies `{group, tasks}`; `worktree: false` with `newBranch?` and `branch?` works in the project's checkout; `dispatch`: `true` or `{maxSubtasks?, inFlight?, agent?, model?, budgetUsd?}`, see [Composer](#composer)) |
| `POST /api/uploads` `{name, data, mediaType?}` | stage a file to attach (base64, at most 5 MB, kept for a day): `{id, name, mediaType, bytes}` |
| `GET /api/tasks/:id/attachments/:name` | a file attached to the task; raster images inline, anything else as a download |
| `GET /api/tasks/:id/subtasks` | the subtasks a dispatched task's agent added, oldest first; its `dispatchMerge` names the step that merges them |
| `GET /api/task-groups/:group`, `POST …/pick` `{task}` | the variants of one prompt; keep one once all finished: the others are archived, their pull requests closed and branches deleted |
| `GET`, `PUT /api/prompt-templates` `{templates}` | the composer's prompt templates; `null` while the panel's built-in ones apply |
| `GET /api/tasks/:id` | status, branch, pull request, error, the agent's answer (`log`), `skill`, `integrations`, `automation`, `issue`, `reviewPr` and `reviewSha` (the pull request a review task reviews and the head it was queued for), `thread`, `retryOf`, `author`, the lines its commit adds and deletes (`linesAdded`, `linesDeleted`), the agent's session a continuation resumes (`sessionId`), and usage: `turns`, `costUsd`, `inputTokens`, `outputTokens`, `durationMs`; `task.notFound` if there is none |
| `GET`, `POST /api/{tasks,workflow-runs}/:id/terminals`, `…/terminals/:sid/output?cursor=`, `POST …/input`, `POST …/resize`, `DELETE …/:sid`, `GET …/terminals/urls`, `GET …/terminals/commands` | the shells of a task's thread or a workflow run in its folder, REST only (see [Terminal](architecture.md#terminal)) |
| `GET /api/tasks/:id/trace` | `{task, events}`: the agent's events in order (see [Trace, costs and live events](#trace-costs-and-live-events)) |
| `GET /api/tasks/:id/changes` | `{task, branch, base, head, files, diff, …}`: what the task's branch changes against the default branch (see [Changes](#changes)) |
| `GET /api/tasks/:id/commits` | `{task, branch, base, head, commits, truncated}`: the commits the task's branch adds, newest first (see [Changes](#changes)) |
| `GET /api/tasks/:id/commits/:sha` | one of those commits with its `files` and `diff`; `task.commitNotFound` for any other commit |
| `GET /api/tasks/:id/files` | `{task, branch, head, files, truncated}`: every path at the head of the task's branch; with `?path=` one file: `{path, size, binary, content, truncated, image}` (`task.fileNotFound`, `task.badPath`) |
| `GET /api/tasks/:id/thread` | the task's whole thread, oldest first: its first task and every continuation |
| `POST /api/tasks/:id/cancel` | cancel a queued or running task; replies once it is `cancelled` (`task.notCancellable` when it has finished) |
| `POST /api/tasks/:id/retry` | queue a finished task again as a new one with the same template, `retryOf` the first, on your behalf (`task.notFinished` while queued or running) |
| `POST /api/tasks/:id/continue` `{body, title?, model?, attachments?}` | queue the next task of the task's thread, on the thread's branch and pull request, on your behalf |
| `PUT /api/tasks/:id/archive`, `DELETE …/archive` | archive a finished task (out of the active lists, `archivedAt` set; `task.notFinished` while queued or running), restore it |
| `GET /api/pins`, `PUT /api/tasks/:id/pin`, `DELETE …/pin` | your pinned task ids in the order you pinned them (the installation's while there are no accounts); pin, unpin, each replying with the list |
| `GET /api/reads`, `PUT /api/tasks/:id/read`, `DELETE …/read`, the same under `/api/workflow-runs/:id/read` | the tasks and runs you have read, `{ tasks, runs }` (the installation's while there are no accounts; a finished one missing is unread); mark read, mark unread, each replying with the lists |
| `GET /api/costs?by=day\|repo\|agent\|author&days=30` | usage of tasks and runs queued in the last `days` (1 to 366): `total` and `groups` |
| `GET /api/events` | Server-Sent Events: changes of tasks and runs and agent events as they happen |
| `GET /api/skill-sources`, `POST /api/skill-sources` `{repo}` | list, register a skills repository |
| `DELETE /api/skill-sources/:owner/:name` | unregister a skills repository and delete its clone |
| `GET /api/skills?repo=` | skills of all sources: `id` (`owner/repo:name`), `name`, `description`, `source`; with `repo` the project's own skills first (`id` `./name`, `source` `.`) |
| `GET /api/skill?ref=&repo=` | `{ref, content}`: a skill's `SKILL.md`; a `./name` skill needs its `repo` |
| `GET /api/models` | the models a task can ask for, `{agent, value, label, description}`: Claude's as its CLI lists them for your login (cached an hour), Codex's from OLIMP's list |
| `GET /api/automations`, `POST /api/automations` `{name, cron, repo, title, body?, agent?, skill?, integrations?, enabled?}` or `{name, cron, workflow, enabled?}` | list, create |
| `GET /api/automations/:id` | one automation; with `nextRunAt`, when the scheduler starts it next (null while it is off), as in the list |
| `PATCH /api/automations/:id` `{…any of the above}` | change, e.g. `{"enabled": false}`; `"skill": null` removes the skill; `workflow` switches to a workflow, `"workflow": null` back to a template |
| `DELETE /api/automations/:id` | delete (its tasks and runs keep the `automation` id); a project's built-in memory upkeep (`builtin`: `weave` or `lint`) is refused with `automation.builtin`, as is renaming or moving it, but it can be turned off or rescheduled |
| `POST /api/automations/:id/run` | queue its task or workflow run now |
| `GET /api/workflows`, `POST /api/workflows` `{name, description?, repo, definition}` | list, create |
| `POST /api/workflows/build` `{repo, request}` | the project's agent plans a workflow from the request: `{name, description, definition}`, not saved; `workflow.buildFailed` when it could not |
| `GET`, `PATCH`, `DELETE /api/workflows/:id` | read, change (any of the fields), delete (refused with `workflow.inUse` while an automation uses it) |
| `POST /api/workflows/:id/run` `{input?}` | queue a run now; `input` is the request every agent step reads after its own instructions |
| `GET /api/workflow-runs`, `GET /api/workflow-runs/:id` | recent runs; one run with its definition, the state of every step (an agent step also with its `agent` and usage) and the usage of all its steps; `run.notFound` if there is none |
| `GET /api/workflow-runs/:id/trace`, `POST …/cancel`, `POST …/retry` | the events of every agent step with its `node`; cancel (a waiting run also cancels the subtasks it waits for); queue again with the definition it ran with |
| `POST /api/workflow-runs/:id/resume` | a run whose last step failed is queued again in place and goes on from that step with the outputs, loop counters and sessions of the steps before it, in its kept worktree or one made again from its branch (files outside git are then gone); `run.notResumable` otherwise |
| `GET /api/workflow-runs/:id/thread` | the run's whole thread, oldest first: the first run and every continuation |
| `POST /api/workflow-runs/:id/continue` `{input}` | the next run of the thread: the workflow as it is now with `input` as its request, on the thread's branch and in its worktree, pushing to its pull request; every agent step reads the earlier runs' requests and last answers first; `run.threadBusy` while a run of the thread is queued, running or waiting |
| `POST /api/workflow-runs/:id/answer` `{answer, comment?}` | answer the gate (`approve` or `reject`) or question the run waits at; it is queued again; `run.notAsking` when it waits for none |
| `GET /api/workflow-runs/:id/changes` | what the run's branch changes against the default branch, as for a task |
| `GET /` and any other path outside `/api` | the web panel from `web/dist` (no token needed for its files) |
| `GET /api/notes?repo=name`, `POST /api/notes` `{repo, text}` | the newest 500 notes (of one repository with `repo`), add a note (up to 2000 characters) |
| `DELETE /api/notes/:id` | delete a note (`note.notFound` if there is none) |
| `GET /api/repos/:id/memory` | the memory map: `hubs` and `pages` (each with its number of `sections`), `unwoven` (how many notes no section cites) |
| `GET /api/repos/:id/memory/unwoven?oldest=true` | `{total, notes}`: the newest 500 notes no section cites, the oldest with `oldest=true` |
| `GET /api/repos/:id/memory/search?q=` | `{total, hits}`: the best 20 hits for every word of `q` in page titles and descriptions and section headings and texts, each `{slug, title, kind, heading, snippet}` (`heading` is `null` for a hit on the page itself); `memory.invalidQuery` outside 2 to 200 characters |
| `POST /api/repos/:id/memory/sources` `{upload}` or `{url}` | add a source: a file staged with `POST /api/uploads`, or a link OLIMP fetches (admin; text, JSON, XML or PDF, at most 5 MB, 30 s; `memory.sourceType`, `memory.sourceTooLarge`, `memory.sourceFetch`; `memory.off` while the project's knowledge base is off). Stores a note recording it and queues a task with the file attached in which the project's agent weaves it into the memory, citing that note: `{note, task}` |
| `GET /api/repos/:id/memory/graph` | the memory as a mountain: `nodes` (`summit` the project, `hub` and `page` by `page:<slug>`, `note` by `note:<id>` with its text), `edges` (summit to hubs and to pages no hub links, hub to the pages it links as `[[slug]]`, page to the notes its sections cite) and `unwoven`, a count |
| `POST /api/repos/:id/memory/pages` `{slug, title, description, kind?}` | create a page (`kind`: `page` by default or `hub`); `memory.pageExists` if the slug is taken |
| `GET`, `PATCH /api/repos/:id/memory/pages/:slug` `{version, title?, description?, kind?}` | read a page with its sections; change it, refused with `memory.pageConflict` when it changed after `version` |
| `POST /api/repos/:id/memory/pages/:slug/sections` `{heading, body, sources?}` | add a section at the end (`sources`: note ids of the repository) |
| `PATCH …/memory/pages/:slug/sections/:heading` `{version, body?, sources?}` | change a section (URL-encoded heading), refused with `memory.sectionConflict` when it changed after `version` |

Tasks, automations, workflows, workflow runs, notes, memory pages and sections carry `author`: the
id of the account that created them (for memory, the one that changed it last), or `null` without
accounts and for data from before them.

### Projects

A project is a folder OLIMP works in, named by a short id from the folder's name (`olimp`,
`produktowo-pl`; `-2` when taken). What a task ends with depends on the folder:

| Folder | The agent works in | A task ends with |
|---|---|---|
| a git repository whose `origin` is on GitHub (`github` is owner/name) | a worktree on `olimp/<task id>` | a pushed branch and a pull request; issues can become tasks |
| a git repository without GitHub | a worktree on `olimp/<task id>` | a commit on that branch in the folder, to merge with `git merge olimp/<task id>` |
| a folder without git | the folder itself, one task at a time | the files as the agent left them: no branch, commit or change view |

An empty folder added as a project becomes a git repository at once, as a new local project does;
a folder with files stays as it is until an admin chooses Initialize git (on the project's Git
page or its general settings), which commits its files with `node_modules/` and `.env` files left
out.

A fresh installation, with no project yet, makes one on its first start: `sandbox`, a local git
repository in `OLIMP_PROJECTS/sandbox`, to try agents on before adding your own. A removed sandbox
does not come back, since its folder stays. Tasks commit with the git identity of the account OLIMP
runs as (`git config --global user.name` and `user.email`); without one a commit fails.

### Project settings

Every project has its own settings (Settings → a project in the sidebar): General
(its folder and entry), Secrets, Webhooks, External integrations (its MCP servers), Agents,
Instructions, Tasks, Agent config and Worktrees.

- **Instructions**: a system prompt for every agent step of the project's new tasks and runs,
  read after the global one and winning over it (up to 100,000 characters each; Claude and Codex
  then read a prompt over 128 KiB from stdin, any other agent fails the step saying so), and the
  prompt templates, shared by every project.
- **Tasks**: where a task works when it does not say (`workspace`: `worktree` or `checkout`,
  also the composer's default), the base branch, the skill the composer preselects
  (`defaultSkill`), whether it offers the skill sources' skills (`teamSkills`), pull requests as
  drafts (`draftPr`), labels on every pull request OLIMP opens (`prLabels`, made in the
  repository when missing), the kind of change as a label (`typeLabel`: the agent ends with
  `OLIMP:TYPE fix`, `feat`, `docs`, `refactor`, `test`, `chore` or `perf`, which also starts the
  pull request's title, `fix: …`, unless the task's title has a type already), a review of every
  pull request (`prReview`, see [Pull request review](#pull-request-review)), auto-merge
  (`autoMergeLabel`, admin only: every two minutes OLIMP merges its own open pull requests with
  that label once at least one check ran and every check passed, by the repository's first merge
  method, squash before merge before rebase), the check commands and GitHub issues.
- **Secrets** (admin): values for the `${NAME}` references of the project's integrations, stored
  encrypted with `OLIMP_HOME/auth.key` and never shown again. A secret wins over the OLIMP
  environment's variable of that name and reaches an agent only through an integration that
  refers to it, so names agents get anyway (`PATH`, `ANTHROPIC_API_KEY`, `OLIMP_*`) are refused.
- **Webhooks** (admin): when a task or workflow run of the project is done, fails or is
  cancelled (`done`, `failed`, `cancelled`), or a workflow run waits at a gate or a question
  (`waiting`, with its message or question), OLIMP posts its title, status and link to Slack,
  Discord, an ntfy topic or your own HTTPS endpoint (JSON). ntfy brings it to your phone: the
  address is the topic's (`https://ntfy.sh/TOPIC` or a self-hosted server's), you subscribe to
  the topic in the ntfy app, and a tap opens the job in the panel; a protected topic takes an
  access token. The address and the token are stored encrypted; the API shows only the host and
  whether a token is set.
- **Agent config**: the coding agents' own files: `.claude/settings.json`,
  `.mcp.json`, `CLAUDE.md`, `.codex/config.toml`, `AGENTS.md`, OpenCode's, Copilot's and
  Cursor's, in the project's folder (admin only; written without a commit, so tasks in a worktree
  see a change once it is committed on the base branch) and in your HOME; the git-ignored local
  layer too (`.claude/settings.local.json` and `CLAUDE.local.md`, copied into each task's worktree
  when git ignores them, and Copilot's `settings.local.json`); the names of Claude's MCP servers
  from `~/.claude.json` (user scope and the project's local one, read only); and which agents
  are not installed.
- **Worktrees**: Bash scripts around each job's worktree (`worktreeScripts`, admin only, each
  with a name and a timeout, 30 minutes by default): `afterCreate` runs in a new worktree before
  the agent, e.g. `pnpm install --frozen-lockfile` (a failure fails the job with its output),
  `beforeRemove` while its files still exist, before any removal (a failure keeps the folder).
  They run in order as the OLIMP user, without OLIMP's own variables but with
  `OLIMP_PROJECT_PATH`, `OLIMP_WORKTREE_PATH`, `OLIMP_JOB_ID` and `OLIMP_BRANCH`, and `bash -n`
  checks each one when saved. Also how many finished job worktrees stay on disk (`keepWorktrees`, the last 10 by default;
  0 removes each when its job ends), and the ones there now with their size; removing one or "Reclaim now" keeps the branch.

```sh
curl -s -X PATCH localhost:4850/api/repos/name/settings -H 'content-type: application/json' \
  -d '{"instructions":"Answer in Polish.","keepWorktrees":3}'
curl -s -X PUT localhost:4850/api/repos/name/secrets/SENTRY_TOKEN -H 'content-type: application/json' \
  -d '{"value":"…"}'
curl -s -X POST localhost:4850/api/repos/name/webhooks -H 'content-type: application/json' \
  -d '{"name":"Team","url":"https://hooks.slack.com/services/…","format":"slack"}'
curl -s -X POST localhost:4850/api/repos/name/webhooks -H 'content-type: application/json' \
  -d '{"name":"Phone","url":"https://ntfy.sh/olimp-…","format":"ntfy","events":["failed","waiting"]}'
```

### Accounts and tokens

Without accounts OLIMP works as a single-user tool on its machine: the API listens on loopback,
needs no sign-in, and agents use the logins of the user running OLIMP. Accounts are for reaching
OLIMP from elsewhere or by several people. Once one exists, **every request but `GET /health` and
the sign-in needs a sign-in**: the panel's session or, for MCP and scripts, `Authorization: Bearer
<token>` (a missing one is `auth.missingToken`, an unknown or revoked token `auth.invalidToken`,
both 401).

**The panel's sign-in follows Corivo's.** An e-mail and a password (at least 8 characters from
three of: lowercase, uppercase, digits, other), then always a second factor: a code from an
authenticator app (TOTP, with ten single-use backup codes), or, for an account without the app, a
6-digit code sent by e-mail. Without e-mail the app is set up at the first sign-in. Three failed
passwords lock the e-mail and the address for five minutes. A session lives in an `HttpOnly`,
`SameSite=Strict` cookie (`Secure` behind the TLS proxy) and ends after 30 minutes without
activity or after 8 hours. Under Settings → Account everyone changes their name, e-mail, password
and second factor, sees and ends their sessions and revokes their tokens.

**Turning accounts on.** Under Settings → Accounts the panel creates the first account, an admin,
with an e-mail and a password; the same works through the API without a token while there is none:

```sh
curl -s -X POST localhost:4850/api/users -H 'content-type: application/json' \
  -d '{"name":"pawel","email":"pawel@example.com","password":"…"}'   # then sign in in the panel
```

An admin then invites people by e-mail (name, e-mail, role): OLIMP sends a one-time link, valid
for 7 days, to set a password; the same link resets a forgotten password ("Forgot your password?"
on the sign-in, or "Send an invitation or password reset" in the list). An admin also changes
roles, resets a lost second factor and deletes accounts. E-mail goes through the SMTP server set in
Settings, Mail (the password encrypted with `OLIMP_HOME/auth.key` and never shown again), or
without it through `OLIMP_SMTP_URL`, from `OLIMP_MAIL_FROM`.

**Tokens** are for the MCP server, `pnpm agent-login` and scripts. An account without an e-mail is
one for scripts and gets its first token when created; so does the first account when it has no
password:

```sh
curl -s -X POST localhost:4850/api/users -H 'content-type: application/json' -d '{"name":"pawel"}'
# → {"id":"…","name":"pawel","role":"admin",…,"token":{"id":"…","token":"olimp_…"}}
export OLIMP_TOKEN=olimp_…   # shown only once: keep it like a password
curl -s -X POST localhost:4850/api/users/<id>/tokens -H "authorization: Bearer $OLIMP_TOKEN" \
  -H 'content-type: application/json' -d '{}'                       # another token (admin)
curl -s -X DELETE localhost:4850/api/tokens/<token id> -H "authorization: Bearer $OLIMP_TOKEN" \
  -H 'content-type: application/json'                               # revoke it
```

There are two roles: an `admin` manages accounts and tokens, a `member` does everything else.
Repositories, tasks, automations, workflows, notes and memory are shared by all accounts; what
someone creates carries their `author`. Anyone may revoke their own token. The database keeps only
hashes of tokens, passwords, backup codes and sessions, and the authenticator secret encrypted
with a key in `OLIMP_HOME/auth.key`.

**Own agent logins.** Each account has a directory `users/<id>/home` in `OLIMP_HOME`. The agent of
a task, workflow run or automation of that account runs with it as `HOME`, so `claude` and `codex`
use that person's login and subscription, never the installation's: the installation's
`ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*` and `CODEX_*` variables stay out too. Each person logs in once,
on the machine OLIMP runs on:

```sh
OLIMP_TOKEN=olimp_… pnpm agent-login claude   # interactive claude with your HOME: log in, then /exit
OLIMP_TOKEN=olimp_… pnpm agent-login codex    # codex login with your HOME
```

`pnpm agent-login` (`olimp agent-login` from npm) asks the API (`GET /api/me`) whose token it is and starts the CLI; it never opens
the database. Without a login of the step's agent (`.claude/.credentials.json` or
`.codex/auth.json` in that `HOME`) the step fails with a message naming the account and this
command; it never falls back to the installation's login. Logins are kept as files, as Claude Code
and Codex keep them on Linux. Data from before accounts has no author and runs as before, on the
installation's logins.

**Second logins and defaults** (Settings → Agent accounts). Beside the login in
`HOME`, an account (or, without accounts, the installation) can add more logins of Claude and
Codex, e.g. a work account beside a personal one (the other agents keep their login outside their
config folder, so they have one per `HOME`). Add account asks for the agent, a name
and, without accounts, the config folder (any, e.g. `~/.claude-second`, made when missing and kept
on the disk when the login is removed; OLIMP only links to it); with accounts OLIMP makes the folder
in the account's own directory. The agent runs with `CLAUDE_CONFIG_DIR` or `CODEX_HOME` pointing at
it, and Connect shows the sign-in command and waits until the login is there. Log in to one with
`OLIMP_TOKEN=olimp_… pnpm agent-login claude work` (without accounts:
`CLAUDE_CONFIG_DIR=<folder> claude`). Each project picks, in its own Agents settings, the agent of
new tasks, the model per agent and the login per agent by name; whatever it leaves on default takes
the installation's defaults on the same page (admin only), and a task can still pick its own agent
and model.

`git` and `gh` (clone, push, pull request, issues, `gh repo create`) always use the installation's
`gh` login, because repositories are shared; a pull request names the account behind it
(`requested by <name>`). An automation queues its tasks and runs as its author, also when someone
else changes or starts it; a task from an issue runs as the account that switched issues on in
that repository. Deleting an account deletes its tokens and agent logins; what it created keeps it
as `author`, and its queued tasks and automations then fail with a message saying so.

**Remote access.** The API keeps listening on `127.0.0.1`. To reach it from elsewhere, put a TLS
proxy in front of it on the same machine and set `OLIMP_PUBLIC_HOST` to the proxy's host name: the
API then also accepts that `Host` and the `https://` origin, but only while accounts exist. With
`OLIMP_PUBLIC_HOST` and no account OLIMP refuses to start: create the first account on loopback
first. The proxy must pass the original `Host` header. With Caddy (certificates from Let's
Encrypt):

```
olimp.example.com {
    reverse_proxy 127.0.0.1:4850
}
```

With nginx:

```nginx
server {
    listen 443 ssl;
    server_name olimp.example.com;
    ssl_certificate     /etc/letsencrypt/live/olimp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/olimp.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:4850;
        proxy_set_header Host $host;
        proxy_read_timeout 120s;
    }
}
```

Then `OLIMP_PUBLIC_HOST=olimp.example.com` and, for a remote MCP server,
`OLIMP_URL=https://olimp.example.com` with `OLIMP_TOKEN`. Never expose the port itself without TLS:
the token and the session travel in every request. E-mail links lead to `https://<OLIMP_PUBLIC_HOST>`,
or to `http://127.0.0.1:<port>` without it.

### Skills

A skills repository follows the [skills.sh](https://skills.sh) layout: `<name>/SKILL.md` with
`name` and `description` in the frontmatter, in a folder up to five levels deep (`skills/<name>`,
`skills/<group>/<name>`, `plugins/<plugin>/skills/<name>`); the shallowest folder of a name wins.
Register it as `owner/name` or a GitHub address, optionally with a branch (the default one
otherwise); OLIMP clones it with your `gh` login and fetches it on every use. The panel's settings
also search skills.sh (`GET /api/skill-search?q=`) and try a found skill in a new task.

Besides the sources, a task can use skills from the HOME its agent runs with (the account's own,
or the installation's without accounts): your own in `~/.claude/skills/<name>` as `~/name`, which
the panel and `POST`/`PUT`/`DELETE /api/own-skills` create, edit and delete, and the ones synced
from claude.ai (`~/.claude/skills/synced/…`, e.g. `/pdf`) as `claude.ai/name`. Like a source's
skill, it is copied into the task's worktree. A task or automation names a skill as
`owner/repo:name`, or just `name` when only one source has it; an unknown skill is refused with
`skill.unknown`, an ambiguous one with `skill.ambiguous`.

```sh
curl -s -X POST localhost:4850/api/skill-sources -H 'content-type: application/json' -d '{"repo":"owner/skills"}'
curl -s -X POST localhost:4850/api/tasks -H 'content-type: application/json' \
  -d '{"repo":"name","title":"Review the docs","skill":"docs-review"}'
curl -s -X DELETE localhost:4850/api/skill-sources/owner/skills -H 'content-type: application/json'
```

Removing a source deletes its entry and its clone; an unknown source is `skill.sourceNotRegistered`
(404). Tasks and automations that name one of its skills stay as they are, and running them fails
like a task whose skill disappeared.

The runner copies the skill to `.olimp/skills/<name>/` in the task's worktree, keeps it out of the
commit and tells the agent to read its `SKILL.md` first. This works the same for Claude and Codex.
A skill is data for the agent, not configuration: dotfiles (`.claude/`, `.mcp.json`, …),
`CLAUDE.md`, `AGENTS.md` and symlinks in the skill are not copied.

A project may keep its own skills in `.claude/skills/`, `.agents/skills/` or `skills/` (the first
folder with a name wins). A task names one as `./name`; the agent reads it where it is in the
worktree, nothing is copied.

### Workflows

A workflow is a graph of typed nodes that runs in one worktree on one branch
`olimp/<run id>`, so every step sees the changes of the steps before it. A node finishes by leaving
through one of its output ports, and the connection on that port leads to the next node. The panel
draws and edits it (Workflows → a workflow): a palette of every node, an inspector per node, ports
connected by dragging, a simulation that walks the graph port by port, the problems listed as you
edit, built-in templates, YAML export and import (also of the older lists of `steps` or `skills`)
and "Build from a description", where the project's agent plans the steps. The run's worktree does not
stay for good (the project keeps only its last finished ones), so a workflow that should keep its
change commits it with `git.commit` or `github.draft-pr`, as every built-in template does.

```sh
curl -s -X POST localhost:4850/api/workflows -H 'content-type: application/json' -d '{
  "name": "change-until-green",
  "repo": "name",
  "definition": {
    "nodes": [
      {"id": "start", "type": "start"},
      {"id": "work", "type": "agent", "prompt": "{{task}}"},
      {"id": "suite", "type": "check", "command": "pnpm test"},
      {"id": "attempts", "type": "loop", "max": 3},
      {"id": "repair", "type": "agent", "session": {"continue": "work"},
       "prompt": "pnpm test is red. Its output:\n{{nodes.suite.output}}\nMake it pass."},
      {"id": "pr", "type": "github.draft-pr"},
      {"id": "stuck", "type": "end", "status": "failed"}
    ],
    "edges": [
      {"from": "start.next", "to": "work"},
      {"from": "work.done", "to": "suite"},
      {"from": "suite.pass", "to": "pr"},
      {"from": "suite.fail", "to": "attempts"},
      {"from": "attempts.repeat", "to": "repair"},
      {"from": "attempts.exhausted", "to": "stuck"},
      {"from": "repair.done", "to": "suite"}
    ]
  }
}'
curl -s -X POST localhost:4850/api/workflows/<id>/run -H 'content-type: application/json' -d '{"input": "Fix the login"}'
curl -s localhost:4850/api/workflow-runs/<run id>
```

| Node | Fields | Ports |
|---|---|---|
| `start` | | `next` |
| `end` | `status` (`success`, `failed`) | |
| `loop` | `max` (1 to 20) | `repeat` while visited at most `max` times, then `exhausted` |
| `agent` | `prompt`, `skill?`, `agent?` (the project's by default), `model?`, `integrations?`, `allowedTools?`, `bashAllowlist?`, `verdicts?`, `session.continue?`, `review?` and `budgetUsd?` (fork branches) | `done`, `failed`, or one per verdict and `failed` |
| `check` | `command` (a shell command), `retryOn?` | `pass` (exit 0), `fail` |
| `if` | `condition`: `diff-lines` or `diff-files` (`op`, `value`), `paths-changed` (`glob`), `output` (`ref` as `node.field`, `op`, `value`), `branch` (`equals` or `matches`) | `true`, `false` |
| `gate.human` | `message`, `timeoutMs?` | `approve`, `reject` (`timeout`) |
| `ask-user` | `question`, `options?` (up to 6), `timeoutMs?` | `answered` (`timeout`) |
| `dispatch` | `prompt`, `agent?`, `model?`, `budgetUsd?` | `done`, `failed` |
| `fork` | `branches` (2 to 4), each port to an agent run as a subtask, all of them into one `join` | `1` … `4` |
| `join` | `wait` (`all`, `any`) | `done`, `failed` |
| `workflow` | `workflow` (another workflow of the repository), `prompt?`, `budgetUsd?` | `done`, `failed` |
| `git.commit` | `message`; files a check wrote and nothing changed since stay out (also from autosaves and the pull request) | `done`, `nothing`, `failed` |
| `git.push`, `git.sync-base` | | `done`, `failed`; `git.sync-base` also `conflict` (the merge is left in progress) |
| `github.draft-pr` | `title?`, `draft?` (the project's setting by default) | `created`, `failed` |
| `github.pr-update` | `ready?`, `addLabels?`, `reviewers?` | `done`, `failed` |
| `github.pr-comment`, `github.issue-comment` | `body`; `issue?` for an issue, else the one an agent named with `OLIMP:ISSUE <n>` | `done`, `failed` |
| `github.wait-ci` | `timeoutMs`, `pollMs`; only the checks of the worktree's commit count, and a conflicting pull request ends on `red` at once | `green`, `red`, `timeout`, `failed` |
| `notify.webhook` | `url` (HTTPS, or `${SECRET}` of the project), `body?` | `done`, `failed` |

`{{task}}` in a text field is the run's request and `{{nodes.<id>.<output>}}` an earlier node's
output (an agent's `summary`, `verdict`, `status`; a check's `exitCode` and `output`; a gate's
`comment`; an answer; a loop's `iteration` and `max`; …). An agent prompt that never names `{{task}}`
gets the request after it. An agent with verdicts is told to end with `OLIMP:VERDICT <name>` and
leaves by that port (asked once more if it did not); `session.continue` resumes the Claude session
of another agent node. An unwired port ends the run: failed for `failed`, `fail`, `exhausted`,
`reject`, `red`, `timeout` and `conflict`, done for any other.

A gate, a question, CI and subtasks park the run as `waiting`: it gives its worker slot back and
keeps its worktree until an answer (`POST /api/workflow-runs/:id/answer`), CI, its subtasks or the
timeout queue it again. A fork's branches and a dispatch node are tasks with `parentRun`, from the
run's branch (committed first); a reviewer branch commits nothing, the others push their branch
without a pull request; nothing merges back. A sub-workflow is a run with `parentRun`, nested at
most three deep.

A definition is checked when saved, with a code for each problem (`workflow.edgeTo`,
`workflow.cycle`, `workflow.unreachable`, `workflow.forkNeedsJoin`, …): one start, ports and targets
that exist, one connection per port, every cycle through a loop, the fork shape, references that
name nodes, at most 50 nodes. Definitions saved before the graph editor are read as graphs.

A run copies the workflow's name, repository and definition when it is queued, so editing or
deleting the workflow does not change runs already queued. Tasks and workflow runs share one
queue: oldest first.

### Notes

Notes are what agents and people learned about a project, kept for later tasks: raw, never
changed, the sources of its memory. With the project's knowledge base on, an agent step adds them
with the `olimp_add_note` tool of its memory server (below), each with the step as its source (the
task, or the workflow run and node) and up to 2000 characters; a person adds them in the panel,
through the API or MCP.

```sh
curl -s 'localhost:4850/api/notes?repo=name'
curl -s -X POST localhost:4850/api/notes -H 'content-type: application/json' \
  -d '{"repo":"name","text":"Integration tests need a running Postgres"}'
curl -s -X DELETE localhost:4850/api/notes/<id> -H 'content-type: application/json'
```

### Repository memory

Each repository has a memory of pages, the way a Jarvis-like wiki keeps knowledge. A page has a
slug (`a-z`, `0-9` and single hyphens), a title, a one-sentence description, a kind (`page`, or
`hub` for a page whose sections lead to other pages as `[[slug]]`) and ordered sections. A section
is a heading, its text, the ids of the notes it rests on, a version and who changed it last (a
task, a workflow run and node, or the API). Notes that no section cites are "unwoven".

**Knowledge base.** Off by default: a project's agents know it from the repository's own files
(`AGENTS.md`, `CLAUDE.md`, its docs), and OLIMP adds nothing about memory to their prompts. Turned
on in the project's settings (`memory`), every agent step on an agent that takes MCP servers
(Claude, Codex, Junie, OpenCode, Copilot) gets OLIMP's own MCP server `olimp-memory`, signed with
a token issued for that step and revoked when it ends. Its tools read the map, pages and notes,
search the memory, add notes, and create and change pages and sections; a change names the
version the agent read, so it never overwrites a newer one and the agent reads again. One
paragraph of the prompt says that the knowledge base exists and that the repository's own
instructions come first: the agent asks it when a task needs what earlier tasks learned. The
token reaches only the memory and notes of the step's project and its knowledge areas: it cannot
delete a note, add a source or call anything else in the API. The memory weaving and lint
(built-in automations) and sources work only with the knowledge base on. Cursor and pi take no MCP
servers, so their steps run without it.

The memory is data, not instructions: an agent may have written it under the influence of
repository content. Read it now and then in the panel, through the API or MCP and correct it.

In the panel a project's Memory shows the hubs and pages with their sections as Markdown
(`[[slug]]` opens the page), edits a section's text, adds sections and pages (the slug follows the
title until you change it), searches the memory and adds a note in the unwoven notes tab; with the knowledge base off, it says
so and links to the project's settings. An edit
is saved with the version it started from: when the section changed meanwhile, the panel shows
the API's refusal and the new text, and saves your text on the new version only after you apply
it there. A search ranks a hit by where each word occurs (page title, then section heading, then
description or text), adds the same again when the whole query occurs as a phrase, and keeps
pages in slug order and sections in page order when hits tie. Limits: 200 pages
per repository, 50 sections per page, 10 000 characters per section, 50 cited notes per section and
1 000 000 characters per repository.

```sh
curl -s localhost:4850/api/repos/name/memory
curl -s -X POST localhost:4850/api/repos/name/memory/pages -H 'content-type: application/json' \
  -d '{"slug":"build","title":"Build","description":"How to build and test the repository."}'
curl -s -X POST localhost:4850/api/repos/name/memory/pages/build/sections \
  -H 'content-type: application/json' -d '{"heading":"Tests","body":"Run pnpm test.","sources":["<note id>"]}'
curl -s -X PATCH localhost:4850/api/repos/name/memory/pages/build/sections/Tests \
  -H 'content-type: application/json' -d '{"version":1,"body":"Run pnpm run test."}'
curl -s 'localhost:4850/api/repos/name/memory/search?q=pnpm+test'
```

OLIMP keeps `.olimp/` in the worktree for the skill of a step, so a repository that has its own
`.olimp/` directory fails its tasks with a message saying so.

### MCP integrations

An integration is an MCP server that belongs to one repository: a name unique in the repository
(letters, digits, `_`, `-`) and either `kind: "stdio"` (`command`, `args`, `env`) or `kind:
"http"` (`url`, `headers`). An agent step gets only the integrations it names in `integrations`
(a task, an automation's task template or a workflow's `agent` node), and never the MCP servers
of your own `claude` or `codex` configuration.

A value of `env` or `headers` refers to a secret as `${NAME}`: one of the project's secrets (see
[Project settings](#project-settings)), or else an environment variable of the OLIMP process;
OLIMP stores the reference and the agent gets the value when the step starts. An `Authorization` header without a reference is refused, and references are allowed only
in `env` and header values.

```sh
curl -s -X POST localhost:4850/api/repos/name/integrations -H 'content-type: application/json' \
  -d '{"name":"github","kind":"stdio","command":"github-mcp-server","args":["stdio"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"${GITHUB_MCP_TOKEN}"}}'
curl -s -X POST localhost:4850/api/repos/name/integrations -H 'content-type: application/json' \
  -d '{"name":"sentry","kind":"http","url":"https://mcp.sentry.dev/mcp","headers":{"Authorization":"Bearer ${SENTRY_TOKEN}"}}'
curl -s -X POST localhost:4850/api/tasks -H 'content-type: application/json' \
  -d '{"repo":"name","title":"Fix the top Sentry error","integrations":["sentry"]}'
```

Save them as the project's secrets, or start OLIMP with those variables set (`SENTRY_TOKEN=… pnpm
start`). A step whose integration
refers to a variable that is not set fails with the name of the variable, never a value. An
unknown name is refused with `integration.unknown` when the task, automation or workflow is
saved; a step whose integration was deleted later fails when it starts, like a removed skill.

- **Claude** gets `--strict-mcp-config` on every step, also without integrations, so only the
  chosen servers are loaded; `--mcp-config` with them (Claude expands the `${NAME}` references
  itself, nothing is written to disk) and `--allowedTools mcp__<name>` for each, because tools
  outside the edit permissions are otherwise refused in print mode.
- **Codex** gets the chosen servers as one `-c mcp_servers={…}` override. Codex does not expand
  references, so OLIMP puts each value with a reference into the environment of the `codex`
  process and the configuration only names the variable (`env_vars`, `env_http_headers`);
  values never appear in arguments or files. Known limitation: Codex has no flag like
  `--strict-mcp-config`; the override replaces the `mcp_servers` table of `~/.codex/config.toml`
  as Codex merges `-c` values today, which a later Codex version could change. Two integrations
  of one Codex step must not set the same `env` variable to different values.

A reference to an `OLIMP_*` variable fails the step: OLIMP's own configuration never reaches an
agent.

### Agent environment and commands

OLIMP runs agents without containers: the worktree separates files and the branch,
and what protects the rest is the agent's environment, the agent's own sandbox and the commands a
repository allows.

**Environment.** An agent process gets only: system variables (`PATH`, `HOME`, `USER`, `LOGNAME`,
`SHELL`, `LANG`, `LANGUAGE`, `LC_*`, `TZ`, `TERM`, `TMPDIR`, the proxy variables), the login and
configuration variables of its own agent (Claude: `ANTHROPIC_*`, `CLAUDE_*`; Codex: `OPENAI_*`,
`CODEX_*`), the variables the step's integrations refer to, and the names listed in
`OLIMP_AGENT_ENV` (comma-separated). Nothing else: no `OLIMP_*` variable (also not through
`OLIMP_AGENT_ENV`), no database URL, no `GH_TOKEN` or `GITHUB_TOKEN` (OLIMP runs git and gh
itself) and no secret of an integration the step did not choose. `git` and `gh` keep OLIMP's
environment without `OLIMP_DATABASE_URL` and `OLIMP_TEST_MYSQL_URL`. The agent of an account's
step gets that account's `HOME` and none of the installation's agent login variables (see
[Accounts and tokens](#accounts-and-tokens)).

**Commands.** A repository may list shell commands agents run to check their work:

```sh
curl -s -X PUT localhost:4850/api/repos/name/commands -H 'content-type: application/json' \
  -d '{"commands":["pnpm typecheck","pnpm lint","pnpm run test"]}'
curl -s -X DELETE localhost:4850/api/repos/name/commands -H 'content-type: application/json'
```

At most 20 commands of up to 200 characters, without characters that chain, substitute or
redirect commands (`;`, `&`, `|`, `` ` ``, `$`, `<`, `>`), parentheses, commas, `*`, `\` or line
breaks (`commands.invalid`). Every prompt asks the agent to run them before it finishes. They do
not limit the shell: Claude gets the whole `Bash` tool, Codex runs any command in its own
`workspace-write` sandbox without network (`--full-auto`), and the other agents run with every tool
allowed. Agents run code as the OLIMP user, so give OLIMP only repositories whose code you would run
yourself.

### GitHub issues

```sh
curl -s -X PUT localhost:4850/api/repos/name/issues -H 'content-type: application/json' -d '{}'
curl -s -X PUT localhost:4850/api/repos/name/issues -H 'content-type: application/json' -d '{"label":"ready-for-agent"}'
curl -s -X DELETE localhost:4850/api/repos/name/issues -H 'content-type: application/json'
```

Every 5 minutes OLIMP asks your `gh` for up to 30 open issues with the label in each repository
that has issues switched on (`gh issue list --label`). Each new issue becomes one Claude task, with
the issue's number in `issue`, its title and its body, which the prompt quotes as text from
GitHub; the pull request description starts with `Closes #<number>`. One issue gives one task,
also after a restart and also when the issue is closed and reopened. OLIMP does not comment on issues and
writes nothing to GitHub but the pull request. A repository where `gh` fails is logged and the
others are still polled. With accounts, the issue's task runs as the account that switched issues
on (`issueAuthor`).

The label is the gate: on GitHub only people with triage access to a repository can label its
issues, so an issue from anyone else in a public repository does not start an agent until a
maintainer labels it.

### Pull request review

With `prReview` on (Project settings, Tasks, or `PATCH /api/repos/:id/settings`
`{"prReview":true}`), the same 5-minute poll asks your `gh` for up to 30 open pull requests of the
repository (`gh pr list`) and queues one review task for each new head: `reviewPr` is the pull
request, `reviewSha` its head, and one head gives one review, also after a restart. Drafts wait
until they are ready. A pull request from a fork is skipped, since its code is anyone's; a branch
of the repository itself takes write access to push, which is the gate a label is for issues.

When the task starts, OLIMP reads the pull request again (`gh pr view`; a closed one or one from a
fork fails the task) and makes a worktree from its head. The agent gets the pull request's title
and description quoted as text from GitHub, `git diff origin/<base>...HEAD` as the change, and is
asked to report real defects and to change nothing; OLIMP posts its answer on the pull request
(`gh pr comment`, up to 30,000 characters) with the reviewed commit and the task id, and sets the
task's `prUrl` to the pull request. Nothing is committed or pushed. A retry or a continuation of a
review task reviews the pull request's current head again. With accounts, reviews run as the
account that switched them on (`prReviewAuthor`).

### Automations

```sh
curl -s -X POST localhost:4850/api/automations -H 'content-type: application/json' \
  -d '{"name":"Weekday docs review","cron":"30 6 * * 1-5","repo":"name","title":"Review the docs","skill":"docs-review"}'
```

`cron` has five fields: minute, hour, day of month, month, day of week (0 and 7 are Sunday), with
`*`, lists (`1,15`), ranges (`1-5`) and steps (`*/15`, `0-30/10`). Names like `MON` are not
supported. When both day fields are restricted, a day matching either one runs (classic cron).
Times are in the **local time zone of the machine running OLIMP**: at a daylight-saving change a
skipped hour does not run and a repeated hour runs twice.

The API process checks every minute which enabled automations are due and queues their tasks. A
minute missed while OLIMP was stopped is not made up, and one minute never queues the same
automation twice, also across a restart.

An automation queues either a task from its template or a run of a workflow
(`{"name":"Nightly","cron":"0 3 * * *","workflow":"<id>"}`), never both
(`automation.taskAndWorkflow`). The task or run keeps the automation's id in `automation` and is
queued as the automation's `author`.

### Trace, costs and live events

Claude runs with `--output-format stream-json --verbose` and Codex with `exec --json`, so OLIMP reads
an agent's work as it happens. Every agent step stores its **events**, up to 1000 per step and kept
for 30 days: first what OLIMP sent, the whole `prompt` (the instructions, memory request, thread
and task) and the `command` that started the agent (its arguments, folder and the names of its
environment variables; a value only for the ones that place it, such as `HOME` and `PATH`, since
the others may hold secrets); then messages (`text`), tool calls (`tool`, e.g. `Bash: pnpm test`),
the final `result` and `error`s. Each has a one-line summary of at most 500 characters and its
whole content in `detail`. For Claude also the `session` it loaded (version, model, tools, MCP
servers, skills, commands, from its `init`), each tool's `output`, and the whole result with the
tokens split into fresh input and cache writes and reads. The task's `log`
(and a step's) is the agent's final answer; when the agent gave none, its raw output.

A task and an agent step keep their **usage** as the CLI reports it: `turns`, `costUsd`,
`inputTokens` (cache reads and writes included) and `outputTokens`, and `durationMs`. Codex reports
no cost, so its `costUsd` is `null`; a run sums its agent steps.

```sh
curl -s localhost:4850/api/tasks/<id>/trace
curl -s 'localhost:4850/api/costs?by=agent&days=7'
# → {"by":"agent","days":7,"since":"…","total":{"jobs":3,"unpriced":1,"costUsd":0.75,…},
#    "groups":[{"key":"claude","jobs":1,"costUsd":0.5,…},{"key":"codex",…},{"key":"workflow",…}]}
```

The cost report groups by UTC `day`, `repo`, `agent` (`workflow` for a run, whose steps may use
both agents) or `author` (with the account's `name`); `unpriced` counts jobs without a cost. Jobs
that never reached an agent are left out.

`GET /api/events` is a stream of [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html):
`event: task` with the task (without `log`) after every change, `event: run` with the run summary,
and `event: agent` with each agent event as it is stored. With accounts it needs the token in the
`Authorization` header like every other path; a token in the URL is not accepted (URLs end up in
logs), so a browser reads the stream with `fetch`, not `EventSource`. At most 10 streams are open
at once (`events.tooMany`); a client that disconnects, or reads too slowly, is dropped.

```sh
curl -N -H "Authorization: Bearer $OLIMP_TOKEN" localhost:4850/api/events
```

### Cancel, retry and continue

`POST /api/tasks/:id/cancel` cancels a queued task before it starts. A running task's agent gets
SIGTERM and, 5 seconds later, SIGKILL, with everything it started; its notes and memory are kept
as after a failure, the worktree is kept or removed as after any job, nothing is pushed, and the task ends `cancelled` with
`error` naming who cancelled it. Workflow runs cancel the same way, the running step included.

`POST /api/tasks/:id/retry` queues a finished task again: a new task with the same repository,
title, body, agent, skill and integrations, `retryOf` the first. A retried GitHub-issue task still
quotes its issue to the agent and closes it.

`POST /api/tasks/:id/continue` `{"body":"Now the docs too"}` is the next step of a conversation: a
new task in the same **thread** (`thread` is the id of its first task) that works on the thread's
branch, in the thread's worktree folder, with the changes of the tasks before it. On Claude, with
the same author as the task before it, it resumes that task's session; otherwise its agent sees the
titles, requests and answers of the last 5 tasks of the thread (up to 20,000 characters) as context. If the thread has a
pull request, its changes are pushed to it and no second one is opened; otherwise its first change
opens one. Retries and continuations are made on behalf of the caller. `GET /api/tasks/:id/thread`
lists the whole thread from any of its tasks.

### Composer

A task can say which model its agent uses (`model`, passed as `--model` to Claude and `-m` to
Codex; none keeps the CLI's default; `GET /api/models` lists the ones the panel offers) and carry
files: `POST /api/uploads` stages one (base64, at most 5 MB, kept in `OLIMP_HOME/uploads` for a
day), and the task's `attachments` list the upload ids. OLIMP moves them to
`OLIMP_HOME/attachments/<task>`, never into the repository, and the agent's prompt lists their
paths; Claude also gets the folder with `--add-dir`. A retry copies its task's files.

`variants: 2` or `3` queues as many tasks of one prompt, each on its own branch and worktree: B is
told to prefer a minimal change, C a thorough one. They share `variantGroup`;
`POST /api/task-groups/:group/pick` keeps one once all have finished and archives the rest, closing
their pull requests with their branches (or deleting a local project's branch).

`dispatch` lets the agent split the task: while it works it gets one more MCP
server, `olimp-dispatch`, whose `dispatch_subtask` adds a subtask (at most `maxSubtasks`, 50 by
default). The subtasks wait until the task is done, then run (`inFlight` at once, 4 by default)
each on its own branch from the task's branch, without a pull request. When the last one finishes,
OLIMP queues one more step of the task's thread: it merges the finished subtasks' branches (a
conflict is committed with its markers), and its agent resolves the conflicts and checks the whole;
its push updates the thread's pull request. A task that fails or is cancelled cancels its queued
subtasks. Subtasks run with the task's agent and model unless `agent` or `model` says otherwise
(another agent without a model takes its CLI's default); `budgetUsd` only asks the agent to size
each subtask to about that cost. The agent's server calls `/api/dispatch/subtasks` with a token OLIMP issues for that task
only while it works and keeps only in memory; that path takes no account token and does nothing
else.

A task works in a worktree of its own unless it says `worktree: false`: then its agent
works in the project's checkout, one such task at a time per project. Without `newBranch` it stays
on the branch the checkout has and leaves its changes uncommitted for you to review (`workspace`
`checkout`); with it the checkout first switches to a new branch from the base (`branch` names it,
`olimp/<task id>` otherwise, never the base itself), and OLIMP commits there, pushes and opens the
pull request as from a worktree (`workspace` `branch`). Variants and dispatch always use worktrees
(`task.checkoutAlone`).

A project's base branch (`PUT /api/repos/:id/branch`) is where new tasks start and where their pull
requests go. The panel's prompt templates are saved with
`PUT /api/prompt-templates`; dictation in the panel is the browser's own speech recognition (Chrome
and Edge, over https or on localhost), so nothing of it reaches OLIMP.

### Changes

`GET /api/tasks/:id/changes` (and `GET /api/workflow-runs/:id/changes`) reads OLIMP's clone of the
repository, without fetching: the job's branch as it was pushed against the default branch, from
where they diverged. `files` lists every changed file with `added` and `deleted` lines (`null` for
a binary file) and `diff` is the unified diff. The diff is cut at 200,000 characters and the list
at 1000 files (`diffTruncated`, `filesTruncated`); `head` is `null` while nothing was pushed (a
queued, failed or unchanged job). A continuation shows its thread's branch, so all its tasks'
changes.

A task's branch can also be browsed, as the task page does: `GET /api/tasks/:id/commits` lists the
commits it adds to the default branch, newest first (at most 200), `GET /api/tasks/:id/commits/:sha`
shows one of them with its files and diff (any commit outside the branch is `task.commitNotFound`),
`GET /api/tasks/:id/files` lists every file at the branch's head (at most 10,000) and
`GET /api/tasks/:id/files?path=<path>` reads one, cut at 200,000 characters; a binary file comes
without `content`, except an image (PNG, JPEG, GIF, WebP, AVIF, ICO) up to 2 MiB: `image` is its
media type and `content` is base64, which the task page shows.

```sh
curl -s localhost:4850/api/tasks/<id>/changes
# → {"task":"…","branch":"olimp/…","base":"main","head":"<sha>","files":[{"path":"README.md",
#    "added":3,"deleted":1}],"filesTruncated":false,"diff":"diff --git …","diffTruncated":false}
```

Errors are `{"error": "<message>", "code": "<key>"}`. Rely on `code` (e.g. `repo.notRegistered`);
`error` is in English, or in Polish with `Accept-Language: pl`. Messages live in
`messages/{en,pl}.json`.

## MCP

`olimp mcp` (`pnpm mcp` in a clone) starts an MCP server on stdio with the tools `olimp_add_repo`, `olimp_create_repo`,
`olimp_list_folders`, `olimp_create_folder`, `olimp_list_github_owners`, `olimp_list_repos`, `olimp_get_repo`, `olimp_remove_repo`, `olimp_whoami`, `olimp_list_users`, `olimp_create_user`,
`olimp_delete_user`, `olimp_list_tokens`, `olimp_create_token`, `olimp_revoke_token`,
`olimp_create_task`, `olimp_list_tasks`, `olimp_get_task`, `olimp_get_task_trace`,
`olimp_list_subtasks`, `olimp_list_models`, `olimp_upload_file`, `olimp_get_task_attachment`, `olimp_get_variants`, `olimp_pick_variant`, `olimp_list_branches`, `olimp_create_branch`, `olimp_set_base_branch`, `olimp_get_prompt_templates`, `olimp_set_prompt_templates`,
`olimp_get_task_changes`, `olimp_list_task_commits`, `olimp_get_task_commit`, `olimp_list_task_files`, `olimp_get_task_file`, `olimp_get_task_thread`, `olimp_cancel_task`, `olimp_retry_task`, `olimp_continue_task`,
`olimp_archive_task`, `olimp_unarchive_task`, `olimp_pin_task`, `olimp_unpin_task`, `olimp_list_pins`, `olimp_mark_task_read`, `olimp_mark_task_unread`, `olimp_mark_run_read`, `olimp_mark_run_unread`, `olimp_list_reads`, `olimp_get_costs`,
`olimp_watch_events` (listens to `GET /api/events` for up to 60 seconds), `olimp_add_skill_source`,
`olimp_list_skill_sources`, `olimp_refresh_skill_sources`, `olimp_remove_skill_source`, `olimp_list_skills`, `olimp_read_skill`,
`olimp_list_automations`, `olimp_get_automation`, `olimp_create_automation`,
`olimp_update_automation`, `olimp_delete_automation`, `olimp_run_automation`,
`olimp_list_workflows`, `olimp_create_workflow`, `olimp_get_workflow`, `olimp_update_workflow`,
`olimp_delete_workflow`, `olimp_run_workflow`, `olimp_list_workflow_runs`, `olimp_get_workflow_run`,
`olimp_get_workflow_run_trace`, `olimp_get_workflow_run_changes`, `olimp_cancel_workflow_run`, `olimp_retry_workflow_run`,
`olimp_continue_workflow_run`, `olimp_get_workflow_run_thread`,
`olimp_answer_workflow_run`, `olimp_build_workflow`,
`olimp_list_notes`, `olimp_add_note`, `olimp_delete_note`, `olimp_get_memory_map`,
`olimp_get_memory_page`, `olimp_search_memory`, `olimp_create_memory_page`, `olimp_update_memory_page`,
`olimp_add_memory_section`, `olimp_update_memory_section`, `olimp_list_unwoven_notes`,
`olimp_list_integrations`, `olimp_add_integration`, `olimp_update_integration`,
`olimp_delete_integration`, `olimp_enable_issues`, `olimp_disable_issues`, `olimp_set_commands`
and `olimp_clear_commands`. It calls the running
API (`OLIMP_URL`, default
`http://127.0.0.1:4850`), with `Authorization: Bearer $OLIMP_TOKEN` when `OLIMP_TOKEN` is set, so
with accounts it acts as that account. With `OLIMP_STEP_TOKEN` it is an agent step's `olimp-memory`
server: only the memory and note tools, signed with that step's token. For Claude Code:

```sh
claude mcp add olimp -e OLIMP_TOKEN=olimp_… -- npx -y olimp-run mcp        # from npm
claude mcp add olimp -e OLIMP_TOKEN=olimp_… -- pnpm --dir /path/to/olimp mcp  # from a clone
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OLIMP_DATABASE_URL` | none (SQLite) | `mysql://user:password@host:port/database` for MySQL or MariaDB; `?ssl-mode=REQUIRED` or `VERIFY_IDENTITY` encrypts |
| `OLIMP_HOME` | `~/.olimp` | SQLite database, clones of skills repositories and of task repositories registered before folders, worktrees, accounts' agent logins (`users/<id>/home`) |
| `OLIMP_PROJECTS` | `$OLIMP_HOME/projects` | where cloned and new repositories get their folders (`~/` allowed) |
| `OLIMP_BROWSE_ROOT` | your home folder | where the panel's folder picker starts; nothing above it can be listed or registered (`~/` allowed) |
| `OLIMP_PORT` | `4850` | port of the API and the panel (bound to 127.0.0.1); `pnpm dev:web` proxies to it, 4851 when unset |
| `OLIMP_URL` | `http://127.0.0.1:$OLIMP_PORT` | API the MCP server and `pnpm dev:web` talk to |
| `OLIMP_PUBLIC_HOST` | none | host name of a TLS proxy in front of the API, accepted only while accounts exist; see [Remote access](#accounts-and-tokens) |
| `OLIMP_TOKEN` | none | token the MCP server and `pnpm agent-login` send; never passed to agents |
| `OLIMP_CLAUDE`, `OLIMP_CODEX`, `OLIMP_GH` | `claude`, `codex`, `gh` | binaries |
| `OLIMP_JUNIE`, `OLIMP_OPENCODE`, `OLIMP_CURSOR`, `OLIMP_PI`, `OLIMP_COPILOT` | `junie`, `opencode`, `cursor-agent`, `pi`, `copilot` | binaries of the optional agents (run without a sandbox) |
| `OLIMP_TASK_TIMEOUT_MIN` | `30` | agent time limit per task and per agent step of a workflow |
| `OLIMP_MAX_PARALLEL` | `1` | tasks and workflow runs that work at once; a folder without git takes one at a time |
| `OLIMP_AGENT_ENV` | none | comma-separated names of more variables passed to every agent (never `OLIMP_*`); see [Agent environment and commands](#agent-environment-and-commands) |
| `OLIMP_LOCALE` | `en` | language of API messages the MCP server asks for (`en` or `pl`) |
| `OLIMP_SKILLS_SEARCH_URL` | `https://skills.sh` | Directory whose `/api/search` the skill search queries |
| `OLIMP_SMTP_URL`, `OLIMP_MAIL_FROM` | none | SMTP server (`smtps://user:password@host:465`) and sender of invitations, password resets and sign-in codes |

The time limit, the parallel jobs, `OLIMP_PROJECTS` and `OLIMP_BROWSE_ROOT` are defaults: the
panel's general settings (or `PUT /api/settings`, MCP `olimp_update_settings`) save another value
in the database, which applies at once and wins until it is reset there.
