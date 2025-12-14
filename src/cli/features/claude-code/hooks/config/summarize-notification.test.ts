import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { loadConfig } from "@/cli/config.js";
import { LOG_FILE } from "@/cli/logger.js";
import * as pathUtils from "@/utils/path.js";

import {
  formatSuccess,
  formatError,
} from "./intercepted-slashcommands/format.js";

// Mock the config module
vi.mock("@/cli/config.js", () => ({
  loadConfig: vi.fn(),
}));

describe("summarize-notification hook", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // Mock implementation
    });

    // Mock getInstallDirs to return a valid installation directory
    vi.spyOn(pathUtils, "getInstallDirs").mockReturnValue([process.cwd()]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should output green-colored message to stderr when sendSessionTranscript is enabled", async () => {
    // Mock config with enabled transcripts
    vi.mocked(loadConfig).mockResolvedValue({
      sendSessionTranscript: "enabled",
      installDir: process.cwd(),
    });

    // Import and run the hook (dynamic import to ensure fresh module)
    const { main } = await import("./summarize-notification.js");
    await main();

    // Verify output goes to stderr with green ANSI formatting
    const expectedMessage = formatSuccess({
      message: "Saving transcript to nori...\n\n",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expectedMessage);
  });

  it("should output green disabled message when sendSessionTranscript is disabled", async () => {
    // Mock config with disabled transcripts
    vi.mocked(loadConfig).mockResolvedValue({
      sendSessionTranscript: "disabled",
      installDir: process.cwd(),
    });

    // Import and run the hook
    const { main } = await import("./summarize-notification.js");
    await main();

    // Verify output shows disabled message with green formatting
    const expectedMessage = formatSuccess({
      message:
        "Session transcripts disabled. Use /nori-toggle-session-transcripts to enable...\n\n",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expectedMessage);
  });

  it("should default to enabled behavior when config is missing sendSessionTranscript", async () => {
    // Mock config with no sendSessionTranscript field (backward compatibility)
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: process.cwd(),
    });

    // Import and run the hook
    const { main } = await import("./summarize-notification.js");
    await main();

    // Verify output defaults to enabled message with green formatting
    const expectedMessage = formatSuccess({
      message: "Saving transcript to nori...\n\n",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expectedMessage);
  });

  it("should output red error message when no installation found", async () => {
    // Mock no installations found
    vi.spyOn(pathUtils, "getInstallDirs").mockReturnValue([]);

    const { main } = await import("./summarize-notification.js");
    await main();

    // Should output red error message about Watchtower with log file reference
    const expectedMessage = formatError({
      message: `Error saving to Nori Watchtower. Check ${LOG_FILE} for details.\n\n`,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expectedMessage);
  });

  it("should output red error message when config loading fails", async () => {
    // Mock config loading failure
    vi.mocked(loadConfig).mockRejectedValue(new Error("Config load failed"));

    const { main } = await import("./summarize-notification.js");
    await main();

    // Should output red error message about Watchtower with log file reference
    const expectedMessage = formatError({
      message: `Error saving to Nori Watchtower. Check ${LOG_FILE} for details.\n\n`,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expectedMessage);
  });
});
