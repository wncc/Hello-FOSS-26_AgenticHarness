import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { env } from '../config/env.js';

export interface SearchResult {
    title: string;
    url: string;
    content: string;
}

export interface ISearchProvider {
    search(query: string): Promise<SearchResult[]>;
}

export class TavilySearchProvider implements ISearchProvider {
    async search(query: string): Promise<SearchResult[]> {
        const apiKey = env.TAVILY_API_KEY || env.SEARCH_API_KEY;
        if (!apiKey) {
            throw new Error('TAVILY_API_KEY or SEARCH_API_KEY is not set');
        }

        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: apiKey,
                query: query,
                search_depth: 'basic',
                include_answer: true,
                max_results: 5,
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Tavily search failed: ${response.status} - ${text}`);
        }

        const data = await response.json();
        
        // Map Tavily results to our SearchResult interface
        const results = (data.results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            content: r.content,
        }));

        // If tavily provided a direct answer, prepend it as a synthetic result
        if (data.answer) {
            results.unshift({
                title: 'AI Answer',
                url: 'tavily://answer',
                content: data.answer,
            });
        }

        return results;
    }
}


export class DuckDuckGoSearchProvider implements ISearchProvider {
    async search(query: string): Promise<SearchResult[]> {
        const url = new URL('https://html.duckduckgo.com/html/');
        url.searchParams.set('q', query);

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
            },
        });

        if (!response.ok) {
            throw new Error(`DuckDuckGo search failed: ${response.status}`);
        }

        const html = await response.text();
        const doc = new JSDOM(html);
        const results: SearchResult[] = [];

        for (const result of doc.window.document.querySelectorAll('.result')) {
            const link = result.querySelector<HTMLAnchorElement>('.result__a');
            const snippet = result.querySelector('.result__snippet');

            if (link?.href && link.textContent?.trim()) {
                results.push({
                    title: link.textContent.trim(),
                    url: link.href,
                    content: snippet?.textContent?.trim() ?? '',
                });
            }

            if (results.length >= 5) break;
        }

        return results;
    }
}


export class MockSearchProvider implements ISearchProvider {
    async search(query: string): Promise<SearchResult[]> {
        return [
            {
                title: `Mock result for: ${query}`,
                url: 'https://example.com/mock-result-1',
                content: `Synthetic offline search result for query: ${query}`,
            },
            {
                title: `More information about: ${query}`,
                url: 'https://example.com/mock-result-2',
                content: `Another synthetic result for query: ${query}`,
            },
        ];
    }
}


export function getSearchProvider(): ISearchProvider {
    switch (env.SEARCH_PROVIDER) {
        case 'mock':
            return new MockSearchProvider();
        case 'duckduckgo':
            return new DuckDuckGoSearchProvider();
        case 'tavily':
            return new TavilySearchProvider();
        default:
            return env.TAVILY_API_KEY || env.SEARCH_API_KEY
                ? new TavilySearchProvider()
                : new DuckDuckGoSearchProvider();
    }
}

export async function web_search(query: string): Promise<SearchResult[]> {
    return getSearchProvider().search(query);
}

export async function fetch_markdown(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const html = await response.text();
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article) {
        throw new Error(`Failed to extract main content from ${url}`);
    }

    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
    });
    
    // Optional: remove common boilerplate elements if they snuck through Readability
    // 'svg' works at runtime; turndown's TagName type only covers HTML tags
    turndownService.remove(['script', 'style', 'noscript', 'svg'] as TurndownService.TagName[]);

    let markdown = `# ${article.title}\n\n`;
    markdown += turndownService.turndown(article.content ?? '');

    return markdown;
}
