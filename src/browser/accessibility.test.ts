import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactAriaSnapshot,
  getAnnotatedAccessibilityTree,
} from './accessibility.js';



// Baseline YAML form is used only to compare fixture sizes; production compaction receives the equivalent structured tree below.
const RAW_COMPLEX_PAGE_SNAPSHOT = `
- banner:
  - generic:
    - generic:
      - navigation "Primary":
        - list:
          - listitem:
            - link "Home":
              - /url: https://example.com/home?utm_source=header_nav&tracking=123456
          - listitem:
            - link "Pricing":
              - /url: https://example.com/pricing?utm_source=header_nav&tracking=123456
          - listitem:
            - button "Sign In"
  - generic:
    - navigation "Primary":
      - list:
        - listitem:
          - link "Home":
            - /url: https://example.com/home?utm_source=header_nav&tracking=123456
        - listitem:
          - link "Pricing":
            - /url: https://example.com/pricing?utm_source=header_nav&tracking=123456
        - listitem:
          - button "Sign In"
- main:
  - generic:
    - generic:
      - svg
      - img
      - separator
      - none:
        - button "Nested CTA"
    - article:
      - heading "Dashboard" [level=1]
      - paragraph:
        - "Welcome to the developer dashboard."
      - generic:
        - textbox "Search projects"
        - button "Create Project"
        - link "View Docs":
          - /url: https://example.com/docs/getting-started/introduction
`.trim();

