import { Tool, ToolCall, ToolResult } from '../types/tool.js';

/**
 * Handles tool lookup, execution, and error containment.
 */
export class ToolRunner {
    constructor(private tools: Tool[] = []) {}

    public getTool(name: string): Tool | undefined {
        return this.tools.find((t) => t.name === name);
    }

    public async execute(
        toolCall: ToolCall,
        onChunk?: (chunk: string) => void,
        signal?: AbortSignal
    ): Promise<ToolResult> {
        if (signal?.aborted) {
            throw new DOMException('Operation cancelled', 'AbortError');
        }

        const tool = this.getTool(toolCall.name);

        if (!tool) {
            return { content: `Error: Tool "${toolCall.name}" not found.` };
        }

        try {
            const result = await tool.execute(
                toolCall.arguments,
                onChunk,
                signal
            );

            if (signal?.aborted) {
                throw new DOMException('Operation cancelled', 'AbortError');
            }

            return result;
        } catch (err: unknown) {
            if (
                signal?.aborted ||
                (err instanceof Error && err.name === 'AbortError')
            ) {
                throw err;
            }

            const message = err instanceof Error ? err.message : String(err);

            return {
                content: `Error executing "${toolCall.name}": ${message}`,
            };
        }
    }
}