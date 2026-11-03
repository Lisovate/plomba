import { describe, expect, it } from 'vitest';
import { OPERATIONS } from '../src/http/openapi.ts';
import { createTestApp } from './fakes.ts';

describe('GET /api/openapi.json', () => {
  it('describes the API, both webhooks, and is public', async () => {
    const { app } = createTestApp({ accessCode: 'correct horse battery' });
    const response = await app.request('/api/openapi.json');
    expect(response.status).toBe(200);
    const doc = (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      webhooks: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.webhooks)).toEqual(['handover.started', 'handover.sealed']);
    expect(Object.keys(doc.paths)).toContain('/handovers/{id}/spoken-damage');
  });

  it('lists only operations the server really has', () => {
    const { app } = createTestApp();
    const routes = new Set(
      app.routes.map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, '{$1}')}`),
    );
    const missing = OPERATIONS.map((op) => `${op.method} /api${op.path}`).filter(
      (key) => !routes.has(key),
    );
    expect(missing).toEqual([]);
  });
});
