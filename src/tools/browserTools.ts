import { Tool } from '../types/tool.js';
import { web_search, fetch_markdown } from './search.js';
import { navigate, click, type as typeText, screenshot } from '../browser/actions.js';

export const webSearchTool: Tool = {
    name: 'web_search',
    description: 'Searches the web using the configured search provider (Tavily, DuckDuckGo, or Mock). Use this to find documentation, answers, or links.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The search query',
            },
        },
        required: ['query'],
    },
    execute: async (args: { query: string }) => {
        try {
            const results = await web_search(args.query);
            return {
                content: JSON.stringify(results, null, 2),
                summary: `Searched for: "${args.query}"`,
            };
        } catch (err: any) {
            return { content: `Search Error: ${err.message}` };
        }
    },
};

export const readUrlTool: Tool = {
    name: 'read_url',
    description: 'Fetches a URL and returns its main content converted to Markdown.',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string' },
        },
        required: ['url'],
    },
    execute: async (args: { url: string }) => {
        try {
            const content = await fetch_markdown(args.url);
            return {
                content,
                summary: `Read URL: ${args.url}`,
            };
        } catch (err: any) {
            return { content: `Error reading URL: ${err.message}` };
        }
    },
};

export const browserNavigateTool: Tool = {
    name: 'browser_navigate',
    description: 'Opens a headless browser and navigates to a URL. Returns the accessibility DOM tree (ARIA Snapshot YAML).',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string' },
        },
        required: ['url'],
    },
    execute: async (args: { url: string }) => {
        try {
            const tree = await navigate(args.url);
            return {
                content: tree,
                summary: `Navigated to ${args.url}`,
            };
        } catch (err: any) {
            return { content: `Navigation Error: ${err.message}` };
        }
    },
};

export const browserClickTool: Tool = {
    name: 'browser_click',
    description: 'Clicks an element in the browser using its role and name (as seen in the ARIA Snapshot). Returns updated accessibility tree.',
    parameters: {
        type: 'object',
        properties: {
            role: { type: 'string', description: 'The ARIA role of the element (e.g. "link", "button")' },
            name: { type: 'string', description: 'The accessible name of the element (e.g. "Learn more")' }
        },
        required: ['role', 'name'],
    },
    execute: async (args: { role: string, name: string }) => {
        try {
            const tree = await click(args.role, args.name);
            return {
                content: tree,
                summary: `Clicked ${args.role} "${args.name}"`,
            };
        } catch (err: any) {
            return { content: `Click Error: ${err.message}` };
        }
    },
};

export const browserTypeTool: Tool = {
    name: 'browser_type',
    description: 'Types text into an input element using its role and name. Returns updated accessibility tree.',
    parameters: {
        type: 'object',
        properties: {
            role: { type: 'string', description: 'The ARIA role of the element (e.g. "textbox", "searchbox")' },
            name: { type: 'string', description: 'The accessible name of the element' },
            text: { type: 'string', description: 'The text to type' },
        },
        required: ['role', 'name', 'text'],
    },
    execute: async (args: { role: string; name: string; text: string }) => {
        try {
            const tree = await typeText(args.role, args.name, args.text);
            return {
                content: tree,
                summary: `Typed into ${args.role} "${args.name}"`,
            };
        } catch (err: any) {
            return { content: `Type Error: ${err.message}` };
        }
    },
};

export const browserScreenshotTool: Tool = {
    name: 'browser_screenshot',
    description: 'Takes a screenshot of the current browser page. It is saved directly to disk in the ./screenshots folder.',
    parameters: {
        type: 'object',
        properties: {
            filename: { type: 'string', description: 'Optional custom filename (e.g. weather.png). If omitted, a timestamped name is used.' }
        }
    },
    execute: async (args: { filename?: string }) => {
        try {
            const result = await screenshot(args.filename);
            return {
                content: JSON.stringify(result, null, 2),
                summary: `Screenshot saved to ${result.filename}`,
            };
        } catch (err: any) {
            return { content: `Screenshot Error: ${err.message}` };
        }
    },
};

export const browserTools = [
    webSearchTool,
    readUrlTool,
    browserNavigateTool,
    browserClickTool,
    browserTypeTool,
    browserScreenshotTool,
];
