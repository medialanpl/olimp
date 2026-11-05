import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useTranslations } from "use-intl";
import { AppLayout } from "@/components/layout";
import { OlimpLoader } from "@/components/logo";
import { ErrorState } from "@/components/page";
import { CompareSkeleton, JobPageSkeleton } from "@/components/skeletons";
import { useAuth } from "@/lib/auth";
import { AutomationPage } from "@/pages/automation";
import { AutomationsPage } from "@/pages/automations";
import { CostsPage } from "@/pages/costs";
import { DashboardPage } from "@/pages/dashboard";
import { GitPage } from "@/pages/git";
import { LoginPage } from "@/pages/login";
import { ProjectMemoryPage } from "@/pages/memory";
import { NewTaskPage } from "@/pages/new-task";
import { NotFoundPage } from "@/pages/not-found";
import { ForgotPasswordPage, SetPasswordPage } from "@/pages/password";
import { RepoSettingsPage } from "@/pages/repo";
import { SettingsPage } from "@/pages/settings";
import { ProjectSkillsPage } from "@/pages/skills";
import { TasksPage } from "@/pages/tasks";
import { WorkflowPage } from "@/pages/workflow";
import { WorkflowsPage } from "@/pages/workflows";

// Its own chunk: the Markdown renderer it needs would double the panel's first load.
const TaskPage = lazy(() => import("@/pages/task").then((m) => ({ default: m.TaskPage })));
const ComparePage = lazy(() => import("@/pages/compare").then((m) => ({ default: m.ComparePage })));

export function App() {
    const t = useTranslations("web");
    const { session, retry } = useAuth();
    // Until the session is known, the sign-in or the panel may follow: the mark, not a skeleton.
    if (session.status === "loading")
        return (
            <div role="status" className="flex min-h-dvh items-center justify-center">
                <OlimpLoader label={t("common.loading")} />
            </div>
        );
    if (session.status === "error")
        return (
            <main className="mx-auto max-w-lg px-4 py-16">
                <ErrorState error={session.message} onRetry={retry} />
            </main>
        );
    // Signed out: the sign-in, and the pages links in e-mails open.
    if (session.status === "signedOut")
        return (
            <BrowserRouter>
                <Routes>
                    <Route path="forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="reset-password" element={<SetPasswordPage />} />
                    <Route path="accept-invitation" element={<SetPasswordPage />} />
                    <Route path="*" element={<LoginPage reason={session.reason} />} />
                </Routes>
            </BrowserRouter>
        );
    return (
        <BrowserRouter>
            <Routes>
                {/* A link from an e-mail works in a browser where someone is signed in, too. */}
                <Route path="reset-password" element={<SetPasswordPage />} />
                <Route path="accept-invitation" element={<SetPasswordPage />} />
                <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="tasks" element={<TasksPage />} />
                    <Route path="tasks/new" element={<NewTaskPage />} />
                    <Route
                        path="tasks/compare/:group"
                        element={
                            <Suspense fallback={<CompareSkeleton />}>
                                <ComparePage />
                            </Suspense>
                        }
                    />
                    <Route
                        path="tasks/:id"
                        element={
                            <Suspense fallback={<JobPageSkeleton />}>
                                <TaskPage />
                            </Suspense>
                        }
                    />
                    <Route path="workflows" element={<WorkflowsPage />} />
                    <Route path="workflows/:id" element={<WorkflowPage />} />
                    <Route
                        path="repos"
                        element={<Navigate to="/settings/general/projects" replace />}
                    />
                    <Route path="project/:id" element={<TasksPage />} />
                    <Route path="project/:id/git" element={<GitPage />} />
                    <Route path="project/:id/automations" element={<AutomationsPage />} />
                    <Route
                        path="project/:id/automations/:automation"
                        element={<AutomationPage />}
                    />
                    <Route path="project/:id/memory/:slug?" element={<ProjectMemoryPage />} />
                    <Route path="project/:id/skills" element={<ProjectSkillsPage />} />
                    <Route path="project/:id/settings/:section" element={<RepoSettingsPage />} />
                    <Route path="settings/general/:section" element={<SettingsPage />} />
                    <Route path="costs" element={<CostsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
