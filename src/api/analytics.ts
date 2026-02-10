import { normalizeUrl } from "@/utils/url.js";

import { ConfigManager } from "./base.js";

const DEFAULT_ANALYTICS_URL = "https://demo.tilework.tech";

export type TrackEventRequest = {
  clientId: string;
  userId?: string | null;
  eventName: string;
  eventParams?: Record<string, any> | null;
};

export type TrackEventResponse = {
  success: boolean;
};

export const analyticsApi = {
  trackEvent: async (args: TrackEventRequest): Promise<TrackEventResponse> => {
    const config = ConfigManager.loadConfig();
    const baseUrl = config?.organizationUrl ?? DEFAULT_ANALYTICS_URL;

    const url = normalizeUrl({ baseUrl, path: "/api/analytics/track" });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });

      if (!response.ok) {
        return { success: false };
      }

      return (await response.json()) as TrackEventResponse;
    } catch {
      // Analytics failures should be silent - don't interrupt user flow
      return { success: false };
    }
  },
};
