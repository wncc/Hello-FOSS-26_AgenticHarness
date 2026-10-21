import { Tool } from '../types/tool.js';
import { web_search, fetch_markdown } from './search.js';
import { navigate, click, type as typeText, screenshot } from '../browser/actions.js';

const maxCharsParameter = {
  type: 'integer',
  minimum: 1,
  description: 'Optional hard limit for the complete returned accessibility snapshot, in characters.',
};
const includeUrlsParameter = {
  type: 'boolean',
  description: 'Include link destination URLs in the tree. Defaults to false to reduce output size.',
};

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Searches the web using Tavily API. Use this to find documentation, answers, or links.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query' } },
    required: ['query'],
  },
  execute: async (args: { query: string }) => {
    try {
      const results = await web_search(args.query);
      return { content: JSON.stringify(results, null, 2), summary: `Searched for: "${args.query}"` };
    } catch (err: unknown) {
      return { content: `Search Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const readUrlTool: Tool = {
  name: 'read_url',
  description: 'Fetches a URL and returns its main content converted to Markdown.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
  execute: async (args: { url: string }) => {
    try {
      const content = await fetch_markdown(args.url);
      return { content, summary: `Read URL: ${args.url}` };
    } catch (err: unknown) {
      return { content: `Error reading URL: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const browserNavigateTool: Tool = {
  name: 'browser_navigate',
  description:
    'Opens a headless browser and returns a compacted accessibility tree. Optionally scope output with a CSS selector and set a character limit.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      selector: {
        type: 'string',
        description: 'Optional CSS selector to scope output (e.g. "main", "article", "header", "[role=main]", "#content").',
      },
      maxChars: maxCharsParameter,
      includeUrls: includeUrlsParameter,
    },
    required: ['url'],
  },
  execute: async (args: { url: string; selector?: string; maxChars?: number; includeUrls?: boolean }) => {
    try {
      const tree = await navigate(args.url, args.selector, args.maxChars, args.includeUrls);
      return {
        content: tree,
        summary: args.selector
          ? `Navigated to ${args.url} (scope: ${args.selector})`
          : `Navigated to ${args.url}`,
      };
    } catch (err: unknown) {
      return { content: `Navigation Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const browserClickTool: Tool = {
  name: 'browser_click',
  description:
    'Clicks an element using its ARIA role and accessible name, then returns the compacted accessibility tree. Optionally scope output and set its character limit.',
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', description: 'The ARIA role of the element (e.g. "link", "button").' },
      name: { type: 'string', description: 'The accessible name of the element (e.g. "Learn more").' },
      selector: {
        type: 'string',
        description: 'Optional CSS selector to scope the returned tree (e.g. "main", "article", "[role=main]").',
      },
      maxChars: maxCharsParameter,
      includeUrls: includeUrlsParameter,
    },
    required: ['role', 'name'],
  },
  execute: async (args: { role: string; name: string; selector?: string; maxChars?: number; includeUrls?: boolean }) => {
    try {
      const tree = await click(args.role, args.name, args.selector, args.maxChars, args.includeUrls);
      return { content: tree, summary: `Clicked ${args.role} "${args.name}"` };
    } catch (err: unknown) {
      return { content: `Click Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const browserTypeTool: Tool = {
  name: 'browser_type',
  description:
    'Fills an input using its ARIA role and accessible name, then returns the compacted accessibility tree. Optionally scope output and set its character limit.',
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', description: 'The ARIA role of the element (e.g. "textbox", "searchbox").' },
      name: { type: 'string', description: 'The accessible name of the element.' },
      text: { type: 'string', description: 'The text to type.' },
      selector: {
        type: 'string',
        description: 'Optional CSS selector to scope the returned tree (e.g. "main", "form", "[role=main]").',
      },
      maxChars: maxCharsParameter,
      includeUrls: includeUrlsParameter,
    },
    required: ['role', 'name', 'text'],
  },
  execute: async (args: { role: string; name: string; text: string; selector?: string; maxChars?: number; includeUrls?: boolean }) => {
    try {
      const tree = await typeText(args.role, args.name, args.text, args.selector, args.maxChars, args.includeUrls);
      return { content: tree, summary: `Typed into ${args.role} "${args.name}"` };
    } catch (err: unknown) {
      return { content: `Type Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const browserScreenshotTool: Tool = {
  name: 'browser_screenshot',
  description: 'Takes a screenshot of the current browser page. It is saved directly to disk in the ./screenshots folder.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Optional custom filename (e.g. weather.png). If omitted, a timestamped name is used.' },
    },
  },
  execute: async (args: { filename?: string }) => {
    try {
      const result = await screenshot(args.filename);
      return { content: JSON.stringify(result, null, 2), summary: `Screenshot saved to ${result.filename}` };
    } catch (err: unknown) {
      return { content: `Screenshot Error: ${err instanceof Error ? err.message : String(err)}` };
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
