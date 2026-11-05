import type { IncomingMessage } from "node:http";
import { repoDir } from "../clones.ts";
import type { Config } from "../config.ts";
import { HttpError, readJson, text } from "../http.ts";
import { NAME_MAX, REF_MAX, SEARCH_MIN, SKILL_TEXT_MAX } from "../limits.ts";
import {
    deleteOwnSkill,
    listSkills,
    projectSkills,
    refreshSkillSources,
    registerSkillSource,
    removeSkillSource,
    saveOwnSkill,
    searchSkills,
    skillText,
} from "../skills.ts";
import type { Store } from "../store.ts";
import { type Answer, repoRef } from "./shared.ts";

export async function skillsRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    url: URL,
    home: string,
): Promise<Answer | undefined> {
    const path = url.pathname;
    const method = req.method;
    if (path === "/api/skill-sources") {
        if (method === "GET") return [200, await store.skillSources()];
        if (method === "POST") {
            const body = await readJson(req);
            const branch = text(body.branch, "branch", REF_MAX, false);
            return [201, await registerSkillSource(store, cfg, repoRef(body.repo), branch)];
        }
    }
    if (path === "/api/skill-sources/refresh" && method === "POST")
        return [200, await refreshSkillSources(store, cfg)];
    const source = /^\/api\/skill-sources\/([\w.-]+\/[\w.-]+)$/.exec(path);
    if (source && method === "DELETE") {
        const repo = source[1] as string;
        const removed = await removeSkillSource(store, cfg, repo);
        if (!removed) throw new HttpError(404, "skill.sourceNotRegistered", { repo });
        return [200, removed];
    }
    if (path === "/api/skill-search" && method === "GET") {
        const query = (url.searchParams.get("q") ?? "").trim();
        if (query.length < SEARCH_MIN || query.length > NAME_MAX)
            throw new HttpError(400, "skill.invalidQuery", { min: SEARCH_MIN, max: NAME_MAX });
        return [200, await searchSkills(cfg, query)];
    }
    if (path === "/api/skills" && method === "GET") {
        const repo = url.searchParams.get("repo");
        const found = repo ? await store.repo(repo) : null;
        if (repo && !found) throw new HttpError(404, "repo.notRegistered", { repo });
        const own = found ? projectSkills(repoDir(cfg, found)) : [];
        const team = found?.settings.teamSkills ?? true;
        return [200, [...own, ...(await listSkills(store, cfg, home, team))]];
    }
    if (path === "/api/own-skills" && method === "POST") {
        const body = await readJson(req);
        const name = text(body.name, "name", NAME_MAX);
        return [
            201,
            saveOwnSkill(home, name, text(body.content, "content", SKILL_TEXT_MAX), false),
        ];
    }
    const ownSkill = /^\/api\/own-skills\/([^/]+)$/.exec(path);
    if (ownSkill && method === "PUT") {
        const content = text((await readJson(req)).content, "content", SKILL_TEXT_MAX);
        return [200, saveOwnSkill(home, ownSkill[1] as string, content, true)];
    }
    if (ownSkill && method === "DELETE") return [200, deleteOwnSkill(home, ownSkill[1] as string)];
    if (path === "/api/skill" && method === "GET") {
        const ref = url.searchParams.get("ref") ?? "";
        const repo = url.searchParams.get("repo");
        const found = repo ? await store.repo(repo) : null;
        const content = skillText(cfg, ref, found ? repoDir(cfg, found) : null, home);
        if (content === null) throw new HttpError(404, "skill.unknown", { skill: ref });
        return [200, { ref, content }];
    }
    return undefined;
}
