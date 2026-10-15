import { createEditFileTool } from "../tools/editFile.js";
import { createReadFileTool } from "../tools/readFile.js";
import { createWriteFileTool } from "../tools/writeFile.js";
import { browserTools } from "../tools/browserTools.js";
import { createSearchFilesTool } from "../tools/searchFiles.js";
import { createTerminalTool } from "../tools/terminal.js";
import {
    AgentEvent,
    AgentListener,
    AgentState,
    AgentStatus,
    ApprovalDecision,
    ChatMessage,
    ChatResponse,
    ChatService,
} from "../types/chat.js";
import { Tool, ToolCall, ToolResult } from "../types/tool.js";
import { SessionPermissionManager } from "../utils/permissions.js";
import { getProjectTree } from "../utils/workspace.js";
import { OpenAiChatService } from "./chat.js";
import { ToolRunner } from "./toolRunner.js";

export interface AgentOptions {
    chatService?: ChatService;
    tools?: Tool[];
    systemPrompt?: string;
    permissionManager?: SessionPermissionManager;
    initialMessages?: ChatMessage[];
}

export class Agent {
    private chatService: ChatService;
    private tools: Tool[];
    private toolRunner: ToolRunner;
    private permissionManager: SessionPermissionManager;
    private messages: ChatMessage[] = [];
    private status: AgentStatus = 'idle';
    private activeToolName?: string;
    private activeAbortController?: AbortController;
    private error?: string;
    private listeners: Set<AgentListener> = new Set();

    constructor(options: AgentOptions = {}) {
        this.chatService = options.chatService ?? new OpenAiChatService();
        this.tools = options.tools ?? [];
        this.toolRunner = new ToolRunner(this.tools);
        this.permissionManager = options.permissionManager ?? new SessionPermissionManager();

       if (options.initialMessages && options.initialMessages.length > 0) {
         this.messages = [...options.initialMessages ];
}      else if (options.systemPrompt) {
         this.messages.push({ role: 'system', content: options.systemPrompt });
}
    }

    public getState(): AgentState {
        return {
            messages: [...this.messages],
            status: this.status,
            activeToolName: this.activeToolName,
            error: this.error,
        };
    }

    public subscribe(listener: AgentListener): () => void {
        this.listeners.add(listener);
        listener(this.getState());

        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify() {
        const state = this.getState();
        for (const listener of this.listeners) {
            listener(state);
        }
    }

    private setStatus(status: AgentStatus, extra?: { activeToolName?: string; error?: string }) {
        this.status = status;
        this.activeToolName = extra?.activeToolName;
        this.error = extra?.error;
        this.notify();
    }

    private isBusy(): boolean {
        return this.status === 'thinking' || this.status === 'executing_tool' || this.status === 'awaiting_approval';
    }

    public cancel(): void {
        if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
            this.activeAbortController.abort();
        }
    }

    private needsApproval(toolCall: ToolCall): boolean {
        const tool = this.toolRunner.getTool(toolCall.name);
        if (!tool) return false;

        const requires = typeof tool.requiresApproval === 'function'
            ? tool.requiresApproval(toolCall.arguments)
            : Boolean(tool.requiresApproval);

        return requires && !this.permissionManager.isPermitted(toolCall.name, toolCall.arguments);
    }

    private async *promptForApproval(
        toolCall: ToolCall,
        signal: AbortSignal
    ): AsyncGenerator<AgentEvent, ApprovalDecision, void> {
        this.setStatus('awaiting_approval', { activeToolName: toolCall.name });
        yield { type: 'status', status: 'awaiting_approval', activeToolName: toolCall.name };

        let resolveApproval!: (decision: ApprovalDecision) => void;
        const approvalPromise = new Promise<ApprovalDecision>((resolve) => {
            resolveApproval = resolve;
        });

        yield {
            type: 'approval_required',
            toolCall,
            resolve: resolveApproval,
        };

        const decision = await new Promise<ApprovalDecision>((resolve, reject) => {
            const cleanup = () => {
                signal.removeEventListener('abort', onAbort);
            };

            const onAbort = () => {
                cleanup();
                reject(new DOMException('Operation cancelled', 'AbortError'));
            };

            signal.addEventListener('abort', onAbort, { once: true });

            approvalPromise.then((value) => {
                cleanup();
                resolve(value);
            });

            if (signal.aborted) {
                onAbort();
            }
        });

        if (decision.approved) {
            if (decision.alwaysAllowSession) {
                this.permissionManager.grantAlwaysAllowSession();
            } else if (toolCall.arguments?.command) {
                this.permissionManager.grantCommand(toolCall.arguments.command);
            }
        }

        return decision;
    }

