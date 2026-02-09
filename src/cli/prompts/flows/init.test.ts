/**
 * Tests for init flow module
 *
 * These tests verify the initFlow functions including:
 * - Profile persistence warning confirmation
 * - Existing config capture with profile name collection
 * - Cancellation handling for both flows
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExistingConfig } from "@/cli/commands/install/existingConfigCapture.js";

import {
  confirmPersistenceWarning,
  existingConfigCaptureFlow,
} from "./init.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  text: vi.fn(),
  note: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

describe("confirmPersistenceWarning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  it("should display warning info via note before prompting", async () => {
    vi.mocked(clack.confirm).mockResolvedValueOnce(true);

    await confirmPersistenceWarning();

    expect(clack.note).toHaveBeenCalledTimes(1);
    // The note should mention key concepts from the warning
    const noteContent = vi.mocked(clack.note).mock.calls[0][0] as string;
    expect(noteContent).toContain("switch-skillset");
    expect(noteContent).toContain(".nori/profiles");
  });

  it("should exit gracefully when user cancels", async () => {
    const cancelSymbol = Symbol("cancel");
    vi.mocked(clack.confirm).mockResolvedValueOnce(cancelSymbol as any);
    vi.mocked(clack.isCancel).mockReturnValue(true);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(confirmPersistenceWarning()).rejects.toThrow(
      "process.exit called",
    );

    expect(clack.cancel).toHaveBeenCalledWith("Operation cancelled.");
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });
});

describe("existingConfigCaptureFlow", () => {
  const baseConfig: ExistingConfig = {
    hasClaudeMd: true,
    hasManagedBlock: false,
    hasSkills: true,
    skillCount: 3,
    hasAgents: true,
    agentCount: 2,
    hasCommands: true,
    commandCount: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  it("should display detected config summary via note", async () => {
    vi.mocked(clack.text).mockResolvedValueOnce("my-profile");

    await existingConfigCaptureFlow({ existingConfig: baseConfig });

    expect(clack.note).toHaveBeenCalledTimes(1);
    const noteContent = vi.mocked(clack.note).mock.calls[0][0] as string;
    expect(noteContent).toContain("CLAUDE.md");
    expect(noteContent).toContain("3 skills");
    expect(noteContent).toContain("2 subagents");
    expect(noteContent).toContain("1 slash command");
  });

  it("should show managed block warning when hasManagedBlock is true", async () => {
    const configWithBlock: ExistingConfig = {
      ...baseConfig,
      hasManagedBlock: true,
    };
    vi.mocked(clack.text).mockResolvedValueOnce("my-profile");

    await existingConfigCaptureFlow({ existingConfig: configWithBlock });

    expect(clack.log.warn).toHaveBeenCalled();
    const warnMessage = vi.mocked(clack.log.warn).mock.calls[0][0] as string;
    expect(warnMessage).toContain("managed block");
  });

  it("should not show managed block warning when hasManagedBlock is false", async () => {
    vi.mocked(clack.text).mockResolvedValueOnce("my-profile");

    await existingConfigCaptureFlow({ existingConfig: baseConfig });

    expect(clack.log.warn).not.toHaveBeenCalled();
  });

  it("should validate profile name rejects uppercase", async () => {
    vi.mocked(clack.text).mockResolvedValueOnce("valid-name");

    await existingConfigCaptureFlow({ existingConfig: baseConfig });

    const textArgs = vi.mocked(clack.text).mock.calls[0][0];
    const validate = textArgs.validate!;
    expect(validate("MyProfile")).toBeDefined(); // should return error string
  });

  it("should validate profile name rejects empty string", async () => {
    vi.mocked(clack.text).mockResolvedValueOnce("valid-name");

    await existingConfigCaptureFlow({ existingConfig: baseConfig });

    const textArgs = vi.mocked(clack.text).mock.calls[0][0];
    const validate = textArgs.validate!;
    expect(validate("")).toBeDefined(); // should return error string
  });

  it("should validate profile name accepts valid slug", async () => {
    vi.mocked(clack.text).mockResolvedValueOnce("valid-name");

    await existingConfigCaptureFlow({ existingConfig: baseConfig });

    const textArgs = vi.mocked(clack.text).mock.calls[0][0];
    const validate = textArgs.validate!;
    expect(validate("my-profile-123")).toBeUndefined(); // no error
  });

  it("should exit gracefully when user cancels text input", async () => {
    const cancelSymbol = Symbol("cancel");
    vi.mocked(clack.text).mockResolvedValueOnce(cancelSymbol as any);
    vi.mocked(clack.isCancel).mockReturnValue(true);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(
      existingConfigCaptureFlow({ existingConfig: baseConfig }),
    ).rejects.toThrow("process.exit called");

    expect(clack.cancel).toHaveBeenCalledWith("Operation cancelled.");
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });

  it("should handle config with only CLAUDE.md and no other items", async () => {
    const minimalConfig: ExistingConfig = {
      hasClaudeMd: true,
      hasManagedBlock: false,
      hasSkills: false,
      skillCount: 0,
      hasAgents: false,
      agentCount: 0,
      hasCommands: false,
      commandCount: 0,
    };
    vi.mocked(clack.text).mockResolvedValueOnce("my-profile");

    await existingConfigCaptureFlow({ existingConfig: minimalConfig });

    const noteContent = vi.mocked(clack.note).mock.calls[0][0] as string;
    expect(noteContent).toContain("CLAUDE.md");
    // Should not mention skills/agents/commands when counts are 0
    expect(noteContent).not.toContain("skill");
    expect(noteContent).not.toContain("subagent");
    expect(noteContent).not.toContain("slash command");
  });
});
