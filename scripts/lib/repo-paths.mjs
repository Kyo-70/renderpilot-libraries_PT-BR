import path from "node:path";

const moduleDir = import.meta.dirname;

export const repoRoot = path.resolve(moduleDir, "..", "..");

export const resolveRepoPath = (...segments) => path.join(repoRoot, ...segments);
