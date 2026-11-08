import {
    ActivityIcon,
    AppWindowIcon,
    FileDiffIcon,
    MessageSquareIcon,
    NotebookPenIcon,
    PencilIcon,
    SquareTerminalIcon,
    WorkflowIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { ChangesView } from "@/components/changes-view";
import {
    BranchChip,
    JobActions,
    JobHeader,
    JobPage,
    JobPageError,
    JobTab,
    MetaLink,
    PrChip,
    useJobTab,
    useTerminalShortcut,
} from "@/components/job-page";
import { NotesView } from "@/components/notes-view";
import { RunGraph } from "@/components/run/graph";
import { ResumeCard, RunChat } from "@/components/run/run-chat";
import { StepList } from "@/components/run/steps";
import { WaitCard } from "@/components/run/wait-card";
import { JobPageSkeleton, TerminalSkeleton } from "@/components/skeletons";
import { TraceView } from "@/components/trace-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TabsContent } from "@/components/ui/tabs";
import { shortId, useFormat } from "@/lib/format";
import { newTaskWith } from "@/lib/nav";
import { useChanges, useReadOnOpen, useRun } from "@/lib/queries";

const TABS = ["chat", "flow", "changes", "trace", "notes", "terminal", "preview"] as const;

const TerminalPanel = lazy(() => import("@/components/terminal-panel"));
const PreviewPanel = lazy(() => import("@/components/preview-panel"));

export function RunView({ id }: { id: string }) {
    const t = useTranslations("web");
    const format = useFormat();
    const query = useRun(id);
    const [keepUnread, setKeepUnread] = useState(false);
    useReadOnOpen("run", id, query.data?.status, keepUnread);
    const changes = useChanges("run", id, !!query.data);
    const [tab, setTab] = useJobTab(TABS);
    useTerminalShortcut(tab, setTab);
    const navigate = useNavigate();

    if (query.isPending) return <JobPageSkeleton />;
    if (query.isError) return <JobPageError error={query.error} onRetry={() => query.refetch()} />;
    const run = query.data;
    const wait = run.status === "waiting" ? run.state?.wait : null;

    return (
        <JobPage
            tab={tab}
            onTab={setTab}
            header={
                <JobHeader
                    title={run.name}
                    status={run.status}
                    usage={run}
                    meta={
                        <>
                            <MetaLink chip to={`/workflows/${run.workflow}`}>
                                <WorkflowIcon className="size-3" />
                                {run.name}
                            </MetaLink>
                            {run.branch && <BranchChip branch={run.branch} />}
                            <MetaLink to={`/project/${run.repo}`}>{run.repo}</MetaLink>
                            {run.prUrl && <PrChip url={run.prUrl} />}
                            {run.retryOf && (
                                <MetaLink to={`/tasks/${run.retryOf}`}>
                                    {t("task.retryOf", { id: shortId(run.retryOf) })}
                                </MetaLink>
                            )}
                            {run.parentRun && (
                                <MetaLink chip to={`/tasks/${run.parentRun}`}>
                                    {t("runs.partOf", { id: shortId(run.parentRun) })}
                                </MetaLink>
                            )}
                            <span title={format.dateTime(run.createdAt)}>
                                {t("runs.started", { when: format.relative(run.createdAt) })}
                            </span>
                            <span title={format.dateTime(run.updatedAt)}>
                                {t("runs.updated", { when: format.relative(run.updatedAt) })}
                            </span>
                        </>
                    }
                    actions={
                        <JobActions
                            kind="run"
                            job={run}
                            onUnread={() => setKeepUnread(true)}
                            menu={
                                <DropdownMenuItem asChild>
                                    <Link to={`/workflows/${run.workflow}`}>
                                        <PencilIcon />
                                        {t("runs.openWorkflow")}
                                    </Link>
                                </DropdownMenuItem>
                            }
                        />
                    }
                />
            }
            tabs={
                <>
                    <JobTab value="chat">
                        <MessageSquareIcon />
                        {t("task.conversation")}
                    </JobTab>
                    <JobTab value="flow">
                        <WorkflowIcon />
                        {t("runs.flow")}
                    </JobTab>
                    <JobTab value="changes" count={changes.data?.files.length}>
                        <FileDiffIcon />
                        {t("task.changes")}
                    </JobTab>
                    <JobTab value="trace">
                        <ActivityIcon />
                        {t("task.trace")}
                    </JobTab>
                    <JobTab value="notes">
                        <NotebookPenIcon />
                        {t("task.notes")}
                    </JobTab>
                    <JobTab value="terminal">
                        <SquareTerminalIcon />
                        {t("terminal.title")}
                    </JobTab>
                    <JobTab value="preview">
                        <AppWindowIcon />
                        {t("preview.title")}
                    </JobTab>
                </>
            }
        >
            <TabsContent value="chat">
                <RunChat run={run} />
            </TabsContent>
            <TabsContent value="flow" className="space-y-6">
                {wait && <WaitCard run={run} wait={wait} />}
                {run.error && (
                    <Alert variant="destructive">
                        <AlertTitle>{t("task.error")}</AlertTitle>
                        <AlertDescription>
                            <p className="whitespace-pre-wrap break-words font-mono text-xs">
                                {run.error}
                            </p>
                        </AlertDescription>
                    </Alert>
                )}
                <ResumeCard run={run} />
                {run.input && (
                    <section className="rounded-xl border bg-card p-4">
                        <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                            {t("runs.input")}
                        </h2>
                        <p className="whitespace-pre-wrap break-words text-sm">{run.input}</p>
                    </section>
                )}
                <RunGraph run={run} />
                <StepList run={run} />
            </TabsContent>
            <TabsContent value="changes">
                <ChangesView kind="run" id={run.id} prUrl={run.prUrl} />
            </TabsContent>
            <TabsContent value="trace">
                <TraceView kind="run" id={run.id} />
            </TabsContent>
            <TabsContent value="notes">
                <NotesView repo={run.repo} match={(note) => note.run === run.id} />
            </TabsContent>
            <TabsContent value="terminal">
                <Suspense fallback={<TerminalSkeleton />}>
                    <TerminalPanel owner={`/api/workflow-runs/${run.id}`} repo={run.repo} />
                </Suspense>
            </TabsContent>
            <TabsContent value="preview">
                <Suspense fallback={<TerminalSkeleton />}>
                    <PreviewPanel
                        owner={`/api/workflow-runs/${run.id}`}
                        sendLabel={t("preview.toNewTask")}
                        onSend={(text) => navigate(newTaskWith(run.repo, text))}
                    />
                </Suspense>
            </TabsContent>
        </JobPage>
    );
}
