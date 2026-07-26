import { createApp, type Application } from "@ai-chat-platform/bootstrap";

let appPromise: Promise<Application> | null = null;

/**
 * Next.js route handlers are stateless functions, but this module stays
 * resident for the life of the server process, so the composed app (and
 * its in-memory conversation/session state) is built once and reused
 * across requests instead of being rebuilt per request.
 */
export function getApp(): Promise<Application> {
  if (!appPromise) {
    appPromise = createApp().then((app) => {
      app.start();
      return app;
    });
  }

  return appPromise;
}
