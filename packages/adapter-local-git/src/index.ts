import fs from "node:fs";
import path from "node:path";

export interface LocalGitAdapterConfig {
  repoRoot: string;
}

export const localGitAdapterCapability = {
  listFiles: true,
  createBranch: true,
  createCommit: true
};

export function listRepositoryFiles(config: LocalGitAdapterConfig): string[] {
  const root = path.resolve(config.repoRoot);
  const files: string[] = [];
  walk(root, root, files);
  return files.sort();
}

function walk(root: string, current: string, files: string[]): void {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || entry.name === "data") continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, absolute, files);
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolute).replace(/\\/g, "/"));
    }
  }
}
