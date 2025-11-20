/**
 * Google Analytics tracking for plugin installer
 * Proxies events through the backend to keep GA4 secrets secure
 */

import { analyticsApi } from "@/api/analytics.js";
import { loadDiskConfig } from "@/installer/config.js";

/**
 * Track analytics event
 * @param args - Event arguments
 * @param args.eventName - Name of the event to track
 * @param args.eventParams - Optional parameters to include with the event
 */
export const trackEvent = async (args: {
  eventName: string;
  eventParams?: Record<string, any> | null;
}): Promise<void> => {
  const { eventName, eventParams } = args;

  try {
    // Load user email from config
    // Analytics uses cwd as installDir since it's called at runtime from CLI
    const installDir = process.cwd();
    const diskConfig = await loadDiskConfig({ installDir });
    const currentUserEmail = diskConfig?.auth?.username || null;

    // Send to backend analytics proxy (fire and forget)
    await analyticsApi.trackEvent({
      clientId: "plugin-installer",
      userId: currentUserEmail,
      eventName,
      eventParams: {
        ...eventParams,
        tilework_event_user_id: currentUserEmail,
        tilework_user_id: currentUserEmail,
      },
    });
  } catch (error) {
    // Silent failure - analytics should never block installation
  }
};
