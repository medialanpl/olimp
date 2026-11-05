import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { base32, passwordCompliant, totp } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { fakeSmtp, openStore } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-auth-"));
const smtp = await fakeSmtp();
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    smtp.close();
    rmSync(root, { recursive: true, force: true });
});

const PASSWORD = "Correct-horse-1";

interface Answer {
    status: number;
    json: Record<string, unknown>;
    cookie: string | null;
}

async function setup(mail = false) {
    const home = mkdtempSync(join(root, "home-"));
    const store = await openStore(home);
    const cfg = {
        ...loadConfig({ OLIMP_HOME: home }),
        ...(mail && { smtpUrl: smtp.url, mailFrom: "olimp@example.com" }),
    };
    const server = createApi(store, cfg);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    // A browser: it keeps the session cookie the API sets and sends it back.
    let jar: string | null = null;
    const call = (method: string, path: string, body?: object, headers: object = {}) =>
        new Promise<Answer>((resolve, reject) => {
            const req = request(
                {
                    host: "127.0.0.1",
                    port,
                    method,
                    path,
                    headers: {
                        host: `127.0.0.1:${port}`,
                        "content-type": "application/json",
                        ...(jar && { cookie: jar.split(";")[0] }),
                        ...headers,
                    },
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => {
                        data += chunk;
                    });
                    res.on("end", () => {
                        const set = res.headers["set-cookie"]?.[0] ?? null;
                        if (set) jar = /Max-Age=0/.test(set) ? null : set;
                        resolve({
                            status: res.statusCode ?? 0,
                            json: JSON.parse(data || "null"),
                            cookie: set,
                        });
                    });
                },
            );
            req.on("error", reject);
            req.end(body ? JSON.stringify(body) : undefined);
        });
    return { home, store, cfg, call, forget: () => (jar = null) };
}

const now = () => Math.floor(Date.now() / 30_000);

test("TOTP matches RFC 6238 and passwords follow Corivo's policy", () => {
    // RFC 6238 appendix B, SHA-1, T = 59 s: 94287082, of which an app shows the last six digits.
    assert.equal(totp(base32(Buffer.from("12345678901234567890")), 1), "287082");
    assert.equal(passwordCompliant("Correct-horse-1"), true);
    assert.equal(passwordCompliant("short1A"), false);
    assert.equal(passwordCompliant("alllowercase"), false);
    assert.equal(passwordCompliant("lower-and-digits-1"), true);
});

test("the first admin signs in with a password and must set up the app without e-mail", async () => {
    const { call, home, forget } = await setup();
    const weak = await call("POST", "/api/users", {
        name: "ada",
        email: "ada@example.com",
        password: "weak",
    });
    assert.equal(weak.json.code, "auth.weakPassword");
    const first = await call("POST", "/api/users", {
        name: "ada",
        email: "Ada@Example.com",
        password: PASSWORD,
    });
    assert.equal(first.status, 201);
    assert.equal(first.json.email, "ada@example.com");
    assert.equal(first.json.token, undefined);
    // Accounts exist: nothing without a sign-in.
    assert.equal((await call("GET", "/api/me")).status, 401);
    const login = await call("POST", "/api/auth/login", {
        email: "ada@example.com",
        password: PASSWORD,
    });
    assert.equal(login.status, 200);
    assert.deepEqual(login.json, { method: "setup" });
    assert.match(login.cookie ?? "", /HttpOnly; SameSite=Strict; Max-Age=28800$/);
    // Half signed in: the panel stays closed until the second factor.
    assert.equal((await call("GET", "/api/me")).status, 401);
    const setup1 = await call("POST", "/api/auth/two-factor/setup");
    const secret = setup1.json.secret as string;
    assert.match(setup1.json.uri as string, /^otpauth:\/\/totp\/OLIMP:ada%40example\.com\?secret=/);
    const wrong = await call("POST", "/api/auth/two-factor/enable", { secret, code: "000000" });
    assert.equal(wrong.json.code, "auth.invalidCode");
    const enabled = await call("POST", "/api/auth/two-factor/enable", {
        secret,
        code: totp(secret, now()),
    });
    assert.equal(enabled.status, 200);
    const backupCodes = enabled.json.backupCodes as string[];
    assert.equal(backupCodes.length, 10);
    const me = await call("GET", "/api/me");
    assert.equal(me.json.totp, true);
    assert.equal(me.json.mail, false);
    // The secret is stored sealed, with its key only in OLIMP_HOME.
    assert.equal(statSync(join(home, "auth.key")).mode & 0o777, 0o600);
    assert.equal((await call("POST", "/api/auth/logout")).status, 200);
    assert.equal((await call("GET", "/api/me")).status, 401);

    // Next time the app's code, or a backup code, each once.
    forget();
    assert.deepEqual(
        (await call("POST", "/api/auth/login", { email: "ada@example.com", password: PASSWORD }))
            .json,
        { method: "app" },
    );
    assert.equal((await call("POST", "/api/auth/two-factor", { code: "123456" })).status, 401);
    assert.equal(
        (await call("POST", "/api/auth/two-factor", { code: backupCodes[0] })).status,
        200,
    );
    assert.equal((await call("GET", "/api/me")).status, 200);
    await call("POST", "/api/auth/logout");
    await call("POST", "/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    assert.equal(
        (await call("POST", "/api/auth/two-factor", { code: backupCodes[0] })).status,
        401,
    );
});

