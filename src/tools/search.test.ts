import { test } from "node:test";
import assert from "node:assert/strict";

// Set the provider before importing the search module.
process.env.SEARCH_PROVIDER = "mock";

const { getSearchProvider, MockSearchProvider, DuckDuckGoSearchProvider } =
  await import("./search.js");

test("Mock provider returns two results for a query", async () => {
  const provider = new MockSearchProvider();
  const results = await provider.search("hello foss");

  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Mock result for: hello foss");
  assert.equal(results[0].url, "https://example.com/mock-result-1");
  assert.equal(
    results[0].content,
    "Synthetic offline search result for query: hello foss",
  );
});

test("Factory selects Mock provider when configured", () => {
  const provider = getSearchProvider();

  assert.ok(provider instanceof MockSearchProvider);
});


test('DuckDuckGo provider parses search results', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () =>
        new Response(
            `
            <div class="result">
                <a class="result__a" href="https://example.com/docs">
                    Example Documentation
                </a>
                <a class="result__snippet">
                    Documentation for testing
                </a>
            </div>
            `,
            {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
            }
        );

    try {
        const provider = new DuckDuckGoSearchProvider();
        const results = await provider.search('hello foss');

        assert.equal(results.length, 1);
        assert.equal(results[0].title, 'Example Documentation');
        assert.equal(results[0].url, 'https://example.com/docs');
        assert.equal(results[0].content, 'Documentation for testing');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
