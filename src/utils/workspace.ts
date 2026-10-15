import path from "node:path";
import { parseArgs } from "node:util";
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
export async function getProjectRoot(): Promise<string> {
    const { values, positionals } = parseArgs({
        options: {
            dir: {
                type: 'string',
                short: 'd'
            },
        },
        allowPositionals: true,
        strict: false
    });

    const rawPath = (values.dir || positionals[0]) as string;

    if (rawPath) {
        const resolved = path.resolve(process.cwd(), rawPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            return resolved;
        }
        console.warn(`Warning: "${rawPath}" is not a valid directory. Falling back to prompt.\n`);
    }

    const rl = readline.createInterface({ input, output });
    try {
        while (true) {
            const answer = await rl.question('Enter project directory (default: current dir): ');
            const target = answer.trim() || '.';
            const resolved = path.resolve(process.cwd(), target);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                return resolved;
            }
            console.warn(`Error: "${target}" is not a valid directory. Try again.`);
        }
    } finally {
        rl.close();
        process.stdin.resume();
    }
}

const IGNORED = new Set(['node_modules', '.git', 'dist', '.env', '.DS_Store']);
export function getProjectTree(dir: string, depth = 2, currentDepth = 0, prefix = ''): string {
    if (currentDepth > depth) return '';
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
            .filter((e) => !IGNORED.has(e.name))
            .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
        let output = '';
        entries.forEach((entry, idx) => {
            const isLast = idx === entries.length - 1;
            const pointer = isLast ? '└── ' : '├── ';
            output += `${prefix}${pointer}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;
            if (entry.isDirectory()) {
                const newPrefix = prefix + (isLast ? '    ' : '│   ');
                output += getProjectTree(path.join(dir, entry.name), depth, currentDepth + 1, newPrefix);
            }
        });
        return output;
    } catch {
        return '';
    }
}

function nearestExisting(target: string): string {
    let current = target;
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) return current;
        current = parent;
    }
    return current;
}

/**
 * Resolves a tool's path argument against the project root.
 * Returns null when the result lands outside the root, so the caller can refuse it.
 * Symlinks are followed on the closest existing ancestor: a link inside the root
 * that points elsewhere must not become a way out.
 */
export function resolveInProject(projectRoot: string, target: string): string | null {
    const resolved = path.resolve(projectRoot, target);
    const root = fs.realpathSync(projectRoot);
    const relative = path.relative(root, fs.realpathSync(nearestExisting(resolved)));
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return resolved;
}
