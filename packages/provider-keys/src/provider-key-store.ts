import { prisma } from "@ai-chat-platform/database";

/**
 * Durable store for API keys entered through the dashboard's "activate
 * provider" form. Without this, activation only ever patched the running
 * AIManager in memory — real, but silently gone the next time the
 * process restarts (dev server reload, redeploy, crash), which isn't
 * "plug and play" no matter how the dashboard copy reads.
 */
export class ProviderKeyStore {
  /** providerId -> apiKey, for every provider that's ever been
   * activated through the dashboard. */
  async getAll(): Promise<Record<string, string>> {
    const rows = await prisma.providerApiKey.findMany();
    return Object.fromEntries(rows.map((r) => [r.providerId, r.apiKey]));
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    await prisma.providerApiKey.upsert({
      where: { providerId },
      create: { providerId, apiKey },
      update: { apiKey },
    });
  }
}
