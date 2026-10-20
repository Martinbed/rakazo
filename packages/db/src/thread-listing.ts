import { ACTIVE_RUN_STATUSES, BACKGROUND_RUN_TRIGGERS, plainTextFromMarkdown } from "@rakazo/core";

export const activeRunStatuses = [...ACTIVE_RUN_STATUSES];
const backgroundRunTriggers = [...BACKGROUND_RUN_TRIGGERS];
const userVisibleBotRunTriggers = ["bot_message", ...BACKGROUND_RUN_TRIGGERS];
const latestBotRunOrderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/**
 * The active runs that describe a bot's sidebar status.
 *
 * More than one, because the newest active run is not necessarily the one
 * that describes the bot. A queued run created after a running one used to
 * win on recency alone, so a bot that was mid-turn was reported as queued
 * -- and the thread lost the Stop control that the run would have given it.
 *
 * Background ticket runs keep working silently, so they are left out: they
 * must not make the avatar spin.
 */
export const activeRunSelection = {
  where: {
    status: { in: activeRunStatuses },
    trigger: { notIn: backgroundRunTriggers },
  },
  orderBy: { createdAt: "desc" as const },
  take: 8,
  select: { status: true },
} as const;

/**
 * How busy a bot is, most urgent first.
 *
 * A run waiting on the human outranks one in progress: it is the one that
 * needs an answer. A run that is actually running outranks one that is
 * merely queued: a bot with three queued messages and one turn in progress
 * is working, and saying otherwise hides it.
 */
const ACTIVE_STATUS_PRECEDENCE = [
  "waiting_input",
  "waiting_takeover",
  "running",
  "leased",
  "queued",
] as const;

/** The run that best describes a bot, given all of its active runs. */
export function pickMostAdvancedRun<T extends { status: string }>(
  runs: ReadonlyArray<T> | undefined,
): T | undefined {
  if (!runs || runs.length === 0) return undefined;
  for (const status of ACTIVE_STATUS_PRECEDENCE) {
    const hit = runs.find((run) => run.status === status);
    if (hit) return hit;
  }
  return runs[0];
}

/** The status to show for a bot, given all of its active runs. */
export function pickActiveStatus(
  runs: ReadonlyArray<{ status: string }> | undefined,
): string {
  return pickMostAdvancedRun(runs)?.status ?? "idle";
}

/** Latest user-visible run for a bot roster error signal; later success clears an older failure. */
export const latestBotRunSelection = {
  where: { trigger: { notIn: userVisibleBotRunTriggers } },
  orderBy: latestBotRunOrderBy,
  take: 1,
  select: { id: true, status: true },
} as const;

export function previewFromBlocks(blocks: unknown): string {
  const rows = Array.isArray(blocks) ? blocks : [];
  for (const block of rows) {
    if (
      block &&
      typeof block === "object" &&
      "text" in block &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      return plainTextFromMarkdown((block as { text: string }).text);
    }
  }
  return "";
}
