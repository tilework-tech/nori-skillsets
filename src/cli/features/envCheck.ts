/**
 * Required-environment-variable check.
 *
 * Skillsets that bundle MCP servers (or any other env-dependent feature)
 * may declare a `requiredEnv` array in nori.json. At install time the
 * CLI surfaces missing vars so the user can export them before launching
 * the target agent.
 *
 * Entries can be plain strings or objects with `name`/`description`/`url`.
 */

import type { Skillset } from "@/norijson/skillset.js";

export type RequiredEnvEntry =
  | string
  | { name: string; description?: string | null; url?: string | null };

const entryName = (entry: RequiredEnvEntry): string => {
  return typeof entry === "string" ? entry : entry.name;
};

export const checkRequiredEnv = (args: {
  skillset: Skillset;
  env: Record<string, string | undefined>;
}): Array<string> => {
  const { skillset, env } = args;
  const required = (skillset.metadata as { requiredEnv?: unknown }).requiredEnv;
  if (!Array.isArray(required)) {
    return [];
  }

  const missing: Array<string> = [];
  for (const raw of required) {
    if (typeof raw !== "string" && (typeof raw !== "object" || raw == null)) {
      continue;
    }
    const name = entryName(raw as RequiredEnvEntry);
    const value = env[name];
    if (value == null || value === "") {
      missing.push(name);
    }
  }
  return missing;
};
