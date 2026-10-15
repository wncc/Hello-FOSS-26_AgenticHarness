import fs from 'node:fs';
import { Tool, ToolResult } from '../types/tool.js';
import { resolveInProject } from '../utils/workspace.js';

interface EditFileArgs {
    path: string;
    oldString: string;
    newString: string;
}

export function createEditFileTool(projectRoot: string): Tool<EditFileArgs> {
    return {
        name: 'edit_file',
        description: 'Replaces an exact snippet of code (oldString) with new replacement code (newString) in an existing file. oldString must uniquely match a single location in the file. Always read the file first to get the exact code.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'The relative file path (e.g. "src/index.tsx")',
                },
                oldString: {
                    type: 'string',
                    description: 'The exact existing code snippet to replace. Must be unique in the file.',
                },
                newString: {
                    type: 'string',
                    description: 'The new replacement code to insert in place of oldString.',
                },
            },
            required: ['path', 'oldString', 'newString'],
        },
        execute: async ({ path: filePath, oldString, newString }): Promise<ToolResult> => {
            try {
                const resolvedPath = resolveInProject(projectRoot, filePath);
                if (!resolvedPath) {
                    return { content: `Error: "${filePath}" escapes the project root.` };
                }

                if (!fs.existsSync(resolvedPath)) {
                    return { content: `Error: File "${filePath}" does not exist. Use write_file to create new files.` };
                }

                if (fs.statSync(resolvedPath).isDirectory()) {
                    return { content: `Error: "${filePath}" is a directory, not a file.` };
                }

                const rawContent = fs.readFileSync(resolvedPath, 'utf-8');

                // Normalize line endings to \n to ensure reliable matching across Windows/Linux
                const normalize = (s: string) => s.replace(/\r\n/g, '\n');
                const content = normalize(rawContent);
                const target = normalize(oldString);
                const replacement = normalize(newString);

                if (!content.includes(target)) {
                    return {
                        content: `Error: oldString was not found in "${filePath}". Please use read_file to inspect the exact current code and whitespace before editing.`,
                    };
                }

                // Check for uniqueness
                const occurrences = content.split(target).length - 1;
                if (occurrences > 1) {
                    return {
                        content: `Error: oldString was found ${occurrences} times in "${filePath}". Please include a few more lines of surrounding context to make it uniquely identifiable.`,
                    };
                }

                const updatedContent = content.replace(target, replacement);
                fs.writeFileSync(resolvedPath, updatedContent, 'utf-8');

                return {
                    content: `Successfully replaced unique instance of target code in ${filePath}.`,
                    summary: `${filePath} [Edited snippet]`,
                };
            } catch (error: any) {
                return { content: `Error editing file: ${error.message}` };
            }
        },
    };
}
