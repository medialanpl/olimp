// The panel reads the API's own types; nothing here is a copy.

export type { ConfigContent, ConfigListing } from "../../../src/agent-config.ts";

import type { claudeMcpServers } from "../../../src/agent-config.ts";
import type { ConfigView as ProjectConfigView } from "../../../src/api/project-settings.ts";

export interface AgentConfigListing {
    files: ProjectConfigView[];
    mcpServers: ReturnType<typeof claudeMcpServers>;
}
export type { AgentDefaults, AgentName, RepoAgents } from "../../../src/agents.ts";
export type { AutomationView as Automation } from "../../../src/api/automations.ts";
export type { RepoView as Repo } from "../../../src/api/shared.ts";
export type { BusEvent } from "../../../src/bus.ts";
export type {
    BranchCommits,
    BranchFile,
    BranchFiles,
    ChangedFile,
    Changes,
    Commit,
    CommitChanges,
} from "../../../src/changes.ts";
export type { FolderList, GithubOwner } from "../../../src/clones.ts";
export type {
    AgentEvent,
    Child,
    CostGroup,
    CostRow,
    MemoryPage,
    MemorySection,
    Note,
    Reads,
    Role,
    RunState,
    RunStatus,
    RunSummary,
    RunWait,
    Step,
    StepStatus,
    Task,
    TaskStatus,
    Token,
    Usage,
    User,
    Workflow,
    WorkflowRun,
} from "../../../src/db/database.ts";
export type {
    GithubDetail,
    GithubItem,
    MergeMethod,
    MergeView,
} from "../../../src/github.ts";
export type { Integration } from "../../../src/integrations.ts";
export type { MemoryHit } from "../../../src/memory.ts";
export type { ProjectCommand } from "../../../src/project-commands.ts";
export type {
    DetectedUrl,
    TerminalOutput,
    TerminalSession,
} from "../../../src/terminals.ts";

import type { Integration } from "../../../src/integrations.ts";

// As the API lists them: with the references nothing fills.
export type IntegrationView = Integration & { missing: string[] };
export type { ConfigView, GitState, WorktreeView } from "../../../src/api/project-settings.ts";
export type { ModelOption } from "../../../src/models.ts";
export type {
    RepoSettings,
    SecretView,
    Workspace,
    WorktreeScript,
    WorktreeScripts,
} from "../../../src/project.ts";
export type { SettingName, Settings } from "../../../src/settings.ts";
export type { Skill, SkillHit } from "../../../src/skills.ts";
export type { WebhookEvent, WebhookFormat, WebhookView } from "../../../src/webhooks.ts";
export type {
    Category,
    Condition,
    Definition,
    Edge,
    GraphNode,
    Issue,
    NodeOf,
    NodeType,
    Point,
} from "../../../src/workflow-graph.ts";

import type {
    CostGroup,
    CostRow,
    MemoryPage,
    Note,
    SkillSource,
    Task,
    Token,
    Usage,
    User,
} from "../../../src/db/database.ts";
import type { agentsInfo, machine, version } from "../../../src/machine.ts";
import type { mailView } from "../../../src/mail.ts";
import type { memoryGraph, searchMemory } from "../../../src/memory.ts";
import type { settingsView } from "../../../src/settings.ts";

export type { SkillSource };

export type Me = User & { tokens: Token[]; mail: boolean };

export type Machine = Awaited<ReturnType<typeof machine>>;
export type AgentInfo = Awaited<ReturnType<typeof agentsInfo>>[number];
export type AgentLogin = AgentInfo["logins"][number];
export type Version = Awaited<ReturnType<typeof version>>;
export type SettingsView = Awaited<ReturnType<typeof settingsView>>;
export type MailView = Awaited<ReturnType<typeof mailView>>;

// GET /api/costs.
export interface CostReport {
    by: CostGroup;
    days: number;
    since: string;
    total: Usage & { jobs: number; unpriced: number };
    groups: (CostRow & { name?: string | null })[];
}

export type TaskSummary = Omit<Task, "log"> & Partial<Pick<Task, "log">>;

// The memory map: pages without their sections, with how many they have.
export type MemorySummary = Omit<MemoryPage, "sections"> & { sections: number };
export interface MemoryMap {
    repo: string;
    hubs: MemorySummary[];
    pages: MemorySummary[];
    unwoven: number;
}
export type MemorySearch = ReturnType<typeof searchMemory>;
export type MemoryGraph = ReturnType<typeof memoryGraph>;
export interface Unwoven {
    total: number;
    notes: Note[];
}
