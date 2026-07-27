import { prisma } from "@ai-chat-platform/database";

import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_HANDOFF_FLOOR,
  DEFAULT_HISTORY_TURNS,
  DEFAULT_TEMPERATURE,
  PLATFORM_CONFIG_ID,
} from "./defaults";

export { PLATFORM_CONFIG_ID };

export interface AiConfig {
  id: string;
  businessId: string;
  systemPrompt: string;
  handoffFloor: number;
  historyTurns: number;
  temperature: number;
  changeType: string;
  note: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  businessId: string;
  systemPrompt: string;
  handoffFloor: number;
  historyTurns: number;
  temperature: number;
  changeType: string;
  note: string | null;
  createdAt: Date;
};

function toConfig(row: Row): AiConfig {
  return {
    id: row.id,
    businessId: row.businessId,
    systemPrompt: row.systemPrompt,
    handoffFloor: row.handoffFloor,
    historyTurns: row.historyTurns,
    temperature: row.temperature,
    changeType: row.changeType,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The "AI brain" — system prompt plus the numeric knobs that decide how
 * eagerly it hands off vs. tries to answer, and how creative it is.
 * Every change is a new immutable row (see schema comment), so this
 * table is both the live config and its own full audit trail.
 *
 * Scoped per businessId. A client with no saved config of their own
 * inherits the platform ("__platform__") default; the moment they save
 * their own change, they get their own row and are independent from
 * then on. Clients never write to or read each other's rows.
 */
export class AiConfigService {
  async getCurrent(businessId: string = PLATFORM_CONFIG_ID): Promise<AiConfig> {
    const latest = await prisma.aiConfigVersion.findFirst({
      where: { businessId },
      orderBy: { createdAt: "desc" },
    });

    if (latest) {
      return toConfig(latest);
    }

    // A client with no config of their own yet — inherit the platform
    // default instead of seeding a client-specific row. Only an explicit
    // save (update/append) creates one.
    if (businessId !== PLATFORM_CONFIG_ID) {
      return this.getCurrent(PLATFORM_CONFIG_ID);
    }

    // First ever run — seed a real baseline row so "current" always
    // exists and history has a clear starting point.
    const seeded = await prisma.aiConfigVersion.create({
      data: {
        businessId: PLATFORM_CONFIG_ID,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        handoffFloor: DEFAULT_HANDOFF_FLOOR,
        historyTurns: DEFAULT_HISTORY_TURNS,
        temperature: DEFAULT_TEMPERATURE,
        changeType: "seed",
        note: "Initial built-in configuration",
      },
    });

    return toConfig(seeded);
  }

  /** Full replace — used by the dashboard's "Update" button. */
  async update(
    businessId: string,
    systemPrompt: string,
    handoffFloor: number,
    historyTurns: number,
    temperature: number,
    note?: string
  ): Promise<AiConfig> {
    const created = await prisma.aiConfigVersion.create({
      data: {
        businessId,
        systemPrompt,
        handoffFloor,
        historyTurns,
        temperature,
        changeType: "update",
        note: note?.trim() || null,
      },
    });

    return toConfig(created);
  }

  /** Appends new instructions onto the current prompt instead of
   * replacing it — for "also always do/never do X" additions without
   * having to paste and edit the whole prompt each time. */
  async append(
    businessId: string,
    additionalText: string,
    note?: string
  ): Promise<AiConfig> {
    const current = await this.getCurrent(businessId);
    const combined = `${current.systemPrompt}\n\n${additionalText.trim()}`.trim();

    const created = await prisma.aiConfigVersion.create({
      data: {
        businessId,
        systemPrompt: combined,
        handoffFloor: current.handoffFloor,
        historyTurns: current.historyTurns,
        temperature: current.temperature,
        changeType: "append",
        note: note?.trim() || additionalText.trim().slice(0, 120),
      },
    });

    return toConfig(created);
  }

  async history(
    businessId: string = PLATFORM_CONFIG_ID,
    limit = 50
  ): Promise<AiConfig[]> {
    const rows = await prisma.aiConfigVersion.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return rows.map(toConfig);
  }
}
