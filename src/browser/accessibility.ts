import type { Page } from 'playwright';

/** Default maximum size of an accessibility snapshot returned to the agent. */
export const DEFAULT_MAX_CHARS = 4_000;

export interface AccessibilityOptions {
  /** CSS selector used to scope extraction. Examples: main, article, #content. */
  selector?: string;
  /** Maximum length of the complete returned string, including notices and placeholders. */
  maxChars?: number;
  /** Include destination URLs for links; false by default to reduce output size. */
  includeUrls?: boolean;
}

interface AriaNode {
  role: string;
  name?: string;
  text?: string;
  children: AriaNode[];
  checked?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  active?: boolean;
  invalid?: boolean | string;
  level?: number;
  pressed?: boolean | 'mixed';
  selected?: boolean;
  url?: string;
  placeholder?: string;
  value?: string | number;
  cursor?: string;
}

const DECORATIVE_ROLES = new Set(['none', 'presentation', 'separator', 'svg']);
const TRANSPARENT_ROLES = new Set([
  'generic',
  'group',
  'list',
  'listitem',
  'paragraph',
  'figure',
]);
export const LANDMARK_SUGGESTION_ORDER = ['main', 'article', 'form', 'navigation'] as const;

const LANDMARK_ROLES = new Set([
  'article',
  'form',
  'banner',
  'complementary',
  'contentinfo',
  'main',
  'navigation',
  'region',
  'search',
]);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'treeitem',
  'gridcell',
]);
const STATE_KEYS = [
  'checked',
  'disabled',
  'expanded',
  'active',
  'invalid',
  'level',
  'pressed',
  'selected',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMixedBoolean(value: unknown): value is boolean | 'mixed' {
  return typeof value === 'boolean' || value === 'mixed';
}

/**
 * Normalize Playwright's ariaSnapshotJSON() result into the small local shape
 * used by the compactor. Unknown properties are deliberately not copied.
 */
function normalizeNodes(value: unknown): AriaNode[] {
  let input = value;

  // Accept JSON text as a convenience for callers/tests, but never parse YAML here.
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input) as unknown;
    } catch {
      return [];
    }
  }

  if (!Array.isArray(input)) return [];

  const nodes: AriaNode[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) continue;

    const role = typeof entry.role === 'string' && entry.role.trim()
      ? entry.role.trim().toLowerCase()
      : 'text';
    const node: AriaNode = {
      role,
      children: normalizeNodes(entry.children),
    };

    for (const key of ['name', 'text', 'url', 'placeholder', 'cursor'] as const) {
      if (typeof entry[key] === 'string') node[key] = entry[key] as string;
    }

    if (typeof entry.value === 'string' || typeof entry.value === 'number') {
      node.value = entry.value;
    }
    if (isMixedBoolean(entry.checked)) node.checked = entry.checked;
    if (typeof entry.disabled === 'boolean') node.disabled = entry.disabled;
    if (typeof entry.expanded === 'boolean') node.expanded = entry.expanded;
    if (typeof entry.active === 'boolean') node.active = entry.active;
    if (typeof entry.invalid === 'boolean' || typeof entry.invalid === 'string') {
      node.invalid = entry.invalid;
    }
    if (typeof entry.level === 'number' && Number.isFinite(entry.level)) {
      node.level = entry.level;
    }
    if (isMixedBoolean(entry.pressed)) node.pressed = entry.pressed;
    if (typeof entry.selected === 'boolean') node.selected = entry.selected;

    nodes.push(node);
  }

  return nodes;
}

function hasState(node: AriaNode): boolean {
  return STATE_KEYS.some((key) => node[key] !== undefined);
}

function hasUsefulScalar(node: AriaNode): boolean {
  return Boolean(
    node.name?.trim() ||
    node.text?.trim() ||
    node.placeholder?.trim() ||
    node.value !== undefined ||
    hasState(node),
  );
}

function isInteractive(node: AriaNode): boolean {
  return INTERACTIVE_ROLES.has(node.role) || node.url !== undefined || node.cursor === 'pointer';
}

function cloneSubtree(node: AriaNode): AriaNode {
  return { ...node, children: node.children.map(cloneSubtree) };
}

/**
 * Compact only known-redundant structures. Transparent wrappers are unwrapped
 * rather than deleted, so meaningful descendants (including controls) survive.
 * Duplicate navigation trees are removed only when they are identical siblings.
 */
