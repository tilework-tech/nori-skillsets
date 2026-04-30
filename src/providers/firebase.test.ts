import { initializeApp } from "firebase/app";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FirebaseProvider } from "@/providers/firebase.js";

vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({ name: "[DEFAULT]" })),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
}));

describe("FirebaseProvider", () => {
  beforeEach(() => {
    // @ts-expect-error - accessing private static for test cleanup
    FirebaseProvider.instance = undefined;
    vi.clearAllMocks();
  });

  it("configures Firebase Auth with the Nori login domain", () => {
    const provider = FirebaseProvider.getInstance();
    provider.configure();

    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        authDomain: "login.noriskillsets.dev",
      }),
    );
  });
});
