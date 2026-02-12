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
const mockLogSuccess = vi.fn();
const mockLogError = vi.fn();
const mockNote = vi.fn();
vi.mock("@clack/prompts", () => ({
  log: {
    success: (msg: string) => mockLogSuccess(msg),
    error: (msg: string) => mockLogError(msg),
  },
  note: (content: string, title: string) => mockNote(content, title),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

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
    mockLogSuccess.mockClear();
    mockLogError.mockClear();
    mockNote.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("should create a flat skillset with nori.json", async () => {
    await newSkillsetMain({ name: "my-new-skillset" });

    const destDir = path.join(profilesDir, "my-new-skillset");

    // Verify nori.json exists with correct content
    const noriJson = JSON.parse(
      await fs.readFile(path.join(destDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "my-new-skillset",
      version: "1.0.0",
    });

    // Verify success message
    expect(mockLogSuccess).toHaveBeenCalledWith(
      expect.stringContaining("my-new-skillset"),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should create a namespaced skillset with parent directories", async () => {
    await newSkillsetMain({ name: "myorg/custom-profile" });

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

    await newSkillsetMain({ name: "existing-skillset" });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("existing-skillset"),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should print instructions for switching and editing after creation", async () => {
    await newSkillsetMain({ name: "my-skillset" });

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
});
