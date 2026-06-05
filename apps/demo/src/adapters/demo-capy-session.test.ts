import type { StreamEvent } from "@capybudget/intelligence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapySession } from "./demo-capy-session";

afterEach(() => {
  vi.useRealTimers();
});

function makeSession(events: StreamEvent[]): CapySession {
  return new CapySession({
    budgetPath: "/demo",
    mcpServerPath: "",
    systemPrompt: "anything — the demo stub only ever chats",
    onEvent: (e) => events.push(e),
  });
}

describe("CapySession (demo stub)", () => {
  it("emits a chat response: a donut chart and a desktop-only notice", async () => {
    vi.useFakeTimers();
    const events: StreamEvent[] = [];
    const session = makeSession(events);

    const done = session.send("What can you help me with?");
    await vi.runAllTimersAsync();
    await done;

    const final = events.filter((e) => e.type === "content").at(-1);
    expect(final?.type).toBe("content");
    const blocks = final?.type === "content" ? final.blocks : [];

    expect(blocks.some((b) => b.type === "donut-chart")).toBe(true);
    expect(
      blocks.some(
        (b) =>
          b.type === "text" &&
          b.content.includes("only available in the desktop app"),
      ),
    ).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
