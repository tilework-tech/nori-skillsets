/**
 * Tests for env-var requirement check used at install time.
 *
 * Verifies that checkRequiredEnv reports which required env vars are
 * missing from a given environment for a given skillset.
 */

import { describe, it, expect } from "vitest";

import { checkRequiredEnv } from "@/cli/features/envCheck.js";

import type { Skillset } from "@/norijson/skillset.js";

const skillsetWithRequiredEnv = (args: {
  requiredEnv: Array<
    string | { name: string; description?: string | null; url?: string | null }
  > | null;
}): Skillset => {
  const { requiredEnv } = args;
  return {
    name: "test",
    dir: "/tmp/test",
    metadata: {
      name: "test",
      version: "1.0.0",
      requiredEnv,
    } as Skillset["metadata"],
    skillsDir: null,
    configFilePath: null,
    slashcommandsDir: null,
    subagentsDir: null,
    mcpDir: null,
  };
};

describe("checkRequiredEnv", () => {
  it("returns names of vars present in requiredEnv but absent from env", () => {
    const skillset = skillsetWithRequiredEnv({
      requiredEnv: [
        { name: "GITHUB_TOKEN" },
        { name: "STRIPE_API_KEY" },
        { name: "SET_VAR" },
      ],
    });

    const missing = checkRequiredEnv({
      skillset,
      env: { SET_VAR: "value", UNRELATED: "other" },
    });

    expect(missing).toEqual(["GITHUB_TOKEN", "STRIPE_API_KEY"]);
  });

  it("returns empty array when all required vars are present", () => {
    const skillset = skillsetWithRequiredEnv({
      requiredEnv: [{ name: "GITHUB_TOKEN" }, { name: "STRIPE_API_KEY" }],
    });

    const missing = checkRequiredEnv({
      skillset,
      env: { GITHUB_TOKEN: "x", STRIPE_API_KEY: "y" },
    });

    expect(missing).toEqual([]);
  });

  it("treats empty-string env values as unset", () => {
    const skillset = skillsetWithRequiredEnv({
      requiredEnv: [{ name: "GITHUB_TOKEN" }],
    });

    const missing = checkRequiredEnv({
      skillset,
      env: { GITHUB_TOKEN: "" },
    });

    expect(missing).toEqual(["GITHUB_TOKEN"]);
  });

  it("returns empty array when skillset has no requiredEnv", () => {
    const skillset = skillsetWithRequiredEnv({ requiredEnv: null });
    const missing = checkRequiredEnv({ skillset, env: {} });
    expect(missing).toEqual([]);
  });

  it("accepts plain strings in requiredEnv (not just objects)", () => {
    const skillset = skillsetWithRequiredEnv({
      requiredEnv: ["GITHUB_TOKEN"],
    });
    const missing = checkRequiredEnv({ skillset, env: {} });
    expect(missing).toEqual(["GITHUB_TOKEN"]);
  });
});
