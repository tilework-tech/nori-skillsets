/**
 * Tests for new-skillset command
 * Tests that the command creates a new empty skillset directory with nori.json
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { newSkillsetMain } from "./newSkillset.js";

// Mock os.homedir so getNoriSkillsetsDir() resolves to the test directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock @clack/prompts for output
const mockLogError = vi.fn();
const mockNote = vi.fn();
const mockOutro = vi.fn();
vi.mock("@clack/prompts", () => ({
  log: {
    error: (msg: string) => mockLogError(msg),
  },
  note: (content: string, title: string) => mockNote(content, title),
  outro: (msg: string) => mockOutro(msg),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

// Mock newSkillsetFlow
const mockNewSkillsetFlow = vi.fn();
vi.mock("@/cli/prompts/flows/newSkillset.js", () => ({
  newSkillsetFlow: () => mockNewSkillsetFlow(),
}));

describe("newSkillsetMain", () => {
  let testHomeDir: string;
  let skillsetsDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "new-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    skillsetsDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    mockLogError.mockClear();
    mockNote.mockClear();
    mockOutro.mockClear();
    mockExit.mockClear();
    mockNewSkillsetFlow.mockClear();
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("should create a flat skillset with nori.json", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "my-new-skillset",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    const result = await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "my-new-skillset");

    // Verify nori.json exists with correct content
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "my-new-skillset",
      version: "1.0.0",
      type: "skillset",
    });

    // Verify return status contains skillset name
    expect(result.success).toBe(true);
    expect(result.message).toContain("my-new-skillset");
    expect(mockOutro).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should create a namespaced skillset with parent directories", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "myorg/custom-profile",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "myorg", "custom-profile");

    // Verify nori.json uses basename as name
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "custom-profile",
      version: "1.0.0",
      type: "skillset",
    });

    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when skillset already exists", async () => {
    // Create a directory that already exists
    const existingDir = path.join(skillsetsDir, "existing-skillset");
    await fs.mkdir(existingDir, { recursive: true });

    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "existing-skillset",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    const result = await newSkillsetMain();

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("existing-skillset"),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    expect(result.success).toBe(false);
  });

  it("should print instructions for switching and editing after creation", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "my-skillset",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await newSkillsetMain();

    // Should show note with next steps containing switch and edit instructions
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("switch my-skillset"),
      "Next Steps",
    );
    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining("~/.nori/profiles/my-skillset"),
      "Next Steps",
    );
  });

  it("should write all metadata fields to nori.json when provided", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "full-metadata",
      description: "A skillset with full metadata",
      license: "Apache-2.0",
      keywords: ["testing", "automation"],
      version: "2.1.0",
      repository: "https://github.com/user/repo",
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "full-metadata");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson).toEqual({
      name: "full-metadata",
      version: "2.1.0",
      type: "skillset",
      description: "A skillset with full metadata",
      license: "Apache-2.0",
      keywords: ["testing", "automation"],
      repository: "https://github.com/user/repo",
    });
  });

  it("should use default version 1.0.0 when version is null", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "default-version",
      description: "Test",
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "default-version");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson.version).toBe("1.0.0");
  });

  it("should omit optional fields from nori.json when they are null", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "minimal-metadata",
      description: null,
      license: null,
      keywords: null,
      version: "1.5.0",
      repository: null,
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "minimal-metadata");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson).toEqual({
      name: "minimal-metadata",
      version: "1.5.0",
      type: "skillset",
    });
    expect(noriJson.description).toBeUndefined();
    expect(noriJson.license).toBeUndefined();
    expect(noriJson.keywords).toBeUndefined();
    expect(noriJson.repository).toBeUndefined();
  });

  it("should handle flow cancellation gracefully", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce(null);

    await newSkillsetMain();

    // Should not create any directory
    const files = await fs.readdir(skillsetsDir);
    expect(files).toEqual([]);

    // Should not print outro message
    expect(mockOutro).not.toHaveBeenCalled();
  });

  it("should write repository as a string", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "repo-test",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: "https://github.com/example/repo",
    });

    await newSkillsetMain();

    const destDir = path.join(skillsetsDir, "repo-test");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson.repository).toBe("https://github.com/example/repo");
  });
});
