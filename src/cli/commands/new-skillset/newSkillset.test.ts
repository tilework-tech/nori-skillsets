/**
 * Tests for new-skillset command
 * Tests that the command creates a new empty skillset directory with nori.json
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { newSkillsetMain } from "./newSkillset.js";

// Mock os.homedir so getNoriProfilesDir() resolves to the test directory
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
  let profilesDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "new-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    profilesDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
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

    await newSkillsetMain();

    const destDir = path.join(profilesDir, "my-new-skillset");

    // Verify nori.json exists with correct content
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "my-new-skillset",
      version: "1.0.0",
    });

    // Verify outro message
    expect(mockOutro).toHaveBeenCalledWith(
      expect.stringContaining("my-new-skillset"),
    );
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

    const destDir = path.join(profilesDir, "myorg", "custom-profile");

    // Verify nori.json uses basename as name
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "custom-profile",
      version: "1.0.0",
    });

    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when skillset already exists", async () => {
    // Create a directory that already exists
    const existingDir = path.join(profilesDir, "existing-skillset");
    await fs.mkdir(existingDir, { recursive: true });

    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "existing-skillset",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await newSkillsetMain();

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("existing-skillset"),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
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

    const destDir = path.join(profilesDir, "full-metadata");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson).toEqual({
      name: "full-metadata",
      version: "2.1.0",
      description: "A skillset with full metadata",
      license: "Apache-2.0",
      keywords: ["testing", "automation"],
      repository: {
        type: "git",
        url: "https://github.com/user/repo",
      },
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

    const destDir = path.join(profilesDir, "default-version");
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

    const destDir = path.join(profilesDir, "minimal-metadata");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson).toEqual({
      name: "minimal-metadata",
      version: "1.5.0",
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
    const files = await fs.readdir(profilesDir);
    expect(files).toEqual([]);

    // Should not print outro message
    expect(mockOutro).not.toHaveBeenCalled();
  });

  it("should write repository as object with type and url", async () => {
    mockNewSkillsetFlow.mockResolvedValueOnce({
      name: "repo-test",
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: "https://github.com/example/repo",
    });

    await newSkillsetMain();

    const destDir = path.join(profilesDir, "repo-test");
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );

    expect(noriJson.repository).toEqual({
      type: "git",
      url: "https://github.com/example/repo",
    });
  });
});