function compactNodes(nodes: AriaNode[]): AriaNode[] {
  const compacted: AriaNode[] = [];
  for (const original of nodes) {
    const node: AriaNode = {
      ...original,
      children: compactNodes(original.children),
    };

    if (DECORATIVE_ROLES.has(node.role)) {
      compacted.push(...node.children);
      continue;
    }

    if ((node.role === 'img' || node.role === 'image') && !node.name?.trim() && node.children.length === 0) {
      continue;
    }

    if (TRANSPARENT_ROLES.has(node.role) && !hasUsefulScalar(node)) {
      compacted.push(...node.children);
      continue;
    }

    compacted.push(node);
  }

  return deduplicateNavigationSiblings(compacted);
}

/** Wrapping nodes may be flattened after their children are processed, so run a
 * second sibling-level dedupe pass on the resulting tree. */
function deduplicateNavigationSiblings(nodes: AriaNode[]): AriaNode[] {
  const result: AriaNode[] = [];
  const seen = new Set<string>();
  for (const original of nodes) {
    const node = { ...original, children: deduplicateNavigationSiblings(original.children) };
    if (node.role === 'navigation') {
      const signature = JSON.stringify(node);
      if (seen.has(signature)) continue;
      seen.add(signature);
    }
    result.push(node);
  }
  return result;
}

function safeScalar(value: string | number | boolean): string {
  // JSON string quoting keeps quotes/newlines from corrupting the tree layout.
  return JSON.stringify(String(value)) ?? '""';
}

function stateAttributes(node: AriaNode, includeUrls: boolean): string[] {
  const attributes: string[] = [];
  for (const key of STATE_KEYS) {
    const value = node[key];
    if (value === undefined) continue;
    if (value === true) attributes.push(`[${key}]`);
    else attributes.push(`[${key}=${String(value)}]`);
  }
  if (node.placeholder) attributes.push(`[placeholder=${safeScalar(node.placeholder)}]`);
  if (includeUrls && node.url) attributes.push(`[url=${safeScalar(node.url)}]`);
  return attributes;
}

function renderNodeLine(node: AriaNode, depth: number, includeUrls: boolean): string {
  const indent = '  '.repeat(depth);
  if (node.role === 'text') {
    const text = node.text ?? node.name ?? '';
    return `${indent}- ${safeScalar(text)}`;
  }

  let label = node.role;
  if (node.name) label += ` ${safeScalar(node.name)}`;

  const attributes = stateAttributes(node, includeUrls);
  if (attributes.length > 0) label += ` ${attributes.join(' ')}`;

  if (node.value !== undefined && node.text === undefined && node.children.length === 0) {
    return `${indent}- ${label}: ${safeScalar(node.value)}`;
  }
  if (node.text !== undefined && node.children.length === 0) {
    return `${indent}- ${label}: ${safeScalar(node.text)}`;
  }
  if (node.children.length > 0) return `${indent}- ${label}:`;
  return `${indent}- ${label}`;
}

function serializeNodes(nodes: AriaNode[], depth = 0, includeUrls = false): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    lines.push(renderNodeLine(node, depth, includeUrls));
    if (node.children.length > 0) lines.push(...serializeNodes(node.children, depth + 1, includeUrls));
  }
  return lines;
}

function countNodes(nodes: AriaNode[]): number {
  let count = 0;
  for (const node of nodes) count += 1 + countNodes(node.children);
  return count;
}

/** Keep controls, their descendants, landmarks, headings, and all their ancestors. */
function buildPriorityTree(nodes: AriaNode[], preserveSubtree = false): AriaNode[] {
  const result: AriaNode[] = [];
  for (const node of nodes) {
    const preserve = preserveSubtree || isInteractive(node);
    const children = preserve
      ? node.children.map(cloneSubtree)
      : buildPriorityTree(node.children);
    const important = preserve || LANDMARK_ROLES.has(node.role) || node.role === 'heading';
    if (important || children.length > 0) result.push({ ...node, children });
  }
  return result;
}

function findSuggestedLandmark(nodes: AriaNode[]): string | undefined {
  // A preference order is intentional: main is usually the most useful next scope.
  for (const target of LANDMARK_SUGGESTION_ORDER) {
    if (containsRole(nodes, target)) return target;
  }
  return undefined;
}

function containsRole(nodes: AriaNode[], targetRole: string): boolean {
  return nodes.some((node) => node.role === targetRole || containsRole(node.children, targetRole));
}

export function getDefaultMaxChars(): number {
  const raw = process.env.ARIA_SNAPSHOT_MAX_CHARS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_MAX_CHARS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CHARS;
}

