/**
 * Tests for new-skillset command
 * Tests that the command creates a new empty skillset directory with nori.json and CLAUDE.md
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

// Mock logger to capture output
const mockSuccess = vi.fn();
const mockInfo = vi.fn();
const mockError = vi.fn();
const mockNewline = vi.fn();
vi.mock("@/cli/logger.js", () => ({
  success: (args: { message: string }) => mockSuccess(args),
  info: (args: { message: string }) => mockInfo(args),
  error: (args: { message: string }) => mockError(args),
  newline: () => mockNewline(),
  raw: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
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
    mockSuccess.mockClear();
    mockInfo.mockClear();
    mockError.mockClear();
    mockNewline.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("should create a flat skillset with nori.json and CLAUDE.md", async () => {
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

    // Verify CLAUDE.md exists and is empty
    const claudeMd = await fs.readFile(
      path.join(destDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMd).toBe("");

    // Verify success message
    expect(mockSuccess).toHaveBeenCalledWith({
      message: expect.stringContaining("my-new-skillset"),
    });
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

    // Verify CLAUDE.md exists
    const claudeMd = await fs.readFile(
      path.join(destDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMd).toBe("");

    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should error when skillset already exists", async () => {
    // Create a directory that already exists
    const existingDir = path.join(profilesDir, "existing-skillset");
    await fs.mkdir(existingDir, { recursive: true });

    await newSkillsetMain({ name: "existing-skillset" });

    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("existing-skillset"),
    });
    expect(mockError).toHaveBeenCalledWith({
      message: expect.stringContaining("already exists"),
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should print instructions for switching and editing after creation", async () => {
    await newSkillsetMain({ name: "my-skillset" });

    // Should print switch instruction
    expect(mockInfo).toHaveBeenCalledWith({
      message: expect.stringContaining("switch-skillset my-skillset"),
    });

    // Should print edit location
    expect(mockInfo).toHaveBeenCalledWith({
      message: expect.stringContaining("~/.nori/profiles/my-skillset"),
    });
  });
});
