import { describe, it, expect } from "vitest";

import { isNonInteractiveEnvironment } from "./nonInteractive.js";

const ttyStdin = { isTTY: true };
const pipedStdin = { isTTY: false };

describe("isNonInteractiveEnvironment", () => {
  it("returns true when CI is set to a truthy value", () => {
    expect(
      isNonInteractiveEnvironment({ env: { CI: "true" }, stdin: ttyStdin }),
    ).toBe(true);
    expect(
      isNonInteractiveEnvironment({ env: { CI: "1" }, stdin: ttyStdin }),
    ).toBe(true);
  });

  it("returns false when CI is set to a falsy string value", () => {
    expect(
      isNonInteractiveEnvironment({ env: { CI: "" }, stdin: ttyStdin }),
    ).toBe(false);
    expect(
      isNonInteractiveEnvironment({ env: { CI: "0" }, stdin: ttyStdin }),
    ).toBe(false);
    expect(
      isNonInteractiveEnvironment({ env: { CI: "false" }, stdin: ttyStdin }),
    ).toBe(false);
  });

  it("returns true when stdin is not a TTY", () => {
    expect(isNonInteractiveEnvironment({ env: {}, stdin: pipedStdin })).toBe(
      true,
    );
  });

  it("returns true when stdin.isTTY is undefined", () => {
    expect(
      isNonInteractiveEnvironment({ env: {}, stdin: { isTTY: undefined } }),
    ).toBe(true);
  });

  it("returns false when stdin is a TTY and no interactive-blocking env is set", () => {
    expect(isNonInteractiveEnvironment({ env: {}, stdin: ttyStdin })).toBe(
      false,
    );
  });
});
