import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, ChatResponse, ChatService } from "../types/chat.js";
import type { Tool } from "../types/tool.js";

process.env.GEMINI_API_KEY ??= "test-key";
const { Agent } = await import("./agent.js");
const { createTerminalTool } = await import("../tools/terminal.js");
class FakeChatService implements ChatService {
    private responses: ChatResponse[];

    constructor(responses: ChatResponse[]) {
        this.responses = [...responses];
    }

    async chat(
        _messages: ChatMessage[],
    ): Promise<ChatResponse> {
        const response = this.responses.shift();
        if (!response) {
            throw new Error("No fake response configured");
        }
        return response;
    }
}

test("tracks token usage across turns and handles missing usage", async () => {
    const agent = new Agent({
        chatService: new FakeChatService([
            {
                content: "First answer",
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
            },
            {
                content: "Second answer",
                usage: {
                    promptTokens: 7,
                    completionTokens: 3,
                    totalTokens: 10,
                },
            },
            { content: "Third answer" },
        ]),
    });

    await agent.prompt("First question");
    await agent.prompt("Second question");
    await agent.prompt("Third question");

    const stats = agent.getState().stats;

    assert.equal(stats.totalTurns, 3);
    assert.equal(stats.totalRequests, 3);
    assert.equal(stats.promptTokens, 17);
    assert.equal(stats.completionTokens, 8);
    assert.equal(stats.totalTokens, 25);
    assert.equal(stats.lastRequestInputTokens, undefined);
});


test("counts multiple model requests within one tool-using turn", async () => {
    const testTool: Tool = {
        name: "test_tool",
        description: "A tool used for testing",
        parameters: {
            type: "object",
            properties: {},
        },
        execute: async () => ({
            content: "Tool executed successfully",
        }),
    };

    const agent = new Agent({
        tools: [testTool],
        chatService: new FakeChatService([
            {
                content: null,
                toolCalls: [
                    {
                        id: "call_test_1",
                        name: "test_tool",
                        arguments: {},
                    },
                ],
                usage: {
                    promptTokens: 4,
                    completionTokens: 2,
                    totalTokens: 6,
                },
            },
            {
                content: "The tool executed successfully.",
                usage: {
                    promptTokens: 8,
                    completionTokens: 3,
                    totalTokens: 11,
                },
            },
        ]),
    });

    await agent.prompt("Run the test tool.");

    const stats = agent.getState().stats;

    assert.equal(stats.totalTurns, 1);
    assert.equal(stats.totalRequests, 2);
    assert.equal(stats.promptTokens, 12);
    assert.equal(stats.completionTokens, 5);
    assert.equal(stats.totalTokens, 17);
    assert.equal(stats.lastRequestInputTokens, 8);
});

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
