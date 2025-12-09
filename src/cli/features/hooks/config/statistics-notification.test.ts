import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as pathUtils from "@/utils/path.js";

describe("statistics-notification hook", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Mock implementation
    });

    // Mock getInstallDirs to return a valid installation directory
    vi.spyOn(pathUtils, "getInstallDirs").mockReturnValue([process.cwd()]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should output "Calculating Nori statistics..." message', async () => {
    // Import and run the hook (dynamic import to ensure fresh module)
    const { main } = await import("./statistics-notification.js");
    await main();

    // Verify output
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        systemMessage:
          "Calculating Nori statistics... (Ctrl-C to exit early)\n\n",
      }),
    );
  });

  it("should exit silently when no installation found", async () => {
    // Mock no installations found
    vi.spyOn(pathUtils, "getInstallDirs").mockReturnValue([]);

    const { main } = await import("./statistics-notification.js");

    // Should not throw, should exit gracefully
    await expect(main()).resolves.not.toThrow();

    // Should not output anything when no installation found
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