    private async *handleToolDenial(toolCall: ToolCall, reason?: string): AsyncGenerator<AgentEvent, void, void> {
        const denialReason = reason ? ` Reason: ${reason}` : '';
        const toolMessage: ChatMessage = {
            role: 'tool',
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: `Command execution was denied by the user.${denialReason}`,
            summary: `Denied by user: ${toolCall.arguments?.command || toolCall.name}`,
        };
        this.messages.push(toolMessage);
        yield { type: 'tool_result', toolCallId: toolCall.id, name: toolCall.name, result: toolMessage.content };
        yield { type: 'message', message: toolMessage };
    }

    private recordToolResult(toolCall: ToolCall, result: ToolResult): ChatMessage {
        const toolMessage: ChatMessage = {
            role: 'tool',
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: result.content,
            summary: result.summary,
        };
        this.messages.push(toolMessage);
        return toolMessage;
    }

    private static readonly MAX_HISTORY_MESSAGES = 40;
private static readonly TRIM_KEEP_RECENT = 20;

private trimHistoryIfNeeded(): void {
    if (this.messages.length <= Agent.MAX_HISTORY_MESSAGES) return;

    // Always keep the system message (if present) at index 0
    const hasSystemMessage = this.messages[0]?.role === 'system';
    const systemMessage = hasSystemMessage ? this.messages[0] : null;

    const startIndex = hasSystemMessage ? 1 : 0;
    const keepFrom = this.messages.length - Agent.TRIM_KEEP_RECENT;

    const olderMessages = this.messages.slice(startIndex, keepFrom);
    const recentMessages = this.messages.slice(keepFrom);

    const compactedOlder = olderMessages.map((msg) => {
        // Only compact large tool results — leave user/assistant text messages intact
        if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 300) {
            return {
                ...msg,
                content: `[Older tool result omitted to save context — was ${msg.content.length} chars. Re-run the tool if you need this again.]`,
            };
        }
        return msg;
    });

