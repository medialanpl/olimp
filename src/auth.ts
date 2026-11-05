import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    randomBytes,
    randomInt,
    scrypt,
    timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

// Corivo's policy (AM.04.01): at least 8 characters from three of four kinds.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
const KINDS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];

export const passwordCompliant = (password: string) =>
    password.length >= PASSWORD_MIN &&
    password.length <= PASSWORD_MAX &&
    KINDS.filter((kind) => kind.test(password)).length >= 3;

// Corivo's session times (AM.04.03) and lockout: 3 failures in 5 minutes.
export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 8 * 60 * 60_000;
export const LINK_MS = 7 * 24 * 60 * 60_000;
export const EMAIL_CODE_MS = 10 * 60_000;
export const CODE_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 5 * 60_000;
const LOCK_FAILURES = 3;

export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const newSecret = () => randomBytes(32).toString("base64url");

const scryptAsync = promisify(scrypt) as (
    password: string,
    salt: Buffer,
    length: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt, 64);
    return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

// A missing account is checked against a throwaway hash, so the answer takes as long.
let throwaway: Promise<string> | null = null;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
    throwaway ??= hashPassword(newSecret());
    const [kind, salt, hash] = (stored ?? (await throwaway)).split("$");
    if (kind !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash, "base64url");
    const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length);
    return timingSafeEqual(actual, expected) && stored !== null;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(bytes: Buffer): string {
    let bits = "";
    for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
    let out = "";
    for (let i = 0; i < bits.length; i += 5)
        out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
    return out;
}

function fromBase32(text: string): Buffer {
    let bits = "";
    for (const char of text.replace(/=+$/, "").toUpperCase()) {
        const value = B32.indexOf(char);
        if (value < 0) throw new Error("not base32");
        bits += value.toString(2).padStart(5, "0");
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
}

export const newTotpSecret = () => base32(randomBytes(20));

// RFC 6238 with the defaults every authenticator app uses: SHA-1, 6 digits, 30 seconds.
export function totp(secret: string, step: number): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const mac = createHmac("sha1", fromBase32(secret)).update(counter).digest();
    const offset = (mac[mac.length - 1] as number) & 0xf;
    return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const usedSteps = new Map<string, number>();

// The code of this 30 seconds or a neighbouring one, each step once per account: a code seen
// over someone's shoulder cannot be used again.
export function checkTotp(user: string, secret: string, code: string, now = Date.now()): boolean {
    const step = Math.floor(now / 30_000);
    for (const candidate of [step - 1, step, step + 1]) {
        if (candidate <= (usedSteps.get(user) ?? -1)) continue;
        if (safeEqual(totp(secret, candidate), code)) {
            usedSteps.set(user, candidate);
            return true;
        }
    }
    return false;
}

export const totpUri = (secret: string, email: string) =>
    `otpauth://totp/OLIMP:${encodeURIComponent(email)}?secret=${secret}&issuer=OLIMP&algorithm=SHA1&digits=6&period=30`;

export const safeEqual = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Ten single-use codes for a lost phone, in the form xxxxx-xxxxx; only their hashes are kept.
export function newBackupCodes(): string[] {
    return Array.from({ length: 10 }, () => {
        const code = base32(randomBytes(7)).slice(0, 10).toLowerCase();
        return `${code.slice(0, 5)}-${code.slice(5)}`;
    });
}

export const hashBackupCode = (code: string) =>
    sha256(code.trim().toLowerCase().replace(/\s/g, ""));

export const newEmailCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

// The TOTP secret is kept in the database encrypted with a key that never leaves OLIMP_HOME.
function key(home: string): Buffer {
    const file = join(home, "auth.key");
    if (!existsSync(file)) {
        mkdirSync(home, { recursive: true });
        writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
    }
    return readFileSync(file);
}

export function seal(home: string, text: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(home), iv);
    const sealed = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), sealed]
        .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
        .join(".");
}

export function unseal(home: string, sealed: string): string {
    const [version, iv, tag, data] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || !data) throw new Error("unknown sealed format");
    const decipher = createDecipheriv("aes-256-gcm", key(home), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
        decipher.update(Buffer.from(data, "base64url")),
        decipher.final(),
    ]).toString("utf8");
}

// In memory, per process, as in Corivo: a restart forgets the failures.
const failures = new Map<string, number[]>();

const recent = (key: string, now: number) =>
    (failures.get(key) ?? []).filter((at) => at > now - LOCK_WINDOW_MS);

// Seconds until the key may try again; 0 when it is not locked.
export function lockedFor(key: string, now = Date.now()): number {
    const hits = recent(key, now);
    if (hits.length < LOCK_FAILURES) return 0;
    const releases = (hits[hits.length - LOCK_FAILURES] as number) + LOCK_WINDOW_MS;
    return Math.max(1, Math.ceil((releases - now) / 1000));
}

export function recordFailure(key: string, now = Date.now()): void {
    if (failures.size > 10_000)
        for (const [k] of failures) if (!recent(k, now).length) failures.delete(k);
    failures.set(key, [...recent(key, now), now]);
}

export const clearFailures = (key: string) => failures.delete(key);
