export interface Tool<TArgs = any> {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    }

    requiresApproval?: boolean | ((args: TArgs) => boolean);
    execute: (
        args: TArgs,
        onChunk?: (chunk: string) => void,
        signal?: AbortSignal
    ) => Promise<ToolResult> | ToolResult;
}

export interface ToolResult {
    content: string;
    summary?: string;
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
    providerMetadata?: Record<string, any>;
}