test("an idle or unfinished session signs nobody in, and a foreign page cannot use the cookie", async () => {
    const { call, store } = await setup();
    await call("POST", "/api/users", { name: "cy", email: "cy@example.com", password: PASSWORD });
    await call("POST", "/api/auth/login", { email: "cy@example.com", password: PASSWORD });
    const { secret } = (await call("POST", "/api/auth/two-factor/setup")).json as {
        secret: string;
    };
    await call("POST", "/api/auth/two-factor/enable", { secret, code: totp(secret, now()) });
    assert.equal((await call("GET", "/api/me")).status, 200);
    const foreign = await call("GET", "/api/me", undefined, { origin: "https://evil.example" });
    assert.equal(foreign.status, 403);
    const user = (await store.users())[0]?.id as string;
    const [session] = await store.sessions(user);
    await store.updateSession(session?.id as string, {
        seenAt: new Date(Date.now() - 31 * 60_000).toISOString(),
    });
    assert.equal((await call("GET", "/api/me")).status, 401);
});

test("an invited member sets a password from the e-mail and signs in with a code by e-mail", async () => {
    const { call, forget } = await setup(true);
    await call("POST", "/api/users", { name: "ann", email: "ann@example.com", password: PASSWORD });
    await call("POST", "/api/auth/login", { email: "ann@example.com", password: PASSWORD });
    const code = () => (/\b(\d{6})\b/.exec(smtp.messages.at(-1) ?? "") ?? [])[1] as string;
    assert.equal((await call("POST", "/api/auth/two-factor", { code: code() })).status, 200);

    const invited = await call("POST", "/api/users", { name: "ben", email: "ben@example.com" });
    assert.equal(invited.status, 201);
    assert.equal(invited.json.sent, "invite");
    assert.equal(invited.json.token, undefined);
    const token = /accept-invitation\?token=([\w-]+)/.exec(
        smtp.messages.at(-1) ?? "",
    )?.[1] as string;
    assert.ok(token);
    await call("POST", "/api/auth/logout");
    forget();
    assert.equal((await call("POST", "/api/auth/link", { token })).json.email, "ben@example.com");
    assert.equal(
        (await call("POST", "/api/auth/password", { token, password: PASSWORD })).status,
        200,
    );
    // The link works once.
    assert.equal(
        (await call("POST", "/api/auth/password", { token, password: PASSWORD })).json.code,
        "auth.invalidLink",
    );
    const login = await call("POST", "/api/auth/login", {
        email: "ben@example.com",
        password: PASSWORD,
    });
    assert.deepEqual(login.json, { method: "email" });
    assert.match(smtp.messages.at(-1) ?? "", /To: ben@example\.com/);
    assert.equal((await call("POST", "/api/auth/two-factor", { code: code() })).status, 200);
    const me = (await call("GET", "/api/me")).json;
    assert.equal(me.role, "member");
    assert.equal(me.mail, true);
    // A member manages only themselves.
    assert.equal((await call("GET", "/api/users")).json.code, "auth.adminOnly");
    const sessions = (await call("GET", "/api/me/sessions")).json as unknown as {
        current: boolean;
    }[];
    assert.deepEqual(
        sessions.map((s) => s.current),
        [true],
    );

    // A forgotten password: the same answer for any address, a reset link for an account.
    await call("POST", "/api/auth/logout");
    const sent = smtp.messages.length;
    assert.equal(
        (await call("POST", "/api/auth/forgot", { email: "nobody@example.com" })).status,
        200,
    );
    assert.equal(smtp.messages.length, sent);
    assert.equal(
        (await call("POST", "/api/auth/forgot", { email: "ben@example.com" })).status,
        200,
    );
    assert.match(smtp.messages.at(-1) ?? "", /reset-password\?token=/);
});

