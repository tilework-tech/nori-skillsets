/**
 * Tests for the skillset upload pipeline module.
 *
 * Uses real filesystem operations in temp directories (like the packaging
 * tests) with a mocked registrar API. The registry-upload command suite pins
 * the end-to-end behavior; these tests exercise the pipeline directly.
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API (the pipeline only calls uploadSkillset)
vi.mock("@/api/registrar.js", () => ({
  registrarApi: {
    getPackument: vi.fn(),
    uploadSkillset: vi.fn(),
  },
}));

import { registrarApi } from "@/api/registrar.js";
import { SkillCollisionError, SubagentCollisionError } from "@/utils/fetch.js";

import {
  performSkillsetUpload,
  persistFlatSubagentInlineChoices,
} from "./uploadPipeline.js";

/**
 * Base args for performSkillsetUpload with no candidates; tests override
 * the parts they exercise.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The temp skillset directory under test
 *
 * @returns Args object for performSkillsetUpload
 */
const baseArgs = (args: { skillsetDir: string }) => ({
  skillsetDir: args.skillsetDir,
  packageName: "my-skillset",
  uploadVersion: "1.0.1",
  registryUrl: "https://registry.example",
  authToken: "auth-token",
  inlineCandidates: [],
  subagentInlineCandidates: [],
  flatSubagentCandidates: [],
  existingInlineSkills: [],
  existingInlineSubagents: [],
  existingFlatInlineSubagents: [],
});

describe("performSkillsetUpload", () => {
  let skillsetDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    skillsetDir = await fs.mkdtemp(path.join(tmpdir(), "nori-upload-pipe-"));
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

  it("archives the skillset, uploads it, and returns the server result", async () => {
    vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
      name: "my-skillset",
      version: "1.0.1",
      tarballSha: "abc123",
      createdAt: new Date().toISOString(),
      extractedSkills: {
        succeeded: [{ name: "my-skill", version: "2.0.0" }],
        failed: [],
      },
    });

    const result = await performSkillsetUpload({
      ...baseArgs({ skillsetDir }),
      description: "a description",
    });

    expect(result).toEqual({
      success: true,
      version: "1.0.1",
      extractedSkills: {
        succeeded: [{ name: "my-skill", version: "2.0.0" }],
        failed: [],
      },
      extractedSubagents: undefined,
    });

    expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: "my-skillset",
        version: "1.0.1",
        registryUrl: "https://registry.example",
        authToken: "auth-token",
        description: "a description",
        inlineSkills: undefined,
        inlineSubagents: undefined,
      }),
    );
    const uploadArgs = vi.mocked(registrarApi.uploadSkillset).mock.calls[0][0];
    expect(uploadArgs.archiveData.byteLength).toBeGreaterThan(0);
  });

  it("writes candidate nori.json files (inlined-skill vs skill) and merges inline lists", async () => {
    for (const skillId of ["keep-inline", "extract-me"]) {
      const skillDir = path.join(skillsetDir, "skills", skillId);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, "SKILL.md"), `# ${skillId}\n`);
    }

    vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
      name: "my-skillset",
      version: "1.0.1",
      tarballSha: "abc123",
      createdAt: new Date().toISOString(),
    });

    const result = await performSkillsetUpload({
      ...baseArgs({ skillsetDir }),
      inlineCandidates: ["keep-inline", "extract-me"],
      inlineSkills: ["keep-inline"],
      existingInlineSkills: ["already-inline"],
    });

    expect(result.success).toBe(true);

    const keepMeta = JSON.parse(
      await fs.readFile(
        path.join(skillsetDir, "skills", "keep-inline", "nori.json"),
        "utf-8",
      ),
    );
    expect(keepMeta.type).toBe("inlined-skill");

    const extractMeta = JSON.parse(
      await fs.readFile(
        path.join(skillsetDir, "skills", "extract-me", "nori.json"),
        "utf-8",
      ),
    );
    expect(extractMeta.type).toBe("skill");

    // Existing inline skills are merged with newly-resolved ones
    expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
      expect.objectContaining({
        inlineSkills: ["already-inline", "keep-inline"],
      }),
    );
  });

  it("partitions flat subagents: persists inline choices and restructures extracted ones", async () => {
    const subagentsDir = path.join(skillsetDir, "subagents");
    await fs.mkdir(subagentsDir, { recursive: true });
    await fs.writeFile(
      path.join(subagentsDir, "keep-flat.md"),
      "---\nname: Keep Flat\ndescription: stays inline\n---\nbody\n",
    );
    await fs.writeFile(
      path.join(subagentsDir, "extract-flat.md"),
      "---\nname: Extract Flat\ndescription: becomes a dir\n---\nbody\n",
    );

    vi.mocked(registrarApi.uploadSkillset).mockResolvedValue({
      name: "my-skillset",
      version: "1.0.1",
      tarballSha: "abc123",
      createdAt: new Date().toISOString(),
    });

    const result = await performSkillsetUpload({
      ...baseArgs({ skillsetDir }),
      flatSubagentCandidates: ["keep-flat", "extract-flat"],
      inlineSubagents: ["keep-flat"],
      existingFlatInlineSubagents: ["existing-flat"],
      existingInlineSubagents: ["existing-dir"],
    });

    expect(result.success).toBe(true);

    // Inline choice persisted in the skillset nori.json subagents array
    const metadata = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );
    expect(metadata.subagents).toEqual([
      { id: "keep-flat", name: "Keep Flat", description: "stays inline" },
    ]);

    // Extracted flat subagent restructured into directory format
    const extractedMd = await fs.readFile(
      path.join(subagentsDir, "extract-flat", "SUBAGENT.md"),
      "utf-8",
    );
    expect(extractedMd).toContain("name: Extract Flat");
    const extractedMeta = JSON.parse(
      await fs.readFile(
        path.join(subagentsDir, "extract-flat", "nori.json"),
        "utf-8",
      ),
    );
    expect(extractedMeta).toEqual({
      name: "Extract Flat",
      version: "1.0.0",
      type: "subagent",
    });
    await expect(
      fs.access(path.join(subagentsDir, "extract-flat.md")),
    ).rejects.toThrow();

    // All inline subagent sources are merged for the API call
    expect(registrarApi.uploadSkillset).toHaveBeenCalledWith(
      expect.objectContaining({
        inlineSubagents: ["existing-dir", "existing-flat", "keep-flat"],
      }),
    );
  });

  it("maps SkillCollisionError to a conflicts result", async () => {
    const conflicts = [
      {
        skillId: "my-skill",
        exists: true,
        canPublish: true,
        availableActions: ["updateVersion" as const],
      },
    ];
    vi.mocked(registrarApi.uploadSkillset).mockRejectedValue(
      new SkillCollisionError({ message: "collision", conflicts }),
    );

    const result = await performSkillsetUpload(baseArgs({ skillsetDir }));

    expect(result).toEqual({ success: false, conflicts });
  });

  it("maps SubagentCollisionError to a subagentConflicts result", async () => {
    const conflicts = [
      {
        subagentId: "my-subagent",
        exists: true,
        canPublish: true,
        availableActions: ["namespace" as const],
      },
    ];
    vi.mocked(registrarApi.uploadSkillset).mockRejectedValue(
      new SubagentCollisionError({ message: "collision", conflicts }),
    );

    const result = await performSkillsetUpload(baseArgs({ skillsetDir }));

    expect(result).toEqual({ success: false, subagentConflicts: conflicts });
  });

  it("maps other errors to an error result", async () => {
    vi.mocked(registrarApi.uploadSkillset).mockRejectedValue(
      new Error("network down"),
    );

    const result = await performSkillsetUpload(baseArgs({ skillsetDir }));

    expect(result).toEqual({ success: false, error: "network down" });
  });
});

