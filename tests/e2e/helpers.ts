import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** The password of every seeded emulator account (scripts/seed.mjs). Emulator only. */
export const SEED_PASSWORD = 'bioeng-test-123';
const PROJECT = 'demo-bioeng';
const FIRESTORE = 'http://127.0.0.1:8180';
const AUTH = 'http://127.0.0.1:9199';

export async function login(page: Page, email: string, password = SEED_PASSWORD): Promise<void> {
  await page.goto('/');
  await page.locator('#loginCard input[type=email]').fill(email);
  await page.locator('#loginCard input[type=password]').fill(password);
  await page.locator('#loginCard button[type=submit]').click();
  await expect(page.locator('#loginCard')).toBeHidden();
}

/** A separate browser (own storage and session) signed in as `email`. */
export async function signedIn(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  await expect(page.getByTestId('report-editor')).toBeVisible();
  return { context, page };
}

export async function sections(page: Page): Promise<string[]> {
  return page.locator('#appShell h2').allTextContents();
}

export function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

export async function createPatient(page: Page, firstName: string, lastName: string): Promise<void> {
  await page.getByText('Shto pacient të ri').click();
  await page.getByTestId('new-first-name').fill(firstName);
  await page.getByTestId('new-last-name').fill(lastName);
  await page.getByRole('button', { name: 'Ruaj pacientin' }).click();
  await expect(page.getByTestId('status')).toContainText('u ruajt');
}

export async function selectPatient(page: Page, name: string): Promise<void> {
  const select = page.getByTestId('patient-select');
  const option = select.locator('option', { hasText: name });
  await expect(option).toHaveCount(1);
  await select.selectOption({ value: (await option.getAttribute('value'))! });
}

export function editorField(page: Page, label: string) {
  return page.getByTestId('report-editor').locator('label', { hasText: label }).locator('textarea, input').first();
}

// ---- Reading the emulator directly, as the server sees it ----------------------------

type FirestoreValue = Record<string, unknown>;

function decode(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return ((value.arrayValue as { values?: FirestoreValue[] }).values ?? []).map(decode);
  if ('mapValue' in value) return decodeFields((value.mapValue as { fields?: Record<string, FirestoreValue> }).fields ?? {});
  return value;
}

function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

/** A document as stored on the emulator (rules bypassed), or null. */
export async function serverDoc(path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (response.status === 404) return null;
  const body = (await response.json()) as { fields?: Record<string, FirestoreValue> };
  return decodeFields(body.fields ?? {});
}

export async function serverList(path: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  const body = (await response.json()) as { documents?: Array<{ fields?: Record<string, FirestoreValue> }> };
  return (body.documents ?? []).map(item => decodeFields(item.fields ?? {}));
}

/** The Firebase uid of a seeded account. */
export async function uidOf(email: string): Promise<string> {
  const response = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD, returnSecureToken: true })
  });
  const body = (await response.json()) as { localId?: string };
  if (!body.localId) throw new Error(`No emulator account for ${email}.`);
  return body.localId;
}
