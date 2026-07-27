import { prisma } from "@ai-chat-platform/database";

import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_HANDOFF_FLOOR,
  DEFAULT_HISTORY_TURNS,
} from "./defaults";

export interface AiConfig {
  id: string;
  systemPrompt: string;
  handoffFloor: number;
  historyTurns: number;
  changeType: string;
  note: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  systemPrompt: string;
  handoffFloor: number;
  historyTurns: number;
  changeType: string;
  note: string | null;
  createdAt: Date;
};

function toConfig(row: Row): AiConfig {
  return {
    id: row.id,
    systemPrompt: row.systemPrompt,
    handoffFloor: row.handoffFloor,
    historyTurns: row.historyTurns,
    changeType: row.changeType,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The "AI brain" — system prompt plus the couple of numeric knobs that
 * decide how eagerly it hands off vs. tries to answer. Every change is
 * a new immutable row (see schema comment), so this table is both the
 * live config and its own full audit trail — nothing to keep in sync.
 */
export class AiConfigService {
  async getCurrent(): Promise<AiConfig> {
    const latest = await prisma.aiConfigVersion.findFirst({
      orderBy: { createdAt: "desc" },
    });

    if (latest) {
      return toConfig(latest);
    }

    // First ever run — seed a real baseline row so "current" always
    // exists and history has a clear starting point.
    const seeded = await prisma.aiConfigVersion.create({
      data: {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        handoffFloor: DEFAULT_HANDOFF_FLOOR,
        historyTurns: DEFAULT_HISTORY_TURNS,
        changeType: "seed",
        note: "Initial built-in configuration",
      },
    });

    return toConfig(seeded);
  }

  /** Full replace — used by the dashboard's "Update" button. */
  async update(
    systemPrompt: string,
    handoffFloor: number,
    historyTurns: number,
    note?: string
  ): Promise<AiConfig> {
    const created = await prisma.aiConfigVersion.create({
      data: {
        systemPrompt,
        handoffFloor,
        historyTurns,
        changeType: "update",
        note: note?.trim() || null,
      },
    });

    return toConfig(created);
  }

  /** Appends new instructions onto the current prompt instead of
   * replacing it — for "also always do/never do X" additions without
   * having to paste and edit the whole prompt each time. */
  async append(additionalText: string, note?: string): Promise<AiConfig> {
    const current = await this.getCurrent();
    const combined = `${current.systemPrompt}\n\n${additionalText.trim()}`.trim();

    const created = await prisma.aiConfigVersion.create({
      data: {
        systemPrompt: combined,
        handoffFloor: current.handoffFloor,
        historyTurns: current.historyTurns,
        changeType: "append",
        note: note?.trim() || additionalText.trim().slice(0, 120),
      },
    });

    return toConfig(created);
  }

  async history(limit = 50): Promise<AiConfig[]> {
    const rows = await prisma.aiConfigVersion.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return rows.map(toConfig);
  }
}