function resolveMaxChars(value?: number): number {
  if (value === undefined) return getDefaultMaxChars();
  return Number.isSafeInteger(value) && value > 0 ? value : getDefaultMaxChars();
}

function truncationFooter(count: number, suggestedLandmark?: string, scope?: string): string {
  const guidance = suggestedLandmark
    ? `. Target landmark '${suggestedLandmark}' to inspect`
    : scope
      ? ` in scope '${scope}'`
      : '';
  return `... [${Math.max(1, count)} items truncated${guidance}]`;
}

interface FittedLines {
  text: string;
  /** Number of source lines represented, including a possibly clipped last line. */
  keptLines: number;
  /** A clipped interactive line no longer carries its complete accessible name. */
  clippedLastLine: boolean;
}

function clipStructuredLine(line: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (line.length <= maxLength) return line;

  // Preserve the node's role when possible, even if an accessible name or text
  // value is itself longer than the entire remaining budget.
  const roleMatch = line.match(/^(\s*-\s+)([A-Za-z][A-Za-z0-9_-]*)/);
  const dashMatch = line.match(/^(\s*-\s+)/);
  const prefix = roleMatch
    ? `${roleMatch[1]}${roleMatch[2]}`
    : (dashMatch?.[0].trimEnd() || '…');
  const suffix = ' [details truncated]';

  if (prefix.length + suffix.length <= maxLength) return `${prefix}${suffix}`;
  if (prefix.length < maxLength) return `${prefix}${'…'.repeat(maxLength - prefix.length)}`;
  return '…'.repeat(maxLength);
}

function fitLinesWithinBudget(
  lines: string[],
  baseOmittedCount: number,
  maxChars: number,
  suggestedLandmark?: string,
  scope?: string,
): FittedLines {
  if (maxChars <= 0) return { text: '', keptLines: 0, clippedLastLine: false };

  for (let keep = lines.length; keep >= 0; keep -= 1) {
    const omittedCount = baseOmittedCount + (lines.length - keep);
    const footer = truncationFooter(omittedCount, suggestedLandmark, scope);
    const body = lines.slice(0, keep).join('\n');
    const candidate = body ? `${body}\n${footer}` : footer;
    if (candidate.length <= maxChars) {
      return { text: candidate, keptLines: keep, clippedLastLine: false };
    }

    // If the next whole line cannot fit, keep a compact structural version of
    // that node instead of silently dropping an oversized button/name entirely.
    if (keep === 0) continue;
    const precedingLines = lines.slice(0, keep - 1);
    const preceding = precedingLines.join('\n');
    const clippedOmittedCount = baseOmittedCount + (lines.length - keep) + 1;
    const clippedFooter = truncationFooter(clippedOmittedCount, suggestedLandmark, scope);
    const overhead = (preceding ? preceding.length + 1 : 0) + 1 + clippedFooter.length;
    const availableForLine = maxChars - overhead;
    if (availableForLine <= 0) continue;

    const clippedLine = clipStructuredLine(lines[keep - 1], availableForLine);
    if (!clippedLine) continue;
    const clippedBody = preceding ? `${preceding}\n${clippedLine}` : clippedLine;
    const clippedCandidate = `${clippedBody}\n${clippedFooter}`;
    if (clippedCandidate.length <= maxChars) {
      return { text: clippedCandidate, keptLines: keep, clippedLastLine: true };
    }
  }

  // Tiny budgets cannot fit a useful structural footer. Still enforce the hard cap.
  return { text: '…'.repeat(maxChars), keptLines: 0, clippedLastLine: false };
}

function collectInteractiveLineIndices(nodes: AriaNode[]): number[] {
  const indices: number[] = [];
  let index = 0;
  const visit = (siblings: AriaNode[]) => {
    for (const node of siblings) {
      if (isInteractive(node)) indices.push(index);
      index += 1;
      visit(node.children);
    }
  };
  visit(nodes);
  return indices;
}

function clipMessage(message: string, maxChars: number): string {
  if (message.length <= maxChars) return message;
  if (maxChars <= 0) return '';
  if (maxChars === 1) return '…';
  return `${message.slice(0, maxChars - 1)}…`;
}

interface RenderContext {
  /** CSS selector successfully used for scoped extraction. */
  scope?: string;
  /** A short diagnostic that must count toward the same character budget. */
  notice?: string;
}

