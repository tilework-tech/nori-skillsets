import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as pathUtils from "@/utils/path.js";

import { formatSuccess } from "./intercepted-slashcommands/format.js";

describe("statistics-notification hook", () => {
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

  it("should output green-colored message to stderr", async () => {
    // Import and run the hook (dynamic import to ensure fresh module)
    const { main } = await import("./statistics-notification.js");
    await main();

    // Verify output goes to stderr with green ANSI formatting
    const expectedMessage = formatSuccess({
      message: "Calculating Nori statistics... (Ctrl-C to exit early)\n\n",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expectedMessage);
  });

  it("should exit silently when no installation found (no output)", async () => {
    // Mock no installations found
    vi.spyOn(pathUtils, "getInstallDirs").mockReturnValue([]);

    const { main } = await import("./statistics-notification.js");

    // Should not throw, should exit gracefully
    await expect(main()).resolves.not.toThrow();

    // Should not output anything when no installation found (silent failure)
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
