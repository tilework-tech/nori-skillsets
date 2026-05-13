import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateFromTemplate } from "@/templates/generate.js";

const VALID_VARS = {
  agentId: "goose",
  agentName: "Goose",
  skillsetId: "goose-skills",
  cliBinary: "goose",
  authIntegrationId: "goose-api-key",
};

const walkFiles = async (dir: string): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const readDir = async (d: string): Promise<void> => {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await readDir(full);
      } else {
        const rel = path.relative(dir, full);
        result.set(rel, await fs.readFile(full, "utf-8"));
      }
    }
  };
  await readDir(dir);
  return result;
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sks-template-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("generateFromTemplate", () => {
  it("produces nori.json, AGENTS.md, and integration skill file", async () => {
    const outputDir = path.join(tmpDir, "out");
    await generateFromTemplate({ vars: VALID_VARS, outputDir });

    const entries = await fs.readdir(outputDir);
    expect(entries).toContain("nori.json");
    expect(entries).toContain("AGENTS.md");

    const skillPath = path.join(
      outputDir,
      "skills",
      "integrations",
      "goose.md",
    );
    const stat = await fs.stat(skillPath);
    expect(stat.isFile()).toBe(true);
  });

  it("substitutes all template variables with no raw placeholders remaining", async () => {
    const outputDir = path.join(tmpDir, "out");
    await generateFromTemplate({ vars: VALID_VARS, outputDir });

    const files = await walkFiles(outputDir);
    for (const [, content] of files) {
      expect(content).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    }
  });

  it("writes the skillsetId into nori.json name field", async () => {
    const outputDir = path.join(tmpDir, "out");
    await generateFromTemplate({ vars: VALID_VARS, outputDir });

    const raw = await fs.readFile(path.join(outputDir, "nori.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("goose-skills");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.type).toBe("skillset");
  });

  it("includes the agent display name in AGENTS.md", async () => {
    const outputDir = path.join(tmpDir, "out");
    await generateFromTemplate({ vars: VALID_VARS, outputDir });

    const content = await fs.readFile(
      path.join(outputDir, "AGENTS.md"),
      "utf-8",
    );
    expect(content).toContain("Goose");
  });

  it("references authIntegrationId in the integration skill", async () => {
    const outputDir = path.join(tmpDir, "out");
    await generateFromTemplate({ vars: VALID_VARS, outputDir });

    const content = await fs.readFile(
      path.join(outputDir, "skills", "integrations", "goose.md"),
      "utf-8",
    );
    expect(content).toContain("goose-api-key");
    expect(content).toContain("goose");
  });

  it("rejects when a required variable is missing", async () => {
    const outputDir = path.join(tmpDir, "out");
    const incomplete = { ...VALID_VARS, agentId: "" };

    await expect(
      generateFromTemplate({ vars: incomplete, outputDir }),
    ).rejects.toThrow(/agentId/);
  });

  it("rejects when output directory already exists", async () => {
    const outputDir = path.join(tmpDir, "out");
    await fs.mkdir(outputDir);

    await expect(
      generateFromTemplate({ vars: VALID_VARS, outputDir }),
    ).rejects.toThrow(/already exists/);
  });

  it("produces identical output for the same inputs", async () => {
    const outA = path.join(tmpDir, "a");
    const outB = path.join(tmpDir, "b");

    await generateFromTemplate({ vars: VALID_VARS, outputDir: outA });
    await generateFromTemplate({ vars: VALID_VARS, outputDir: outB });

    const filesA = await walkFiles(outA);
    const filesB = await walkFiles(outB);

    expect([...filesA.keys()].sort()).toEqual([...filesB.keys()].sort());
    for (const [key, content] of filesA) {
      expect(filesB.get(key)).toBe(content);
    }
  });

  it("works with different agent variables", async () => {
    const outputDir = path.join(tmpDir, "out");
    const vars = {
      agentId: "opencode",
      agentName: "OpenCode",
      skillsetId: "opencode-skills",
      cliBinary: "opencode",
      authIntegrationId: "opencode-api-key",
    };

    await generateFromTemplate({ vars, outputDir });

    const manifest = JSON.parse(
      await fs.readFile(path.join(outputDir, "nori.json"), "utf-8"),
    );
    expect(manifest.name).toBe("opencode-skills");

    const skillPath = path.join(
      outputDir,
      "skills",
      "integrations",
      "opencode.md",
    );
    const stat = await fs.stat(skillPath);
    expect(stat.isFile()).toBe(true);
  });
});
