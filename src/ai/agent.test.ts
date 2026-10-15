import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "./agent.js";
import type { ChatService } from "../types/chat.js";
import { createTerminalTool } from "../tools/terminal.js";

test("cancel stops a pending chat and returns the agent to idle", async () => {
  const mockChatService: ChatService = {
    chat: (_messages, _tools, signal) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Operation cancelled", "AbortError"));
          return;
        }

        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Operation cancelled", "AbortError")),
          { once: true },
        );
      }),
  };

  const agent = new Agent({ chatService: mockChatService });
  const events = [];
  const iterator = agent.run("Test cancellation");

  // Consume the initial user-message and thinking events.
  await iterator.next();
  await iterator.next();

  // Cancel while the mock chat request is pending.
  agent.cancel();

  for await (const event of iterator) {
    events.push(event);
  }

  assert.equal(agent.getState().status, "idle");
  assert.ok(
    events.some(
      (event) =>
        event.type === "message" && event.message.content === "Run cancelled.",
    ),
    "Expected a cancellation message",
  );
  assert.ok(events.some((event) => event.type === "done"));
});

test("cancel during approval prevents tool execution", async () => {
  let toolExecuted = false;

  const mockTool = {
    name: "danger_tool",
    description: "A test tool requiring approval",
    parameters: {
      type: "object" as const,
      properties: {},
    },
    requiresApproval: true,
    execute: async () => {
      toolExecuted = true;
      return { content: "Executed" };
    },
  };

  const mockChatService: ChatService = {
    chat: async () => ({
      content: null,
      toolCalls: [
        {
          id: "test-call-1",
          name: "danger_tool",
          arguments: {},
        },
      ],
    }),
  };

  const agent = new Agent({
    chatService: mockChatService,
    tools: [mockTool],
  });

  const iterator = agent.run("Test approval cancellation");
  let approvalRequested = false;

  // Advance until the agent requests approval.
  while (true) {
    const result = await iterator.next();

    if (result.done) break;

    if (result.value.type === "approval_required") {
      approvalRequested = true;
      agent.cancel();
    }
  }

  assert.equal(approvalRequested, true);
  assert.equal(toolExecuted, false);
  assert.equal(agent.getState().status, "idle");
  assert.ok(
    agent
      .getState()
      .messages.some(
        (message) =>
          message.role === "assistant" && message.content === "Run cancelled.",
      ),
    "Expected a cancellation message",
  );
});

test("cancel stops a running terminal command", async () => {
  const tool = createTerminalTool(process.cwd());
  const controller = new AbortController();

  const abortTimer = setTimeout(() => {
    controller.abort();
  }, 500);

  try {
    const execution = Promise.resolve().then(() =>
      tool.execute(
        {
          command: `node -e 'setTimeout(() => {}, 30000)'`,
        },
        undefined,
        controller.signal,
      ),
    );

    await assert.rejects(
      execution,
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
  } finally {
    clearTimeout(abortTimer);
  }
});
