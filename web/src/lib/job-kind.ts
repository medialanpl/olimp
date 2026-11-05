export type JobKind = "task" | "run";

const notFound = (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error && error.status === 404;

// Tasks and runs share /tasks/:id, so an id the panel has not listed is tried as a task, then as
// a run; when neither exists the task's 404 is the answer.
export async function jobKind(load: (kind: JobKind) => Promise<unknown>): Promise<JobKind> {
    try {
        await load("task");
        return "task";
    } catch (error) {
        if (!notFound(error)) throw error;
        try {
            await load("run");
            return "run";
        } catch (other) {
            throw notFound(other) ? error : other;
        }
    }
}
