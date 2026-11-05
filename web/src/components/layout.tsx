import { Outlet, useMatch, useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useLiveEvents } from "@/lib/events";
import { notifyEnabled } from "@/lib/notify";

// The event stream keeps every list live; a finished job notifies only while the tab is in the
// background.
function useLiveNotifications() {
    const t = useTranslations("web");
    const navigate = useNavigate();
    useLiveEvents((job) => {
        if (!notifyEnabled() || document.visibilityState === "visible") return;
        const note = new Notification(t(`settings.notify.${job.status}`), {
            body: job.title,
            tag: job.id,
        });
        note.onclick = () => {
            window.focus();
            void navigate(`/tasks/${job.id}`);
        };
    });
}

export function AppLayout() {
    // The task page, the new task's chat, the workflow editor, the memory and the skills fill the
    // window.
    const task = useMatch("/tasks/:id");
    const editor = useMatch("/workflows/:id");
    const memory = useMatch("/project/:id/memory/*");
    const skills = useMatch("/project/:id/skills");
    const bleed = Boolean(task || editor || memory || skills);
    useLiveNotifications();
    return (
        <SidebarProvider className="h-svh">
            <AppSidebar />
            <SidebarInset>
                <div className="p-2 pb-0 lg:hidden">
                    <SidebarTrigger />
                </div>
                <div
                    className={
                        bleed
                            ? "flex min-h-0 flex-1 flex-col"
                            : "flex-1 p-4 [--sticky-top:1rem] md:p-6"
                    }
                >
                    <Outlet />
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}