const COMPLEX_PAGE_TREE = [
  {
    role: 'banner',
    children: [
      {
        role: 'generic',
        children: [
          {
            role: 'generic',
            children: [{
              role: 'navigation',
              name: 'Primary',
              children: [
              {
                role: 'list',
                children: [
                  { role: 'listitem', children: [{ role: 'link', name: 'Home', url: 'https://example.com/home?utm_source=header_nav&tracking=123456' }] },
                  { role: 'listitem', children: [{ role: 'link', name: 'Pricing', url: 'https://example.com/pricing?utm_source=header_nav&tracking=123456' }] },
                  { role: 'listitem', children: [{ role: 'button', name: 'Sign In' }] },
                ],
              },
            ],
            }],
          },
        ],
      },
      {
        role: 'generic',
        children: [{
          role: 'navigation',
          name: 'Primary',
          children: [
          { role: 'link', name: 'Home', url: 'https://example.com/home?utm_source=header_nav&tracking=123456' },
          { role: 'link', name: 'Pricing', url: 'https://example.com/pricing?utm_source=header_nav&tracking=123456' },
          { role: 'button', name: 'Sign In' },
          ],
        }],
      },
    ],
  },
  {
    role: 'main',
    children: [
      {
        role: 'generic',
        children: [
          {
            role: 'generic',
            children: [
              { role: 'svg' },
              { role: 'img', name: '' },
              { role: 'separator' },
              { role: 'none', children: [{ role: 'button', name: 'Nested CTA' }] },
            ],
          },
          {
            role: 'article',
            children: [
              { role: 'heading', name: 'Dashboard', level: 1 },
              { role: 'paragraph', children: [{ role: 'text', text: 'Welcome to the developer dashboard.' }] },
              {
                role: 'generic',
                children: [
                  { role: 'textbox', name: 'Search projects', placeholder: 'Search projects' },
                  { role: 'button', name: 'Create Project' },
                  { role: 'link', name: 'View Docs', url: 'https://example.com/docs/getting-started/introduction' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

test('compaction preserves interactive descendants while removing decorative wrappers', () => {
  const compacted = compactAriaSnapshot(COMPLEX_PAGE_TREE);
  const reductionRatio = 1 - compacted.length / RAW_COMPLEX_PAGE_SNAPSHOT.length;
  assert.ok(
    reductionRatio >= 0.4,
    `Expected at least 40% reduction on the representative fixture, got ${Math.round(reductionRatio * 100)}%`,
  );

  assert.ok(compacted.includes('link "Home"'));
  assert.ok(compacted.includes('link "Pricing"'));
  assert.ok(compacted.includes('button "Sign In"'));
  assert.ok(compacted.includes('button "Nested CTA"'));
  assert.ok(compacted.includes('heading "Dashboard"'));
  assert.ok(compacted.includes('textbox "Search projects"'));
  assert.ok(compacted.includes('button "Create Project"'));
  assert.ok(compacted.includes('link "View Docs"'));
  assert.ok(compacted.includes('Welcome to the developer dashboard.'));

  assert.ok(!compacted.includes('svg'));
  assert.ok(!compacted.includes('separator'));
  assert.ok(!compacted.includes('utm_source'));
  assert.equal((compacted.match(/navigation "Primary"/g) ?? []).length, 1);
});


test('link destination URLs can be included explicitly without being mandatory context', () => {
  const tree = [{ role: 'link', name: 'Docs', url: 'https://example.com/docs?utm_source=nav' }];
  const compacted = compactAriaSnapshot(tree);
  const withUrls = compactAriaSnapshot(tree, { includeUrls: true });
  assert.ok(!compacted.includes('https://example.com/docs'));
  assert.ok(withUrls.includes('[url="https://example.com/docs?utm_source=nav"]'));
});

test('different navigation destinations are not deduplicated just because labels match', () => {
  const tree = [
    { role: 'navigation', name: 'Primary', children: [{ role: 'link', name: 'Help', url: 'https://example.com/help' }] },
    { role: 'navigation', name: 'Primary', children: [{ role: 'link', name: 'Help', url: 'https://example.com/support' }] },
  ];

  const compacted = compactAriaSnapshot(tree);
  assert.equal((compacted.match(/navigation "Primary"/g) ?? []).length, 2);
  assert.equal((compacted.match(/link "Help"/g) ?? []).length, 2);
});

test('hard character budget holds for tiny budgets and very long single-node names', () => {
  const hugeTree = [{ role: 'button', name: 'Create '.repeat(2_000) }];

  for (const maxChars of [1, 10, 40, 80, 180, 4000]) {
    const result = compactAriaSnapshot(hugeTree, { maxChars });
    assert.ok(result.length <= maxChars, `Expected <= ${maxChars} chars, got ${result.length}`);
  }
});

test('uses the configured budget and reports an omitted-content placeholder', () => {
  const result = compactAriaSnapshot(COMPLEX_PAGE_TREE, { maxChars: 180 });
  assert.ok(result.length <= 180);
  assert.ok(result.includes('items truncated') || result === '…'.repeat(180));
});

test('CSS selector scopes the returned tree and does not mix locator and ARIA-role APIs', async () => {
  const calls: string[] = [];
  const mockPage = {
    getByRole() { throw new Error('getByRole must not be used for CSS selector scoping'); },
    locator(selector: string) {
      calls.push(selector);
      return {
        first() {
          return {
            async count() { return 1; },
            async ariaSnapshotJSON() { return [COMPLEX_PAGE_TREE[1]]; },
          };
        },
      };
    },
  } as any;

  const tree = await getAnnotatedAccessibilityTree(mockPage, { selector: '#content', maxChars: 4000 });
  assert.ok(tree.includes('textbox "Search projects"'));
  assert.ok(!tree.includes('navigation "Primary"'));
  assert.deepEqual(calls, ['#content']);
});

test('missing or invalid selector falls back to a bounded full-page snapshot with a notice', async () => {
  const mockPage = {
    locator(selector: string) {
      return {
        first() {
          return {
            async count() {
              if (selector === 'div[unclosed') throw new Error('Malformed selector');
              return 1;
            },
            async ariaSnapshotJSON() { return COMPLEX_PAGE_TREE; },
          };
        },
      };
    },
  } as any;

  const result = await getAnnotatedAccessibilityTree(mockPage, {
    selector: 'div[unclosed',
    maxChars: 180,
  });
  assert.ok(result.length <= 180);
  assert.ok(result.includes('Selector') || result.startsWith('…'));
});

test('empty snapshots and thrown browser errors respect the output budget', async () => {
  const emptyPage = {
    locator() {
      return { first: () => ({ count: async () => 1, ariaSnapshotJSON: async () => [] }) };
    },
  } as any;
  assert.ok((await getAnnotatedAccessibilityTree(emptyPage, { maxChars: 10 })).length <= 10);

  const brokenPage = { locator() { throw new Error('x'.repeat(500)); } } as any;
  const result = await getAnnotatedAccessibilityTree(brokenPage, { maxChars: 40 });
  assert.ok(result.length <= 40);
});


test('slight overflow keeps useful static text when the normal prefix retains every control', () => {
  const tree = [{
    role: 'main',
    children: [
      { role: 'heading', name: 'Projects' },
      { role: 'button', name: 'Create project' },
      { role: 'text', text: 'Important page context '.repeat(8) },
      { role: 'text', text: 'Additional tail context '.repeat(12) },
    ],
  }];
  const full = compactAriaSnapshot(tree, { maxChars: 20_000 });
  const result = compactAriaSnapshot(tree, { maxChars: full.length - 50 });

  assert.ok(result.length <= full.length - 50);
  assert.ok(result.includes('button "Create project"'));
  assert.ok(result.includes('Important page context'));
  assert.ok(result.includes('items truncated'));
});

test('oversized interactive labels keep the control role visible within the budget', () => {
  const tree = [{ role: 'button', name: 'Create '.repeat(2_000) }];
  const result = compactAriaSnapshot(tree, { maxChars: 100 });

  assert.ok(result.length <= 100);
  assert.ok(result.includes('button'), `Expected button role to remain visible: ${result}`);
  assert.ok(result.includes('truncated'));
});

test('explicit false accessibility states remain visible', () => {
  const result = compactAriaSnapshot([
    { role: 'checkbox', name: 'Receive updates', checked: false, disabled: false },
  ]);

  assert.ok(result.includes('[checked=false]'));
  assert.ok(result.includes('[disabled=false]'));
});
