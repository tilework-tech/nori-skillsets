import { normalizeUrl } from "@/utils/url.js";

import { ConfigManager } from "./base.js";

const DEFAULT_ANALYTICS_URL = "https://demo.tilework.tech";

export type GenerateDailyReportRequest = {
  date?: string | null;
};

export type GenerateDailyReportResponse = {
  reportId: string;
  content: string;
  artifactCount: number;
  tokensUsed?: number | null;
};

export type GenerateUserReportRequest = {
  userEmail: string;
};

export type GenerateUserReportResponse = {
  content: string;
  artifactCount: number;
  tokensUsed?: number | null;
  firstActivityDate?: string | null;
  lastActivityDate?: string | null;
};

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

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      return { success: false };
    }

    return (await response.json()) as TrackEventResponse;
  },
};
