import { Tool, ToolCall } from "./tool.js";

export type Role = 'user' | 'assistant' | 'system' | 'tool';
export type AgentStatus = 'idle' | 'thinking' | 'executing_tool' | 'awaiting_approval' | 'error';

export interface ApprovalDecision {
    approved: boolean;
    alwaysAllowSession?: boolean;
    reason?: string;
}

export interface UserMessage {
    role: 'user';
    content: string;
}

export interface SystemMessage {
    role: 'system';
    content: string;
}

export interface AssistantMessage {
    role: 'assistant';
    content: string | null;
    toolCalls?: ToolCall[];
    providerMetadata?: Record<string, any>;
}

export interface ToolMessage {
    role: 'tool';
    toolCallId: string;
    name: string;
    content: string;
    summary?: string; // Human Friendly Summary for the UI
}

export type ChatMessage =
    | UserMessage
    | SystemMessage
    | AssistantMessage
    | ToolMessage;

export interface ChatResponse {
    content: string | null;
    toolCalls?: ToolCall[];
    providerMetadata?: Record<string, any>;
}

export interface ChatService {
    chat(
        messages: ChatMessage[],
        tools?: Tool[],
        signal?: AbortSignal
    ): Promise<ChatResponse>;
}

export interface AgentState {
    messages: ChatMessage[];
    status: AgentStatus;
    activeToolName?: string;
    error?: string;
}

export type AgentListener = (state: AgentState) => void;

export type AgentEvent =
    | { type: 'status'; status: AgentStatus; activeToolName?: string }
    | { type: 'message'; message: ChatMessage }
    | { type: 'tool_call'; toolCall: ToolCall }
    | { type: 'approval_required'; toolCall: ToolCall; resolve: (decision: ApprovalDecision) => void }
    | { type: 'tool_result'; toolCallId: string; name: string; result: string }
    | { type: 'error'; error: string }
    | { type: 'done' };