function compactStructuredSnapshot(
  rawSnapshot: unknown,
  options: AccessibilityOptions = {},
  context: RenderContext = {},
): string {
  const maxChars = resolveMaxChars(options.maxChars);
  const prefix = context.notice?.trim() ?? '';
  const prefixCost = prefix ? prefix.length + 1 : 0;

  if (prefixCost >= maxChars) return clipMessage(prefix, maxChars);
  const treeBudget = maxChars - prefixCost;

  const originalNodes = normalizeNodes(rawSnapshot);
  if (originalNodes.length === 0) {
    const message = clipMessage('No accessibility tree found.', treeBudget);
    return prefix ? `${prefix}\n${message}` : message;
  }

  const compacted = compactNodes(originalNodes);
  if (compacted.length === 0) {
    const message = clipMessage('No accessibility tree found.', treeBudget);
    return prefix ? `${prefix}\n${message}` : message;
  }

  const includeUrls = options.includeUrls === true;
  const fullLines = serializeNodes(compacted, 0, includeUrls);
  const fullTree = fullLines.join('\n');
  if (fullTree.length <= treeBudget) return prefix ? `${prefix}\n${fullTree}` : fullTree;

  const suggestion = context.scope ? undefined : findSuggestedLandmark(compacted);

  // Preserve as much ordinary page context as possible when a simple prefix fits
  // without dropping any interactive node. Only switch to the priority tree when
  // that prefix would hide a button/link/input deeper in the page.
  const normalFit = fitLinesWithinBudget(
    fullLines,
    0,
    treeBudget,
    suggestion,
    context.scope,
  );
  const interactiveIndices = collectInteractiveLineIndices(compacted);
  const keepsEveryInteractiveNode = interactiveIndices.every(
    (index) => index < normalFit.keptLines &&
      !(normalFit.clippedLastLine && index === normalFit.keptLines - 1),
  );
  if (keepsEveryInteractiveNode) {
    return prefix ? `${prefix}\n${normalFit.text}` : normalFit.text;
  }

  // The regular prefix would hide one or more controls, so retain the tree's
  // interactive core and its landmarks/headings before using the same hard cap.
  const priorityTree = buildPriorityTree(compacted);
  const priorityLines = serializeNodes(priorityTree, 0, includeUrls);
  const omittedNonCoreNodes = Math.max(0, countNodes(compacted) - countNodes(priorityTree));
  const marker = truncationFooter(omittedNonCoreNodes, suggestion, context.scope);
  const priorityText = priorityLines.join('\n');
  const completePriority = priorityText ? `${priorityText}\n${marker}` : marker;
  const priorityFit = completePriority.length <= treeBudget
    ? { text: completePriority, keptLines: priorityLines.length, clippedLastLine: false }
    : fitLinesWithinBudget(
      priorityLines,
      omittedNonCoreNodes,
      treeBudget,
      suggestion,
      context.scope,
    );

  return prefix ? `${prefix}\n${priorityFit.text}` : priorityFit.text;
}

/**
 * Compact a Playwright ariaSnapshotJSON() result. This function intentionally
 * consumes structured JSON, not the YAML returned by ariaSnapshot().
 */
export function compactAriaSnapshot(
  rawSnapshot: unknown,
  options: Pick<AccessibilityOptions, 'maxChars' | 'includeUrls'> = {},
): string {
  return compactStructuredSnapshot(rawSnapshot, options);
}

export async function getAnnotatedAccessibilityTree(
  page: Page,
  optionsOrSelector?: AccessibilityOptions | string,
): Promise<string> {
  const options: AccessibilityOptions = typeof optionsOrSelector === 'string'
    ? { selector: optionsOrSelector }
    : (optionsOrSelector ?? {});
  const selector = options.selector?.trim();

  try {
    if (selector) {
      try {
        // `selector` is deliberately CSS-only. Use [role="main"] for custom ARIA roles.
        const target = page.locator(selector).first();
        if ((await target.count()) > 0) {
          const scopedSnapshot = await target.ariaSnapshotJSON();
          return compactStructuredSnapshot(scopedSnapshot, options, { scope: selector });
        }
      } catch {
        // Invalid CSS or a detached target: return a bounded full-page fallback below.
      }
    }

    const bodySnapshot = await page.locator('body').first().ariaSnapshotJSON();
    const notice = selector
      ? `Selector ${JSON.stringify(selector)} was not found; showing the full-page snapshot.`
      : undefined;
    return compactStructuredSnapshot(bodySnapshot, options, { notice });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return clipMessage(`Failed to get accessibility snapshot: ${message}`, resolveMaxChars(options.maxChars));
  }
}
