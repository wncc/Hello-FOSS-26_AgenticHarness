import { openai, config } from './client.js';
import { AssistantMessage, ChatMessage, ChatResponse, ChatService } from '../types/chat.js';
import { Tool, ToolCall } from '../types/tool.js';

export interface OpenAiChatServiceOptions {

}

export class OpenAiChatService implements ChatService {

    constructor(options: OpenAiChatServiceOptions = {}) {

    }

    async chat(
        messages: ChatMessage[],
        tools?: Tool[],
        signal?: AbortSignal
    ): Promise<ChatResponse> {
        const openAiTools = tools?.map((tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        })));

        const openAiMessages = messages.map((msg) => {
            switch (msg.role) {
                case 'user':
                case 'system':
                    return {
                        role: msg.role,
                        content: msg.content,
                    };
                case 'assistant':
                    return this.toOpenAiAssistantMessage(msg);
                case 'tool':
                    return {
                        role: 'tool' as const,
                        tool_call_id: msg.toolCallId,
                        content: msg.content,
                    };
            }
        });

        const hasTerminalTool = tools?.some((tool) => tool.name === 'execute_command');

        const response = await openai.chat.completions.create(
            {
                model: config.model,
                messages: openAiMessages as any,
                tools: openAiTools?.length ? openAiTools : undefined,
                parallel_tool_calls: hasTerminalTool ? false : undefined,
            },
            { signal }
        );

        const choice = response.choices[0];
        if (!choice?.message) {
            throw new Error('No message in response');
        }

        const rawMessage = choice.message as any;
        const { role: _r, content: _c, tool_calls: _tc, ...messageExtra } = rawMessage;

        const toolCalls: ToolCall[] | undefined = choice.message.tool_calls
            ?.filter((call) => call.type === 'function')
            .map((call) => this.fromOpenAiToolCall(call));

        return {
            content: choice.message.content ?? null,
            toolCalls,
            providerMetadata: Object.keys(messageExtra).length ? messageExtra : undefined,
        };
    }

    private fromOpenAiToolCall(call: any): ToolCall {
        const { id, type, function: fn, ...callExtra } = call;
        const { name, arguments: args, ...fnExtra } = fn ?? {};

        const providerMetadata: Record<string, any> = { ...callExtra };
        if (Object.keys(fnExtra).length > 0) {
            providerMetadata.functionExtra = fnExtra;
        }

        return {
            id,
            name,
            arguments: JSON.parse(args || '{}'),
            providerMetadata: Object.keys(providerMetadata).length ? providerMetadata : undefined,
        };
    }

    private toOpenAiToolCall(tc: ToolCall) {
        const { functionExtra, ...callExtra } = tc.providerMetadata ?? {};

        return {
            id: tc.id,
            type: 'function' as const,
            function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
                ...functionExtra,
            },
            ...callExtra
        };
    }

    private toOpenAiAssistantMessage(msg: AssistantMessage) {
        return {
            role: 'assistant' as const,
            content: msg.content ?? null,
            ...msg.providerMetadata,
            tool_calls: msg.toolCalls?.length
                ? msg.toolCalls.map((tc) => this.toOpenAiToolCall(tc))
                : undefined,
        };
    }
}


