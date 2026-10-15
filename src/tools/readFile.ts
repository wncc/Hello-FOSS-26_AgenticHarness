import fs from 'node:fs';
import { Tool } from '../types/tool.js';
import { resolveInProject } from '../utils/workspace.js';

interface ReadFileArgs {
    path: string;
    startLine?: number;
    endLine?: number;
}

const DEFAULT_MAX_LINES = 150;

export function createReadFileTool(projectRoot: string): Tool<ReadFileArgs> {
    return {
        name: 'read_file',
        description: 'Reads content from a file with line numbers. You can specify startLine and endLine to read a specific range.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'The relative file path (eg. src/index.tsx)',
                },
                startLine: {
                    type: 'integer',
                    description: 'Optional 1-indexed starting line number. (default: 1)',
                },
                endLine: {
                    type: 'integer',
                    description: 'Optional 1-indexed ending line number (inclusive).',
                },
            },
            required: ['path'],
        },

        execute: async ({ path: filePath, startLine, endLine }) => {
            try {
                const resolvedPath = resolveInProject(projectRoot, filePath);
                if (!resolvedPath) {
                    return { content: `Error: "${filePath}" escapes the project root.` };
                }
                if (!fs.existsSync(resolvedPath)) {
                    return { content: `Error: File "${filePath}" does not exist.` };
                }
                if (fs.statSync(resolvedPath).isDirectory()) {
                    return { content: `Error: "${filePath}" is a directory, not a file.` };
                }
                const content = fs.readFileSync(resolvedPath, 'utf-8');
                const lines = content.split(/\r?\n/);
                const totalLines = lines.length;
                // 1-indexed bounds calculation
                const start = Math.max(1, startLine ?? 1);
                const defaultEnd = Math.min(totalLines, start + DEFAULT_MAX_LINES - 1);
                const end = Math.min(totalLines, endLine ?? defaultEnd);
                if (start > totalLines) {
                    return { content: `Error: startLine (${start}) exceeds total lines in file (${totalLines}).` };
                }
                if (start > end) {
                    return { content: `Error: startLine (${start}) cannot be greater than endLine (${end}).` };
                }
                // Slice is 0-indexed: line 1 is index 0
                const selectedLines = lines.slice(start - 1, end);
                const formatted = selectedLines
                    .map((line, idx) => `${start + idx}: ${line}`)
                    .join('\n');
                const hasMore = end < totalLines;
                const summary = `[Showing lines ${start}-${end} of ${totalLines} in ${filePath}${hasMore ? ` — ${totalLines - end} more lines below. Pass startLine=${end + 1} to continue reading.` : ''}]`;
                return {
                    content: `${summary}\n${formatted}`,
                    summary: `${filePath} [#L${start}-${end}]`,
                };
            } catch (error: any) {
                return { content: `Error reading file: ${error.message}` };
            }
        },
    };
}