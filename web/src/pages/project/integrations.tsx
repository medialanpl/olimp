import { ProjectIntegrations } from "@/components/integrations/project-integrations";
import type { Repo } from "@/lib/types";

export function Integrations({ repo }: { repo: Repo }) {
    return <ProjectIntegrations repo={repo.id} />;
}
