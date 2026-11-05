import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The npm package olimp-run in .package/olimp-run, laid out as the repository but in JavaScript:
// Node strips no types under node_modules. `npm publish .package/olimp-run` publishes it.
const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, ".package", "olimp-run");

function sh(command: string, args: string[], cwd = ROOT): void {
    const done = spawnSync(command, args, { cwd, stdio: "inherit" });
    if (done.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

rmSync(OUT, { recursive: true, force: true });
sh("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json", "--outDir", OUT]);
// Into the package, not web/dist, which a running OLIMP from this checkout serves.
sh("pnpm", ["exec", "vite", "build", "web", "--outDir", join(OUT, "web", "dist"), "--emptyOutDir"]);

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const repository = "https://github.com/medialanpl/olimp";
const manifest = {
    name: "olimp-run",
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    type: "module",
    bin: { "olimp-run": "src/cli.js", olimp: "src/cli.js" },
    engines: pkg.engines,
    dependencies: pkg.dependencies,
    optionalDependencies: pkg.optionalDependencies,
    repository: { type: "git", url: `git+${repository}.git` },
    homepage: `${repository}#readme`,
    bugs: `${repository}/issues`,
    keywords: pkg.keywords,
};
writeFileSync(join(OUT, "package.json"), `${JSON.stringify(manifest, null, 4)}\n`);
for (const file of ["README.md", "LICENSE"]) copyFileSync(join(ROOT, file), join(OUT, file));
chmodSync(join(OUT, "src", "cli.js"), 0o755);
sh("npm", ["pack", "--pack-destination", join(ROOT, ".package")], OUT);
