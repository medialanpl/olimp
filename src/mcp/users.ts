import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EMAIL_MAX, USER_NAME } from "../limits.ts";
import { type Call, id } from "./shared.ts";

export function registerUserTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_whoami",
        {
            description:
                "Show the account of OLIMP_TOKEN with its tokens (ids only). Without accounts " +
                "OLIMP runs on the installation's own logins and this fails.",
        },
        () => call("GET", "/api/me"),
    );
    server.registerTool(
        "olimp_list_users",
        { description: "List the accounts: id, name and role (admin only)." },
        () => call("GET", "/api/users"),
    );
    server.registerTool(
        "olimp_create_user",
        {
            description:
                "Create an account (admin only). With email it signs in to the panel: OLIMP " +
                "e-mails an invitation to set a password (needs a mail server), and no token is " +
                "made. Without email it is an account for scripts and agents, with its first " +
                "token, shown only in this reply. While OLIMP has no accounts this needs no token " +
                "and makes the first one, an admin; from then on every API call needs a token. " +
                "Repositories are shared; each account logs its own agents in with " +
                "`pnpm agent-login`.",
            inputSchema: {
                name: z.string().regex(USER_NAME),
                email: z.string().max(EMAIL_MAX).optional(),
                role: z
                    .enum(["admin", "member"])
                    .optional()
                    .describe("admin also manages accounts; member by default"),
            },
        },
        (args) => call("POST", "/api/users", args),
    );
    server.registerTool(
        "olimp_update_user",
        {
            description:
                "Change an account's name, e-mail or role (admin only). The last admin stays an " +
                "admin.",
            inputSchema: {
                id,
                name: z.string().regex(USER_NAME).optional(),
                email: z.string().max(EMAIL_MAX).optional(),
                role: z.enum(["admin", "member"]).optional(),
            },
        },
        ({ id: user, ...args }) => call("PATCH", `/api/users/${user}`, args),
    );
    server.registerTool(
        "olimp_send_account_link",
        {
            description:
                "E-mail an account a one-time link valid 7 days (admin only): an invitation to set " +
                "a password, or a password reset once it has one.",
            inputSchema: { id },
        },
        ({ id: user }) => call("POST", `/api/users/${user}/link`, {}),
    );
    server.registerTool(
        "olimp_reset_two_factor",
        {
            description:
                "Remove an account's authenticator app and backup codes and sign it out " +
                "everywhere, e.g. after a lost phone (admin only). It then gets its sign-in codes " +
                "by e-mail, or sets the app up again at its next sign-in.",
            inputSchema: { id },
        },
        ({ id: user }) => call("DELETE", `/api/users/${user}/two-factor`),
    );
    server.registerTool(
        "olimp_delete_user",
        {
            description:
                "Delete an account, its tokens and its agent logins (admin only). What it did " +
                "keeps it as author; its queued tasks and automations then fail. The last admin " +
                "cannot be deleted.",
            inputSchema: { id },
        },
        ({ id }) => call("DELETE", `/api/users/${id}`),
    );
    server.registerTool(
        "olimp_list_tokens",
        {
            description: "List the tokens of an account (ids only): admin, or the account itself.",
            inputSchema: { id: id.describe("Account id") },
        },
        ({ id }) => call("GET", `/api/users/${id}/tokens`),
    );
    server.registerTool(
        "olimp_create_token",
        {
            description:
                "Create a new token for an account, shown only in this reply (admin only). " +
                "Treat it as a password.",
            inputSchema: { id: id.describe("Account id") },
        },
        ({ id }) => call("POST", `/api/users/${id}/tokens`),
    );
    server.registerTool(
        "olimp_revoke_token",
        {
            description:
                "Revoke a token at once: admin, or the account it belongs to (e.g. a leaked one).",
            inputSchema: { id: id.describe("Token id") },
        },
        ({ id }) => call("DELETE", `/api/tokens/${id}`),
    );
}
