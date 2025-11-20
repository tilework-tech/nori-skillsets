import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { loadDiskConfig } from "@/installer/config.js";

// Mock the config module
vi.mock("@/installer/config.js", () => ({
  loadDiskConfig: vi.fn(),
}));

describe("summarize-notification hook", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Mock implementation
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should output "Saving transcript to nori..." when sendSessionTranscript is enabled', async () => {
    // Mock config with enabled transcripts
    vi.mocked(loadDiskConfig).mockResolvedValue({
      sendSessionTranscript: "enabled",
      installDir: process.cwd(),
    });

    // Import and run the hook (dynamic import to ensure fresh module)
    const { main } = await import("./summarize-notification.js");
    await main();

    // Verify output
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        systemMessage: "Saving transcript to nori...\n\n",
      }),
    );
  });

  it("should output disabled message when sendSessionTranscript is disabled", async () => {
    // Mock config with disabled transcripts
    vi.mocked(loadDiskConfig).mockResolvedValue({
      sendSessionTranscript: "disabled",
      installDir: process.cwd(),
    });

    // Import and run the hook
    const { main } = await import("./summarize-notification.js");
    await main();

    // Verify output shows disabled message with re-enable hint
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        systemMessage:
          "Session transcripts disabled. Use /nori-toggle-session-transcripts to enable...\n\n",
      }),
    );
  });

  it("should default to enabled behavior when config is missing", async () => {
    // Mock config with no sendSessionTranscript field (backward compatibility)
    vi.mocked(loadDiskConfig).mockResolvedValue({
      installDir: process.cwd(),
    });

    // Import and run the hook
    const { main } = await import("./summarize-notification.js");
    await main();

    // Verify output defaults to enabled message
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        systemMessage: "Saving transcript to nori...\n\n",
      }),
    );
  });
});
