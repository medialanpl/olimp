// Corivo's rule (src/auth.ts on the API), repeated here only to say it before the API does.
export const passwordCompliant = (p: string) =>
    p.length >= 8 &&
    [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(p)).length >= 3;

export const passwordReady = (value: string, again: string) =>
    passwordCompliant(value) && value === again;

// Corivo's strength meter: points for length and for each kind of character, out of 100.
export function passwordStrength(p: string): {
    score: number;
    label: "weak" | "medium" | "strong";
} {
    const score =
        (p.length >= 8 ? 20 : 0) +
        (p.length >= 12 ? 10 : 0) +
        (/[A-Z]/.test(p) ? 20 : 0) +
        (/[a-z]/.test(p) ? 20 : 0) +
        (/\d/.test(p) ? 15 : 0) +
        (/[^a-zA-Z0-9]/.test(p) ? 15 : 0);
    return { score, label: score >= 80 ? "strong" : score >= 50 ? "medium" : "weak" };
}
