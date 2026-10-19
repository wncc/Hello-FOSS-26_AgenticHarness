import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, ChatResponse, ChatService } from "../types/chat.js";
import type { Tool } from "../types/tool.js";

process.env.GEMINI_API_KEY ??= "test-key";
const { Agent } = await import("./agent.js");

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
