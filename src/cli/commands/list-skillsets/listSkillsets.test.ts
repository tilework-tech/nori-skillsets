/**
 * Tests for list-skillsets command
 * Tests that the command correctly lists locally available profiles
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { listSkillsetsMain } from "./listSkillsets.js";

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
vi.mock("@clack/prompts", () => ({
  log: {
    error: (msg: string) => mockLogError(msg),
  },
}));

// Mock process.stdout.write for raw output
const mockStdoutWrite = vi
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

describe("listSkillsetsMain", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "list-skillsets-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    mockStdoutWrite.mockClear();
    mockLogError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
  });

  it("should list all installed profiles one per line", async () => {
    const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    // Create test profiles
    for (const name of ["senior-swe", "product-manager", "custom-profile"]) {
      const dir = path.join(skillsetsDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "nori.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
    }

    await listSkillsetsMain();

    // Should output each profile name via stdout
    expect(mockStdoutWrite).toHaveBeenCalledWith("senior-swe\n");
    expect(mockStdoutWrite).toHaveBeenCalledWith("product-manager\n");
    expect(mockStdoutWrite).toHaveBeenCalledWith("custom-profile\n");
    expect(mockStdoutWrite).toHaveBeenCalledTimes(3);
  });

  it("should error with exit code 1 when no profiles are installed", async () => {
    const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    await listSkillsetsMain();

    // Should output error message and exit with code 1
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("No skillsets installed"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockStdoutWrite).not.toHaveBeenCalled();
  });

  it("should list profiles regardless of config state", async () => {
    // No config file, no agents installed
    const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });
    const dir = path.join(skillsetsDir, "test-profile");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({ name: "test-profile", version: "1.0.0" }),
    );

    await listSkillsetsMain();

    expect(mockStdoutWrite).toHaveBeenCalledWith("test-profile\n");
  });
});

describe("listSkillsetsMain output format", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "list-skillsets-format-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    mockStdoutWrite.mockClear();
    mockLogError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
  });

  it("should output plain profile names without formatting", async () => {
    const skillsetsDir = path.join(testInstallDir, ".nori", "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    const dir = path.join(skillsetsDir, "my-profile");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "nori.json"),
      JSON.stringify({ name: "my-profile", version: "1.0.0" }),
    );

    await listSkillsetsMain();

    // Verify stdout was called (unformatted output)
    expect(mockStdoutWrite).toHaveBeenCalledWith("my-profile\n");
    // Error should not be called
    expect(mockLogError).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });
});

describe("listSkillsetsMain error messages", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "list-skillsets-error-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testInstallDir);
    mockStdoutWrite.mockClear();
    mockLogError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
  });

  it("should show agent-agnostic error when no skillsets installed", async () => {
    const testNoriDir = path.join(testInstallDir, ".nori");
    await fs.mkdir(testNoriDir, { recursive: true });
    const skillsetsDir = path.join(testNoriDir, "profiles");
    await fs.mkdir(skillsetsDir, { recursive: true });

    await listSkillsetsMain();

    // Error message should mention no skillsets installed (agent-agnostic)
    expect(mockLogError).toHaveBeenCalledWith("No skillsets installed.");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
