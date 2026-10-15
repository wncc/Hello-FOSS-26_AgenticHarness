import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { Tool, ToolResult } from '../types/tool.js';

const MAX_OUTPUT_CHARS = 30_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface TerminalArgs {
    command: string;
    cwd?: string;
    timeoutMs?: number;
}

export function createTerminalTool(projectRoot: string): Tool<TerminalArgs> {
    return {
        name: 'execute_command',
        description:
            'Executes a shell command in the project environment and returns its exit code, stdout, and stderr. ' +
            'Use this to run builds, tests, git commands, scripts, or inspect directory contents. ' +
            'Avoid running interactive commands (pass non-interactive flags like -y or -m).',
        requiresApproval: true,
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The shell command to execute, e.g. "npm test", "git status", "ls -la"',
                },
                cwd: {
                    type: 'string',
                    description: 'Optional working directory relative to project root. Defaults to project root.',
                },
                timeoutMs: {
                    type: 'number',
                    description: 'Optional execution timeout in milliseconds (default: 60000).',
                },
            },
            required: ['command'],
        },
        execute: async ({ command, cwd, timeoutMs = DEFAULT_TIMEOUT_MS }, onChunk?: (chunk: string) => void, signal?: AbortSignal): Promise<ToolResult> => {
            const trimmedCommand = command?.trim();
            if (!trimmedCommand) {
                return { content: 'Error: No command provided to execute.' };
            }

            if (signal?.aborted) {
                throw new DOMException('Operation cancelled', 'AbortError');
            }

            // Resolve and validate target working directory
            let targetCwd = projectRoot;
            if (cwd) {
                const resolved = path.resolve(projectRoot, cwd);
                const relative = path.relative(projectRoot, resolved);
                if (relative.startsWith('..') || path.isAbsolute(relative)) {
                    return { content: `Error: cwd "${cwd}" escapes the project root.` };
                }
                if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
                    return { content: `Error: cwd "${cwd}" does not exist or is not a directory.` };
                }
                targetCwd = resolved;
            }

            return new Promise<ToolResult>((resolve, reject) => {
                const isWindows = process.platform === 'win32';
                const shell = isWindows
                    ? 'powershell.exe'
                    : (process.env.SHELL || '/bin/bash');

                const shellArgs = isWindows
                    ? ['-NoProfile', '-NonInteractive', '-Command', trimmedCommand]
                    : ['-c', trimmedCommand];

                let stdoutBuf = '';
                let stderrBuf = '';
                let timedOut = false;
                let cancelled = false;
                let finished = false;

                const proc = spawn(shell, shellArgs, {
                    cwd: targetCwd,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    detached: !isWindows,
                    env: {
                        ...process.env,
                        CI: 'true',
                        PAGER: 'cat',
                        GIT_PAGER: 'cat',
                        TERM: 'dumb',
                    },
                });

                const appendOutput = (data: Buffer, isStderr: boolean) => {
                    const text = data.toString('utf-8');

                    if (isStderr) {
                        stderrBuf += text;
                    } else {
                        stdoutBuf += text;
                    }

                    try {
                        onChunk?.(text);
                    } catch {
                        // Ignore streaming callback errors.
                    }
                };

                proc.stdout?.on('data', (data: Buffer) => appendOutput(data, false));
                proc.stderr?.on('data', (data: Buffer) => appendOutput(data, true));

                const timeout = setTimeout(() => {
                    timedOut = true;
                    terminateProcess();
                }, timeoutMs);

                function cleanup() {
                    clearTimeout(timeout);
                    signal?.removeEventListener('abort', handleAbort);
                }

                function terminateProcess() {
                    try {
                        if (isWindows && proc.pid) {
                            const killer = spawn(
                                'taskkill',
                                ['/PID', String(proc.pid), '/T', '/F'],
                                { stdio: 'ignore', windowsHide: true }
                            );
                            killer.on('error', () => {
                                try {
                                    proc.kill();
                                } catch {
                                    // Process may already have exited.
                                }
                            });
                        } else if (proc.pid && !proc.killed) {
                            // Kill the shell and its child processes on POSIX systems.
                            try {
                                process.kill(-proc.pid, 'SIGTERM');
                            } catch {
                                proc.kill('SIGTERM');
                            }
                        }
                    } catch {
                        try {
                            proc.kill();
                        } catch {
                            // Process may already have exited.
                        }
                    }
                }

                function handleAbort() {
                    if (finished) return;

                    cancelled = true;
                    terminateProcess();
                }

                signal?.addEventListener('abort', handleAbort, { once: true });

                if (signal?.aborted) {
                    handleAbort();
                }

                function truncate(text: string, maxChars: number): string {
                    const trimmed = text.trim();

                    if (trimmed.length <= maxChars) {
                        return trimmed || '(none)';
                    }

                    const head = trimmed.slice(0, Math.floor(maxChars * 0.3));
                    const tail = trimmed.slice(-Math.floor(maxChars * 0.6));

                    return `${head}\n\n[...truncated (${trimmed.length} total chars)...]\n\n${tail}`;
                }

                proc.on('close', (code) => {
                    if (finished) return;
                    finished = true;
                    cleanup();

                    if (cancelled || signal?.aborted) {
                        reject(new DOMException('Operation cancelled', 'AbortError'));
                        return;
                    }

                    const exitCode = timedOut ? 124 : (code ?? 0);
                    const cwdSuffix = cwd ? ` (in ${cwd})` : '';

                    const statusLine = timedOut
                        ? `TIMED OUT after ${timeoutMs / 1000}s`
                        : exitCode === 0
                            ? 'SUCCESS'
                            : `FAILED (exit code ${exitCode})`;

                    const formattedStdout = truncate(stdoutBuf, MAX_OUTPUT_CHARS / 2);
                    const formattedStderr = truncate(stderrBuf, MAX_OUTPUT_CHARS / 2);

                    resolve({
                        content:
                            `Status: ${statusLine}\n` +
                            `Exit Code: ${exitCode}\n\n` +
                            `--- STDOUT ---\n${formattedStdout}\n\n` +
                            `--- STDERR ---\n${formattedStderr}`,
                        summary: `$ ${trimmedCommand}${cwdSuffix} [${statusLine}]`,
                    });
                });

                proc.on('error', (err) => {
                    if (finished) return;
                    finished = true;
                    cleanup();

                    if (cancelled || signal?.aborted) {
                        reject(new DOMException('Operation cancelled', 'AbortError'));
                        return;
                    }

                    resolve({
                        content: `Failed to spawn command process: ${err.message}`,
                        summary: `$ ${trimmedCommand} [failed to start]`,
                    });
                });
            });
        },
    };
}
