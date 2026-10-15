import path from 'node:path';
import fs from 'node:fs';
import { Tool } from '../types/tool.js';
import { resolveInProject } from '../utils/workspace.js';

interface WriteFileArgs {
    path: string;
    content: string;
}

export function createWriteFileTool(projectRoot: string): Tool<WriteFileArgs> {
    return {
        name: 'write_file',
        description: 'Writes or overwrites text content to a file at given relative path.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'The relative file path (e.g. "src/test.txt" or "notes.md")',
                },
                content: {
                    type: 'string',
                    description: 'The text content to write into the file',
                },
            },
            required: ['path', 'content'],
        },
        execute: async ({ path: filePath, content }) => {
            try {
                const resolvedPath = resolveInProject(projectRoot, filePath);
                if (!resolvedPath) {
                    return { content: `Error: "${filePath}" escapes the project root.` };
                }
                fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
                fs.writeFileSync(resolvedPath, content, 'utf-8');
                return {
                    content: `Successfully wrote ${content.length} bytes to ${filePath}`,
                    summary: `${filePath} [${content.length} bytes]`,
                };
            } catch (error: any) {
                return {
                    content: `Error writing file: ${error.message}`,
                };
            }
        },
    }
};
