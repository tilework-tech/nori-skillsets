/**
 * Tests for the factory-reset command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import { factoryResetMain } from "./factoryReset.js";

// Mock logger to suppress output during tests
vi.mock("@/cli/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  newline: vi.fn(),
  raw: vi.fn(),
}));

// Mock promptText so we can control user input
vi.mock("@/cli/prompts/text.js", () => ({
  promptText: vi.fn(),
}));

// Mock the factory reset flow
vi.mock("@/cli/prompts/flows/factoryReset.js", () => ({
  factoryResetFlow: vi.fn().mockResolvedValue({ deletedCount: 0 }),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

describe("factoryResetMain", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "factory-reset-main-"));
    vi.clearAllMocks();
    AgentRegistry.resetInstance();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    AgentRegistry.resetInstance();
  });

  it("should throw error for unknown agent name", async () => {
    await expect(
      factoryResetMain({
        agentName: "nonexistent-agent",
        path: tempDir,
      }),
    ).rejects.toThrow("Unknown agent");
  });

  it("should call factoryResetFlow and delete artifacts via callbacks", async () => {
    const { factoryResetFlow } =
      await import("@/cli/prompts/flows/factoryReset.js");

    // Create artifacts so we can verify the delete callback works
    const claudeDir = path.join(tempDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });

    // Make factoryResetFlow invoke the callbacks so we can verify they work
    vi.mocked(factoryResetFlow).mockImplementation(async (args) => {
      const { artifacts } = await args.callbacks.onFindArtifacts({
        path: tempDir,
      });
      await args.callbacks.onDeleteArtifacts({ artifacts });
      return { deletedCount: artifacts.length };
    });

    await factoryResetMain({
      agentName: "claude-code",
      path: tempDir,
    });

    expect(factoryResetFlow).toHaveBeenCalled();

    // Verify the .claude directory was deleted by the onDeleteArtifacts callback
    await expect(fs.access(claudeDir)).rejects.toThrow();
  });

  it("should exit with error in non-interactive mode", async () => {
    const { error } = await import("@/cli/logger.js");

    await factoryResetMain({
      agentName: "claude-code",
      path: tempDir,
      nonInteractive: true,
    });

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("non-interactive"),
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit with error when agent does not support factory reset", async () => {
    const { error } = await import("@/cli/logger.js");

    // Register a test agent without factoryReset
    const registry = AgentRegistry.getInstance();
    // Access private agents map to add a test agent
    const agentsMap = (registry as any).agents as Map<string, any>;
    agentsMap.set("test-agent", {
      name: "test-agent",
      displayName: "Test Agent",
      getLoaderRegistry: () => ({ getAll: () => [] }),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      switchProfile: async () => {},
      factoryReset: null,
    });

    await factoryResetMain({
      agentName: "test-agent",
      path: tempDir,
    });

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("does not support factory reset"),
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use factoryResetFlow", async () => {
    const { factoryResetFlow } =
      await import("@/cli/prompts/flows/factoryReset.js");

    await factoryResetMain({
      agentName: "claude-code",
      path: tempDir,
    });

    expect(factoryResetFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "Claude Code",
        path: tempDir,
        callbacks: expect.objectContaining({
          onFindArtifacts: expect.any(Function),
          onDeleteArtifacts: expect.any(Function),
        }),
      }),
    );
  });
});