    this.messages = [
        ...(systemMessage ? [systemMessage] : []),
        ...compactedOlder,
        ...recentMessages,
    ];
}

    public async *run(
        input: string,
        onChunk?: (chunk: string) => void
    ): AsyncGenerator<AgentEvent> {
        const trimmed = input.trim();
        if (!trimmed || this.isBusy()) return;

        const controller = new AbortController();
        const signal = controller.signal;
        this.activeAbortController = controller;

        const userMessage: ChatMessage = { role: 'user', content: trimmed };
        this.messages.push(userMessage);
        this.setStatus('thinking');

        yield { type: 'message', message: userMessage };
        yield { type: 'status', status: 'thinking' };

        try {
            const MAX_STEPS = 25;
            let step = 0;

            while (step++ < MAX_STEPS) {
                if (signal.aborted) {
                    throw new DOMException('Operation cancelled', 'AbortError');
                }

                this.trimHistoryIfNeeded();

                const response: ChatResponse = await this.chatService.chat(
                    this.messages,
                    this.tools,
                    signal
                );

                if (signal.aborted) {
                    throw new DOMException('Operation cancelled', 'AbortError');
                }

                const assistantMessage: ChatMessage = {
                    role: 'assistant',
                    content: response.content,
                    toolCalls: response.toolCalls,
                    providerMetadata: response.providerMetadata,
                };
                this.messages.push(assistantMessage);
                yield { type: 'message', message: assistantMessage };

                if (!response.toolCalls || response.toolCalls.length === 0) {
                    break;
                }

                for (const toolCall of response.toolCalls) {
                    yield { type: 'tool_call', toolCall };

                    if (signal.aborted) {
                        throw new DOMException('Operation cancelled', 'AbortError');
                    }

                    // 1. Human-in-the-loop approval check
                    if (this.needsApproval(toolCall)) {
                        const decision = yield* this.promptForApproval(toolCall, signal);
                        if (!decision.approved) {
                            yield* this.handleToolDenial(toolCall, decision.reason);
                            continue;
                        }
                    }

                    // 2. Execute tool
                    this.setStatus('executing_tool', { activeToolName: toolCall.name });
                    yield { type: 'status', status: 'executing_tool', activeToolName: toolCall.name };

                    const finalResult = await this.toolRunner.execute(toolCall, onChunk, signal);

                    // 3. Record tool observation
                    const toolMessage = this.recordToolResult(toolCall, finalResult);
                    yield {
                        type: 'tool_result',
                        toolCallId: toolCall.id,
                        name: toolCall.name,
                        result: finalResult.content,
                    };
                    yield { type: 'message', message: toolMessage };
                }

                this.setStatus('thinking');
                yield { type: 'status', status: 'thinking' };
            }

            this.setStatus('idle');
            yield { type: 'status', status: 'idle' };
            yield { type: 'done' };
        } catch (err: unknown) {
            if (
                signal.aborted ||
                (err instanceof Error && err.name === 'AbortError')
            ) {
                const cancellationMessage: ChatMessage = {
                    role: 'assistant',
                    content: 'Run cancelled.',
                };

                this.messages.push(cancellationMessage);
                yield { type: 'message', message: cancellationMessage };

                this.setStatus('idle');
                yield { type: 'status', status: 'idle' };
                yield { type: 'done' };
            } else {
                const errorMessage =
                    err instanceof Error ? err.message : 'Unknown error occurred';

                this.setStatus('error', { error: errorMessage });
                yield { type: 'error', error: errorMessage };
                yield { type: 'status', status: 'error' };
            }
        } finally {
            if (this.activeAbortController === controller) {
                this.activeAbortController = undefined;
            }
        }
    }

    public async prompt(input: string): Promise<void> {
        for await (const _event of this.run(input)) {
            // Backward compatibility helper
        }
    }
}

export function createCodingAgent(projectRoot: string, initialMessages?: ChatMessage[]): Agent {
    const tree = getProjectTree(projectRoot);
    return new Agent({
        tools: [
            createWriteFileTool(projectRoot),
            createReadFileTool(projectRoot),
            createEditFileTool(projectRoot),
            createSearchFilesTool(projectRoot),
            createTerminalTool(projectRoot),
            ...browserTools,
        ],
        systemPrompt: `You are WnCC's expert agentic coding assistant.
Current Project Structure:
${tree}

Best Practices:
1. Use search_files when you need to locate functions, variables, imports, TODOs, or other code in the project. After finding relevant locations, use read_file to inspect the surrounding code.
2. Always read existing files before making edits to inspect the exact code and whitespace.
3. Use edit_file for modifying existing code. Provide the exact snippet in oldString with enough context so it is unique.
4. Only use write_file when creating completely new files or when an entire rewrite is explicitly desired. Prefer edit_file over write_file.
5. Use execute_command to run project commands (e.g. running tests, builds, linting, git commands, inspecting directory contents).
   - If running in a subdirectory, pass the relative directory in the "cwd" parameter.
   - Always run non-interactive commands. Pass flags like -y, --yes, -m where needed to avoid hanging.
   - Always inspect the returned exit code and terminal output to verify whether the command succeeded. If it failed, diagnose and fix the error.
   - Prefer using existing available tools over commands if possible.
6. After writing or editing code, ALWAYS verify your changes before considering the task complete:
   - Check the project's package.json (or equivalent config) for a "test", "build", "typecheck", or "lint" script, and run whichever ones apply to the change you made.
   - If a verification command fails, read the exact error output, diagnose the root cause, fix the code, and re-run the verification command. Repeat until it passes or you determine the failure is unrelated to your change.
   - Never tell the user a task is complete without having run and passed the relevant verification step, or explicitly explaining why verification wasn't possible (e.g. no test suite exists).
        `,
 initialMessages,
    });
}
