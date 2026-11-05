// Input limits in characters. The API enforces them and the MCP tool schemas declare the same ones,
// so this module imports nothing: the MCP process must not load the store.
export const NAME_MAX = 100;
export const TITLE_MAX = 200;
// A search: the skills.sh directory, a project's memory.
export const SEARCH_MIN = 2;
export const TASK_BODY_MAX = 20_000;
// A repository id, a skill reference or a workflow id.
export const REF_MAX = 200;
export const CRON_MAX = 100;
export const NOTE_MAX = 2000;
export const CONDITION_TEXT_MAX = 1000;
// A workflow: its description, a check's shell command, and the request the builder plans from.
export const WORKFLOW_DESCRIPTION_MAX = 500;
export const CHECK_COMMAND_MAX = 2000;
export const BUILD_REQUEST_MAX = 4000;
// MCP integrations of a repository: a name, every string of a configuration, the number of
// arguments, variables or headers, and how many integrations one step may choose.
export const INTEGRATION_NAME_MAX = 50;
export const INTEGRATION_VALUE_MAX = 2000;
export const INTEGRATION_ENTRIES_MAX = 50;
export const STEP_INTEGRATIONS_MAX = 20;
// Commands a repository lets agents run to check their work: one command and how many.
export const COMMAND_MAX = 200;
export const COMMANDS_MAX = 20;
// GitHub allows labels of up to 50 characters and repository descriptions of up to 350.
export const ISSUE_LABEL_MAX = 50;
export const PR_LABELS_MAX = 10;
// Knowledge areas a project shares its memory with.
export const AREAS_MAX = 5;
export const WORKTREE_SCRIPTS_MAX = 20;
export const SCRIPT_MAX = 32 * 1024;
export const SCRIPT_NAME_MAX = 120;
export const SCRIPT_TIMEOUT_MAX_S = 86_400;
export const SCRIPT_TIMEOUT_DEFAULT_S = 1800;
export const REPO_DESCRIPTION_MAX = 350;
export const PATH_MAX = 4096;
// An account name: a letter or digit, then letters, digits, _ . or -.
export const USER_NAME_MAX = 64;
export const USER_NAME = new RegExp(`^[A-Za-z0-9][\\w.-]{0,${USER_NAME_MAX - 1}}$`);
// Repository memory: a page slug, its one-sentence description, a section's text and the note ids
// it cites, sections per page, pages per repository, and the whole memory of a repository (titles,
// descriptions, headings and texts together).
export const MEMORY_SLUG_MAX = 64;
export const MEMORY_DESCRIPTION_MAX = 300;
export const MEMORY_SECTION_MAX = 10_000;
export const MEMORY_SOURCES_MAX = 50;
export const MEMORY_SECTIONS_MAX = 50;
export const MEMORY_PAGES_MAX = 200;
export const MEMORY_MAX = 1_000_000;
// Hits a search of a memory answers with, the best first.
export const MEMORY_SEARCH_HITS = 20;
// The cost report: how it groups and how many days back it reaches at most.
export const COST_GROUPS = ["day", "repo", "agent", "author"] as const;
export type CostGroup = (typeof COST_GROUPS)[number];
export const COST_DAYS_MAX = 366;
// The changes of a job's branch: characters of the diff and files listed, cut beyond that.
export const DIFF_MAX = 200_000;
export const DIFF_FILES_MAX = 1000;
// A job's branch as the task page browses it: commits listed, files of its tree, characters of a file.
export const COMMITS_MAX = 200;
export const TREE_FILES_MAX = 10_000;
export const FILE_MAX = 200_000;
// Bytes of an image the task page shows; a larger one is only named as binary.
export const IMAGE_MAX = 2 * 1024 * 1024;
export const SKILL_TEXT_MAX = 100_000;
// Files attached to a task: bytes of one, how many, and how long an unused upload is kept.
export const UPLOAD_MAX = 5 * 1024 * 1024;
export const ATTACHMENTS_MAX = 10;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_NAME_MAX = 100;
// A memory source fetched from a link: its address and how long the fetch may take.
export const SOURCE_URL_MAX = 1000;
export const SOURCE_FETCH_MS = 30_000;
// The task composer: a model id, variants of one prompt, and the saved prompt templates.
export const MODEL_MAX = 64;
export const VARIANTS_MAX = 3;
export const TEMPLATES_MAX = 50;
export const TEMPLATE_LABEL_MAX = 80;
export const TEMPLATE_TEXT_MAX = 4000;
// The templates are one settings row.
export const TEMPLATES_BYTES_MAX = 60_000;
// A system prompt, global or a project's: a MEDIUMTEXT on MySQL holds it. The agent's command line
// caps the whole prompt at 128 KiB anyway, which the runner reports by name.
export const INSTRUCTIONS_MAX = 100_000;
// How long the MCP tool that watches the event stream waits at most, and how many events it keeps.
export const EVENT_WATCH_SECONDS_MAX = 60;
export const EVENT_WATCH_MAX = 200;

export const EMAIL_MAX = 254;
export const PARALLEL_MAX = 16;
export const TIMEOUT_MAX_MIN = 24 * 60;
// A project's own settings: its system prompt shares the global one's limit; finished worktrees it
// keeps, secrets (name and value) and webhook receivers.
export const KEEP_WORKTREES_MAX = 50;
export const SECRETS_MAX = 50;
export const SECRET_NAME_MAX = 64;
export const SECRET_VALUE_MAX = 4000;
export const WEBHOOKS_MAX = 20;
export const WEBHOOK_URL_MAX = 2000;
// An agent's config file as the panel edits it.
export const AGENT_CONFIG_MAX = 200_000;