describe("persistFlatSubagentInlineChoices", () => {
  let skillsetDir: string;

  beforeEach(async () => {
    skillsetDir = await fs.mkdtemp(path.join(tmpdir(), "nori-flat-inline-"));
    await fs.writeFile(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({
        name: "my-skillset",
        version: "1.0.0",
        type: "skillset",
        subagents: [{ id: "declared", name: "Declared", description: "old" }],
      }),
    );
    await fs.mkdir(path.join(skillsetDir, "subagents"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(skillsetDir, { recursive: true, force: true });
  });

  it("appends new inline choices with parsed frontmatter and skips declared ids", async () => {
    await fs.writeFile(
      path.join(skillsetDir, "subagents", "new-agent.md"),
      "---\nname: New Agent\ndescription: does things\n---\nbody\n",
    );

    await persistFlatSubagentInlineChoices({
      skillsetDir,
      flatSubagentIds: ["new-agent", "declared"],
    });

    const metadata = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );
    expect(metadata.subagents).toEqual([
      { id: "declared", name: "Declared", description: "old" },
      { id: "new-agent", name: "New Agent", description: "does things" },
    ]);
  });

  it("falls back to the id when the flat file has no parseable frontmatter", async () => {
    await persistFlatSubagentInlineChoices({
      skillsetDir,
      flatSubagentIds: ["missing-file"],
    });

    const metadata = JSON.parse(
      await fs.readFile(path.join(skillsetDir, "nori.json"), "utf-8"),
    );
    expect(metadata.subagents).toContainEqual({
      id: "missing-file",
      name: "missing-file",
      description: "",
    });
  });
});
