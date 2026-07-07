/**
 * Tests for the post-upload local state sync module.
 *
 * Uses real filesystem operations in temp directories (like the packaging
 * tests). The registry-upload command suite pins the end-to-end behavior;
 * these tests exercise the sync policy directly.
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { syncLocalStateAfterUpload } from "./uploadSync.js";

describe("syncLocalStateAfterUpload", () => {
  let skillsetDir: string;

  const readJson = async (relPath: string): Promise<Record<string, any>> => {
    return JSON.parse(
      await fs.readFile(path.join(skillsetDir, relPath), "utf-8"),
    ) as Record<string, any>;
  };

  beforeEach(async () => {
    skillsetDir = await fs.mkdtemp(path.join(tmpdir(), "nori-upload-sync-"));
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({
        name: "my-skillset",
        version: "1.0.0",
        type: "skillset",
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(skillsetDir, { recursive: true, force: true });
  });

  it("updates nori.json version and registryURL and writes .nori-version", async () => {
    const { warnings } = await syncLocalStateAfterUpload({
      skillsetDir,
      uploadedVersion: "1.0.1",
      registryUrl: "https://myorg.tilework.tech/registry",
    });

    expect(warnings).toEqual([]);

    const metadata = await readJson("nori.json");
    expect(metadata.version).toBe("1.0.1");
    expect(metadata.registryURL).toBe("https://myorg.tilework.tech/registry");

    const versionInfo = await readJson(".nori-version");
    expect(versionInfo.version).toBe("1.0.1");
    expect(versionInfo.registryUrl).toBe(
      "https://myorg.tilework.tech/registry",
    );
  });

  it("creates a fresh nori.json when none exists", async () => {
    await fs.rm(path.join(skillsetDir, "nori.json"));

    await syncLocalStateAfterUpload({
      skillsetDir,
      uploadedVersion: "2.0.0",
      registryUrl: "https://registry.example",
    });

    const metadata = await readJson("nori.json");
    expect(metadata.name).toBe(path.basename(skillsetDir));
    expect(metadata.version).toBe("2.0.0");
    expect(metadata.type).toBe("skillset");
  });

  it("records extracted skill and subagent versions in dependencies and per-package nori.json", async () => {
    const skillDir = path.join(skillsetDir, "skills", "my-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "nori.json"),
      JSON.stringify({ name: "my-skill", version: "1.0.0", type: "skill" }),
    );

    const subagentDir = path.join(skillsetDir, "subagents", "my-subagent");
    await fs.mkdir(subagentDir, { recursive: true });
    await fs.writeFile(
      path.join(subagentDir, "nori.json"),
      JSON.stringify({
        name: "my-subagent",
        version: "1.0.0",
        type: "subagent",
      }),
    );

    await syncLocalStateAfterUpload({
      skillsetDir,
      uploadedVersion: "1.0.1",
      registryUrl: "https://registry.example",
      extractedSkills: {
        succeeded: [{ name: "my-skill", version: "2.0.0" }],
        failed: [],
      },
      extractedSubagents: {
        succeeded: [{ name: "my-subagent", version: "3.0.0" }],
        failed: [],
      },
    });

    const metadata = await readJson("nori.json");
    expect(metadata.dependencies?.skills?.["my-skill"]).toBe("2.0.0");
    expect(metadata.dependencies?.subagents?.["my-subagent"]).toBe("3.0.0");

    expect((await readJson("skills/my-skill/nori.json")).version).toBe("2.0.0");
    expect((await readJson("subagents/my-subagent/nori.json")).version).toBe(
      "3.0.0",
    );
  });

  it("overwrites linked SKILL.md content and bumps the skill nori.json", async () => {
    const skillDir = path.join(skillsetDir, "skills", "linked-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "local content");
    await fs.writeFile(
      path.join(skillDir, "nori.json"),
      JSON.stringify({ name: "linked-skill", version: "1.0.0", type: "skill" }),
    );

    const { warnings } = await syncLocalStateAfterUpload({
      skillsetDir,
      uploadedVersion: "1.0.1",
      registryUrl: "https://registry.example",
      linkedSkillVersions: new Map([["linked-skill", "4.5.6"]]),
      linkedSkillsToReplace: new Map([["linked-skill", "remote content"]]),
    });

    expect(warnings).toEqual([]);
    expect(await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8")).toBe(
      "remote content",
    );
    expect((await readJson("skills/linked-skill/nori.json")).version).toBe(
      "4.5.6",
    );

    const metadata = await readJson("nori.json");
    expect(metadata.dependencies?.skills?.["linked-skill"]).toBe("4.5.6");
  });

  it("overwrites linked SUBAGENT.md in whichever local layout exists", async () => {
    // Directory layout
    const dirSubagent = path.join(skillsetDir, "subagents", "dir-agent");
    await fs.mkdir(dirSubagent, { recursive: true });
    await fs.writeFile(path.join(dirSubagent, "SUBAGENT.md"), "local dir");

    // Flat layout
    await fs.writeFile(
      path.join(skillsetDir, "subagents", "flat-agent.md"),
      "local flat",
    );

    await syncLocalStateAfterUpload({
      skillsetDir,
      uploadedVersion: "1.0.1",
      registryUrl: "https://registry.example",
      linkedSubagentVersions: new Map([
        ["dir-agent", "2.0.0"],
        ["flat-agent", "3.0.0"],
      ]),
      linkedSubagentsToReplace: new Map([
        ["dir-agent", "remote dir"],
        ["flat-agent", "remote flat"],
      ]),
    });

    expect(
      await fs.readFile(path.join(dirSubagent, "SUBAGENT.md"), "utf-8"),
    ).toBe("remote dir");
    expect(
      await fs.readFile(
        path.join(skillsetDir, "subagents", "flat-agent.md"),
        "utf-8",
      ),
    ).toBe("remote flat");

    const metadata = await readJson("nori.json");
    expect(metadata.dependencies?.subagents?.["dir-agent"]).toBe("2.0.0");
    expect(metadata.dependencies?.subagents?.["flat-agent"]).toBe("3.0.0");
  });

  it("returns a warning when a linked subagent has no local file in either layout", async () => {
    const { warnings } = await syncLocalStateAfterUpload({
      skillsetDir,
      uploadedVersion: "1.0.1",
      registryUrl: "https://registry.example",
      linkedSubagentVersions: new Map([["ghost-agent", "1.0.0"]]),
      linkedSubagentsToReplace: new Map([["ghost-agent", "remote content"]]),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'Could not locate local SUBAGENT.md for "ghost-agent"',
    );

    // Sync still completes: dependency map and version file are written
    const metadata = await readJson("nori.json");
    expect(metadata.dependencies?.subagents?.["ghost-agent"]).toBe("1.0.0");
    expect((await readJson(".nori-version")).version).toBe("1.0.1");
  });
});
