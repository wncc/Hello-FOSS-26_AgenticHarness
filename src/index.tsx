import React from 'react';
import { render } from 'ink';
import App from './tui/App.js';
import { Agent, createCodingAgent } from './ai/agent.js';
import { createWriteFileTool } from './tools/writeFile.js';
import { getProjectRoot } from './utils/workspace.js';
import { BrowserDaemon } from './browser/daemon.js';

import { loadSession } from './ai/session.js';

async function main() {
    const isHeaded = process.argv.includes('--headed');
    BrowserDaemon.getInstance({ headless: !isHeaded });

    const projectRoot = await getProjectRoot();
    const agent = createCodingAgent(projectRoot);
    await render(<App agent={agent} projectRoot={projectRoot} />, { exitOnCtrlC: false });
    
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
