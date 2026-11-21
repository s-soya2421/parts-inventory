import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const IGNORED = /^(?:docs\/|tests\/|e2e\/|\.github\/ISSUE_TEMPLATE\/)|(?:^|\/)README(?:\.md)?$|\.(?:md|mdx)$/i;
const UI_ONLY = /^(?:src\/web\/|public\/)/;

export function classifyReleasePaths(paths) {
  const meaningful = paths.filter((path) => path && !IGNORED.test(path));
  if (meaningful.length === 0) return "skip";
  // Fail closed: Worker, DB, package/lockfile, workflows and configuration changes
  // are never auto-deployed by this policy.
  return meaningful.every((path) => UI_ONLY.test(path)) ? "auto" : "review";
}

export function classifyReleaseDiff(before, after) {
  if (!/^[a-f0-9]{40}$/i.test(before) || /^0{40}$/.test(before) ||
      !/^[a-f0-9]{40}$/i.test(after)) {
    return "review";
  }
  try {
    const output = execFileSync("git", ["diff", "--name-only", before, after], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return classifyReleasePaths(output.trim().split("\n"));
  } catch {
    // Missing checkout history or any Git error must block production changes.
    return "review";
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = classifyReleaseDiff(process.argv[2] ?? "", process.argv[3] ?? "");
  process.stdout.write("mode=" + mode + "\n");
}
