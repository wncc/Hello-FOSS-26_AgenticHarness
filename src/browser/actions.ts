import { BrowserDaemon } from './daemon.js';
import { getAnnotatedAccessibilityTree } from './accessibility.js';
import fs from 'node:fs';
import path from 'node:path';

export async function navigate(url: string, selector?: string, maxChars?: number, includeUrls?: boolean): Promise<string> {
  // Keep the existing URL safety policy in this project; URL validation is outside this issue.
  if (url.includes('169.254.169.254')) {
    throw new Error('Access to internal metadata IPs is blocked.');
  }

  const daemon = BrowserDaemon.getInstance();
  const page = await daemon.getPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  return getAnnotatedAccessibilityTree(page, { selector, maxChars, includeUrls });
}

export async function click(
  role: string,
  name: string,
  selector?: string,
  maxChars?: number,
  includeUrls?: boolean,
): Promise<string> {
  const daemon = BrowserDaemon.getInstance();
  const page = await daemon.getPage();
  await page.getByRole(role as any, { name }).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  return getAnnotatedAccessibilityTree(page, { selector, maxChars, includeUrls });
}

export async function type(
  role: string,
  name: string,
  text: string,
  selector?: string,
  maxChars?: number,
  includeUrls?: boolean,
): Promise<string> {
  const daemon = BrowserDaemon.getInstance();
  const page = await daemon.getPage();
  await page.getByRole(role as any, { name }).first().fill(text);
  await page.waitForLoadState('networkidle').catch(() => {});
  return getAnnotatedAccessibilityTree(page, { selector, maxChars, includeUrls });
}

export async function screenshot(
  filename?: string,
): Promise<{ status: string; filename: string; fullPath: string }> {
  const daemon = BrowserDaemon.getInstance();
  const page = await daemon.getPage();
  const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const safeFilename = filename || `screenshot-${Date.now()}.png`;
  const fullPath = path.resolve(screenshotsDir, safeFilename);
  await page.screenshot({ path: fullPath, fullPage: true });
  console.log(`[Browser Tool] Screenshot saved to: ${fullPath}`);

  return { status: 'success', filename: safeFilename, fullPath };
}