test("an admin changes roles, keeps the last admin and resets a lost second factor", async () => {
    const { call, store } = await setup();
    // The first account without a password gets a token, as one for scripts does.
    const admin = await call("POST", "/api/users", { name: "eve", email: "eve@example.com" });
    const token = (admin.json.token as { token: string }).token;
    const auth = { authorization: `Bearer ${token}` };
    const lastAdmin = await call("PATCH", `/api/users/${admin.json.id}`, { role: "member" }, auth);
    assert.equal(lastAdmin.json.code, "account.lastAdmin");
    // Without e-mail an invitation cannot be sent; an account for scripts gets a token instead.
    const mailLess = await call(
        "POST",
        "/api/users",
        { name: "fay", email: "fay@example.com" },
        auth,
    );
    assert.equal(mailLess.json.code, "mail.notConfigured");
    const bot = await call("POST", "/api/users", { name: "bot" }, auth);
    assert.ok((bot.json.token as { token: string }).token);
    const renamed = await call(
        "PATCH",
        `/api/users/${bot.json.id}`,
        { name: "robot", role: "admin" },
        auth,
    );
    assert.equal(renamed.json.name, "robot");
    await store.updateUser(admin.json.id as string, { totpSecret: "x", backupCodes: ["y"] });
    const reset = await call("DELETE", `/api/users/${admin.json.id}/two-factor`, undefined, auth);
    assert.equal(reset.json.totp, false);
});

// Last: the lockout is per process and also locks 127.0.0.1, which every test here comes from.
test("three wrong passwords lock the e-mail for five minutes, with one message for any failure", async () => {
    const { call } = await setup();
    await call("POST", "/api/users", { name: "bo", email: "bo@example.com", password: PASSWORD });
    const nobody = await call("POST", "/api/auth/login", {
        email: "nobody@example.com",
        password: PASSWORD,
    });
    const wrong = await call("POST", "/api/auth/login", {
        email: "bo@example.com",
        password: "Wrong-pass-1",
    });
    assert.equal(nobody.json.code, "auth.invalidLogin");
    assert.equal(wrong.json.code, "auth.invalidLogin");
    await call("POST", "/api/auth/login", { email: "bo@example.com", password: "Wrong-pass-2" });
    const locked = await call("POST", "/api/auth/login", {
        email: "bo@example.com",
        password: PASSWORD,
    });
    assert.equal(locked.status, 429);
    assert.equal(locked.json.code, "auth.locked");
});

test("the mail server saved in the panel replaces the environment's and keeps its password sealed", async () => {
    const { call, store } = await setup();
    assert.equal((await call("GET", "/api/mail")).json.server, null);
    const port = Number(new URL(smtp.url).port);
    const server = { host: "127.0.0.1", port, secure: false, from: "OLIMP <olimp@example.com>" };
    assert.equal(
        (await call("PUT", "/api/mail", { ...server, port: 0 })).json.code,
        "mail.invalidPort",
    );
    assert.equal(
        (await call("PUT", "/api/mail", { ...server, from: "nobody" })).json.code,
        "mail.invalidFrom",
    );

    const saved = await call("PUT", "/api/mail", {
        ...server,
        user: "olimp",
        password: "s3cret:@/",
    });
    assert.equal(saved.json.ready, true);
    assert.deepEqual(saved.json.server, { ...server, user: "olimp", password: true });
    const row = (await store.settings()).mail as string;
    assert.ok(!row.includes("s3cret"));
    // Without a password the saved one stays; an empty one signs in without it.
    await call("PUT", "/api/mail", { ...server, user: "olimp" });
    assert.equal(
        ((await call("GET", "/api/mail")).json.server as { password: boolean }).password,
        true,
    );
    await call("PUT", "/api/mail", { ...server, user: "", password: "" });
    assert.equal(
        ((await call("GET", "/api/mail")).json.server as { password: boolean }).password,
        false,
    );

    const sent = await call("POST", "/api/mail/test", { to: "ann@example.com" });
    assert.equal(sent.status, 200);
    assert.match(smtp.messages.at(-1) ?? "", /To: ann@example.com/);

    const reset = await call("DELETE", "/api/mail");
    assert.deepEqual(reset.json, { saved: false, ready: false, server: null });
    assert.equal((await call("POST", "/api/mail/test", { to: "ann@example.com" })).status, 409);
});
