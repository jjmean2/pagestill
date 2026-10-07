#!/usr/bin/env node
// Cut a release in one command:
//
//   pnpm release patch | minor | major | 1.2.3 | prerelease [--preid rc] [--dry-run]
//
// 1. refuse to release from a bad state (branch, dirty tree, behind origin, tag already taken)
// 2. typecheck + tests
// 3. `pnpm version` bumps package.json, commits "chore: release x.y.z", creates annotated tag vX.Y.Z
// 4. push the commit and the tag together; the tag triggers .github/workflows/release.yml,
//    which this script then follows with `gh` and reports.
//
// --dry-run stops after step 1 and prints what would happen.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BRANCH = process.env.RELEASE_BRANCH ?? "main";
const REMOTE = "origin";
const USAGE = "usage: pnpm release <patch|minor|major|premajor|preminor|prepatch|prerelease|x.y.z> [--preid <id>] [--dry-run]";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const step = (msg) => console.error(`\x1b[36m›\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed`);
};

// ---- arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const preidAt = args.indexOf("--preid");
const preid = preidAt >= 0 ? args[preidAt + 1] : undefined;
const bump = args.find((a, i) => !a.startsWith("--") && (preidAt < 0 || i !== preidAt + 1));
if (!bump) fail(USAGE);
const versionArgs = [bump, ...(preid ? ["--preid", preid] : [])];

// ---- 1. preflight
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== BRANCH) fail(`Releases are cut from ${BRANCH}, but you are on ${branch}.`);
if (git("status", "--porcelain")) fail("Working tree is not clean. Commit or stash first.");

step(`Fetching ${REMOTE}`);
run("git", ["fetch", "--quiet", REMOTE, BRANCH]);
const behind = Number(git("rev-list", "--count", `HEAD..${REMOTE}/${BRANCH}`));
if (behind > 0) fail(`${BRANCH} is ${behind} commit(s) behind ${REMOTE}/${BRANCH}. Pull first.`);
const ahead = Number(git("rev-list", "--count", `${REMOTE}/${BRANCH}..HEAD`));

const plan = spawnSync("pnpm", ["version", ...versionArgs, "--dry-run", "--json"], { encoding: "utf8" });
if (plan.status !== 0) fail(`${plan.stderr.trim() || plan.stdout.trim()}\n${USAGE}`);
const [{ name, currentVersion, newVersion }] = JSON.parse(plan.stdout);
const tag = `v${newVersion}`;
if (git("tag", "--list", tag)) fail(`Tag ${tag} already exists locally.`);
if (git("ls-remote", "--tags", REMOTE, `refs/tags/${tag}`)) fail(`Tag ${tag} already exists on ${REMOTE}.`);

const prerelease = newVersion.includes("-");
console.error(
  `\n  ${name} ${currentVersion} → \x1b[1m${newVersion}\x1b[0m  (tag ${tag}${prerelease ? ", prerelease" : ""})\n` +
    `  push: ${ahead ? `${ahead} unpushed commit(s) + ` : ""}the release commit + ${tag} → ${REMOTE}/${BRANCH}\n`,
);
if (dryRun) {
  console.error("Dry run: nothing was changed.");
  process.exit(0);
}

// ---- 2. checks
step("Typecheck");
run("pnpm", ["typecheck"]);
step("Tests (headless Chrome)");
run("pnpm", ["test"], { PAGESTILL_CHROME_ARGS: process.env.PAGESTILL_CHROME_ARGS ?? "--headless=new" });

// ---- 3. bump, commit, tag
step(`Bumping to ${newVersion}`);
run("pnpm", ["version", ...versionArgs, "-m", "chore: release %s"]);
if (git("tag", "--list", tag) !== tag) fail(`pnpm version did not create ${tag}.`);

// ---- 4. push and follow the workflow
step(`Pushing ${BRANCH} and ${tag}`);
// --atomic: either the release commit and the tag both land, or neither does.
run("git", ["push", "--atomic", REMOTE, `HEAD:refs/heads/${BRANCH}`, `refs/tags/${tag}`]);

const repo = git("remote", "get-url", REMOTE)
  .replace(/^git@github\.com:|^https:\/\/github\.com\//, "")
  .replace(/\.git$/, "");
const isGitHub = /^[\w.-]+\/[\w.-]+$/.test(repo);
const releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`;
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tarball = `https://github.com/${repo}/releases/download/${tag}/${name}-${version}.tgz`;

if (!isGitHub || !has("gh") || process.env.RELEASE_NO_WATCH) {
  console.error(`\nPushed ${tag}.${isGitHub ? ` The Release workflow will publish ${releaseUrl}` : ""}`);
  process.exit(0);
}

step("Following the Release workflow");
const sha = git("rev-parse", "HEAD");
let runId = "";
for (let i = 0; i < 30 && !runId; i++) {
  spawnSync("sleep", ["2"]);
  runId = spawnSync(
    "gh",
    ["run", "list", "--workflow", "release.yml", "--commit", sha, "--event", "push", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId // empty"],
    { encoding: "utf8" },
  ).stdout.trim();
}
if (!runId) fail(`Couldn't find the workflow run for ${tag}; check https://github.com/${repo}/actions`);
const watched = spawnSync("gh", ["run", "watch", runId, "--exit-status", "--interval", "10"], { stdio: "inherit" });
if (watched.status !== 0) {
  fail(
    `The Release workflow failed: https://github.com/${repo}/actions/runs/${runId}\n` +
      `  ${tag} is pushed but no release was published. Once fixed and pushed, move the tag and retry:\n` +
      `  git tag -d ${tag} && git push ${REMOTE} :refs/tags/${tag} && git tag -a ${tag} -m ${newVersion} && git push ${REMOTE} ${tag}`,
  );
}
console.error(`\n\x1b[32m✓ Released ${tag}\x1b[0m  ${releaseUrl}\n  Install: pnpm add -g ${tarball}`);
