/**
 * Tests for register-skillset command
 * Tests that the command creates nori.json for existing skillsets that don't have one
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { registerSkillsetMain } from "./registerSkillset.js";

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

// Mock registerSkillsetFlow
const mockRegisterSkillsetFlow = vi.fn();
vi.mock("@/cli/prompts/flows/registerSkillset.js", () => ({
  registerSkillsetFlow: () => mockRegisterSkillsetFlow(),
}));

// Mock config loading
const mockLoadConfig = vi.fn();
const mockGetAgentProfile = vi.fn();
const mockGetInstalledAgents = vi.fn();
vi.mock("@/cli/config.js", () => ({
  loadConfig: (args: any) => mockLoadConfig(args),
  getAgentProfile: (args: any) => mockGetAgentProfile(args),
  getInstalledAgents: (args: any) => mockGetInstalledAgents(args),
}));

describe("registerSkillsetMain", () => {
  let testHomeDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    testHomeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "register-skillset-test-"),
    );
    vi.mocked(os.homedir).mockReturnValue(testHomeDir);
    profilesDir = path.join(testHomeDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    mockLogError.mockClear();
    mockNote.mockClear();
    mockOutro.mockClear();
    mockExit.mockClear();
    mockRegisterSkillsetFlow.mockClear();
    mockLoadConfig.mockClear();
    mockGetAgentProfile.mockClear();
    mockGetInstalledAgents.mockClear();
  });

  afterEach(async () => {
    if (testHomeDir) {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("should create nori.json for existing skillset without one", async () => {
    // Create existing skillset directory without nori.json
    const existingDir = path.join(profilesDir, "my-existing-skillset");
    await fs.mkdir(existingDir, { recursive: true });

    mockRegisterSkillsetFlow.mockResolvedValueOnce({
      description: "My existing skillset",
      license: "MIT",
      keywords: ["testing"],
      version: "1.5.0",
      repository: "https://github.com/user/repo",
    });

    await registerSkillsetMain({ skillsetName: "my-existing-skillset" });

    // Verify nori.json was created
    const noriJson = JSON.parse(
      await fs.readFile(path.join(existingDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "my-existing-skillset",
      version: "1.5.0",
      description: "My existing skillset",
      license: "MIT",
      keywords: ["testing"],
      repository: {
        type: "git",
        url: "https://github.com/user/repo",
      },
    });

    expect(mockOutro).toHaveBeenCalledWith(
      expect.stringContaining("my-existing-skillset"),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should use current skillset when skillsetName is null", async () => {
    // Create existing skillset directory
    const existingDir = path.join(profilesDir, "current-skillset");
    await fs.mkdir(existingDir, { recursive: true });

    // Mock config loading to return current skillset
    mockLoadConfig.mockResolvedValueOnce({ some: "config" });
    mockGetInstalledAgents.mockReturnValueOnce(["claude-code"]);
    mockGetAgentProfile.mockReturnValueOnce({
      baseProfile: "current-skillset",
    });

    mockRegisterSkillsetFlow.mockResolvedValueOnce({
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await registerSkillsetMain({ skillsetName: null });

    // Verify nori.json was created in the current skillset
    const noriJson = JSON.parse(
      await fs.readFile(path.join(existingDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("current-skillset");
  });

  it("should error when skillset directory does not exist", async () => {
    await registerSkillsetMain({ skillsetName: "non-existent-skillset" });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("non-existent-skillset"),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("does not exist"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error when nori.json already exists", async () => {
    // Create existing skillset directory with nori.json
    const existingDir = path.join(profilesDir, "already-registered");
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(
      path.join(existingDir, "nori.json"),
      JSON.stringify({ name: "already-registered", version: "1.0.0" }),
    );

    await registerSkillsetMain({ skillsetName: "already-registered" });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("already-registered"),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("already has"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle flow cancellation gracefully", async () => {
    // Create existing skillset directory
    const existingDir = path.join(profilesDir, "cancel-test");
    await fs.mkdir(existingDir, { recursive: true });

    mockRegisterSkillsetFlow.mockResolvedValueOnce(null);

    await registerSkillsetMain({ skillsetName: "cancel-test" });

    // Verify nori.json was NOT created
    try {
      await fs.access(path.join(existingDir, "nori.json"));
      expect.fail("nori.json should not exist");
    } catch {
      // Expected - file should not exist
    }

    expect(mockOutro).not.toHaveBeenCalled();
  });

  it("should use basename for namespaced skillsets", async () => {
    // Create namespaced skillset directory
    const existingDir = path.join(profilesDir, "myorg", "namespaced-skillset");
    await fs.mkdir(existingDir, { recursive: true });

    mockRegisterSkillsetFlow.mockResolvedValueOnce({
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await registerSkillsetMain({ skillsetName: "myorg/namespaced-skillset" });

    // Verify nori.json uses basename
    const noriJson = JSON.parse(
      await fs.readFile(path.join(existingDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.name).toBe("namespaced-skillset");
  });

  it("should write minimal nori.json when all fields are null", async () => {
    const existingDir = path.join(profilesDir, "minimal-skillset");
    await fs.mkdir(existingDir, { recursive: true });

    mockRegisterSkillsetFlow.mockResolvedValueOnce({
      description: null,
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await registerSkillsetMain({ skillsetName: "minimal-skillset" });

    const noriJson = JSON.parse(
      await fs.readFile(path.join(existingDir, "nori.json"), "utf-8"),
    );
    expect(noriJson).toEqual({
      name: "minimal-skillset",
      version: "1.0.0",
    });
  });

  it("should use default version 1.0.0 when version is null", async () => {
    const existingDir = path.join(profilesDir, "version-test");
    await fs.mkdir(existingDir, { recursive: true });

    mockRegisterSkillsetFlow.mockResolvedValueOnce({
      description: "Test",
      license: null,
      keywords: null,
      version: null,
      repository: null,
    });

    await registerSkillsetMain({ skillsetName: "version-test" });

    const noriJson = JSON.parse(
      await fs.readFile(path.join(existingDir, "nori.json"), "utf-8"),
    );
    expect(noriJson.version).toBe("1.0.0");
  });
});
