import type { MessageTime, MessageTimeKind } from "./message-times";

const LABEL_VERB: Record<MessageTimeKind, string> = {
  sent: "Sent",
  arrived: "",
  finished: "Finished",
  stopped: "Stopped",
  failed: "Failed",
};

const FULL_VERB: Record<MessageTimeKind, string> = { ...LABEL_VERB, arrived: "Arrived" };

// Intl.DateTimeFormat is slow to build, and a scan formats every visible message.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  locale: string | undefined,
  name: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${name}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, cached);
  }
  return cached;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function withVerb(verb: string, text: string): string {
  return verb ? `${verb} ${text}` : text;
}

/** The short label under a message, such as "Sent 2:10 PM" or "Sent Oct 29, 2:10 PM". */
export function formatLabel(time: MessageTime, now: Date, locale?: string): string {
  const date = new Date(time.at);
  const clock = formatter(locale, "clock", { hour: "numeric", minute: "2-digit" }).format(date);
  if (isSameLocalDay(date, now)) return withVerb(LABEL_VERB[time.kind], clock);

  const day =
    date.getFullYear() === now.getFullYear()
      ? formatter(locale, "day", { month: "short", day: "numeric" }).format(date)
      : formatter(locale, "day-year", { month: "short", day: "numeric", year: "numeric" }).format(
          date,
        );
  return withVerb(LABEL_VERB[time.kind], `${day}, ${clock}`);
}

/** The full date and time that replaces the label on hover. */
export function formatFull(time: MessageTime, locale?: string): string {
  const full = formatter(locale, "full", { dateStyle: "full", timeStyle: "long" }).format(
    new Date(time.at),
  );
  return withVerb(FULL_VERB[time.kind], full);
}
