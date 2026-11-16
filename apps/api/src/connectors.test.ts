import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_ADMIN, initLiveOrg } from '@company-os/db';
import { isPrivateAddress } from '@company-os/tools';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { startTestMcpServer, type TestMcpServer } from '../../../tests/setup/mcp-server';
import { buildApp } from './app';

const db = testDb();
const KEY = Buffer.alloc(32, 7);
const TOKEN = 'mcp-test-token-0123456789';
const { app } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
  connectors: { secretKey: KEY, allowPrivateNetwork: true },
});
const { app: strict } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
  connectors: { secretKey: null, allowPrivateNetwork: false },
});
let mcp: TestMcpServer;
let orgId = '';

beforeAll(async () => {
  mcp = await startTestMcpServer({ token: TOKEN });
});
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
  mcp.calls.length = 0;
});
afterAll(async () => {
  await mcp.close();
  await app.close();
  await strict.close();
  await db.$disconnect();
});

const call = (
  a: typeof app,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
  org: string | null = orgId,
) =>
  a.inject({
    method,
    url,
    remoteAddress: '127.0.0.1',
    headers: {
      ...(org ? { 'x-org-id': org } : {}),
      ...(method === 'POST' ? { 'idempotency-key': `k-${randomUUID()}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const addConnector = (token: string | undefined = TOKEN) =>
  call(app, 'POST', '/v1/connectors', { name: 'Notes équipe', url: mcp.url, token });

describe('Connecteurs MCP — API', () => {
  it('ajout : découverte réelle des outils, jeton chiffré au repos et jamais renvoyé', async () => {
    const r = await addConnector();
    expect(r.statusCode).toBe(201);
    const { toolId, tools } = r.json().data;
    expect(tools).toBe(2);
    expect(toolId).toMatch(/^mcp-[0-9a-f]{8}$/);
    const row = await db.connector.findFirstOrThrow({ where: { orgId } });
    expect(row.secretSealed).toMatch(/^v1:/);
    expect(row.secretSealed).not.toContain(TOKEN);

    const list = await call(app, 'GET', '/v1/connectors');
    expect(list.body).not.toContain(TOKEN);
    expect(list.body).not.toContain('secretSealed');
    const c = list.json().data[0];
    expect(c).toMatchObject({ name: 'Notes équipe', hasSecret: true, status: 'healthy' });
    // Politique par défaut : validation humaine pour chaque outil (même annoncé « lecture »).
    expect(c.tools.map((t: { action: string; policy: string }) => [t.action, t.policy])).toEqual([
      ['create_ticket', 'approval'],
      ['search_notes', 'approval'],
    ]);
    // La machine-outil apparaît dans le QG (snapshot) et un événement l'a annoncée.
    const boot = (await call(app, 'GET', '/v1/bootstrap')).json().data;
    expect(boot.tools.map((t: { id: string }) => t.id)).toContain(toolId);
    const ev = await db.eventLog.findFirstOrThrow({
      where: { orgId, type: 'tool.connector.updated' },
    });
    expect(JSON.stringify(ev.payload)).not.toContain(TOKEN);
    expect(JSON.stringify(ev.payload)).not.toContain('127.0.0.1');
  });

  it('jeton refusé par le serveur => 400 lisible, rien n’est enregistré', async () => {
    const r = await addConnector('mauvais-jeton-123');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toContain('authentification refusée');
    expect(await db.connector.count()).toBe(0);
  });

  it('anti-SSRF : HTTPS obligatoire, adresses privées refusées ; jeton sans clé refusé', async () => {
    const http = await call(strict, 'POST', '/v1/connectors', { name: 'Local', url: mcp.url });
    expect(http.statusCode).toBe(400);
    expect(http.json().error.message).toContain('HTTPS obligatoire');
    const priv = await call(strict, 'POST', '/v1/connectors', {
      name: 'Interne',
      url: 'https://169.254.169.254/latest',
    });
    expect(priv.json().error.message).toContain('adresse privée');
    const noKey = await call(strict, 'POST', '/v1/connectors', {
      name: 'Avec jeton',
      url: 'https://mcp.example.com/mcp',
      token: TOKEN,
    });
    expect(noKey.statusCode).toBe(409);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });

  it('réservé à un admin d’une org live', async () => {
    expect(
      (await call(app, 'POST', '/v1/connectors', { name: 'X', url: mcp.url }, null)).statusCode,
    ).toBe(403);
    const op = await app.inject({
      method: 'POST',
      url: '/v1/connectors',
      remoteAddress: '127.0.0.1',
      headers: { 'x-org-id': orgId, 'x-dev-role': 'operator' },
      payload: { name: 'X', url: mcp.url },
    });
    expect(op.statusCode).toBe(403);
    expect(mcp.calls).toHaveLength(0);
  });

  it('politique, droits d’agent et retrait', async () => {
    const { toolId, connectorId } = (await addConnector()).json().data;
    const pol = await call(app, 'POST', `/v1/connectors/${connectorId}/tools/search_notes/policy`, {
      policy: 'read',
    });
    expect(pol.statusCode).toBe(200);
    await call(app, 'POST', `/v1/connectors/${connectorId}/tools/create_ticket/policy`, {
      policy: 'disabled',
    });
    const agent = await call(app, 'POST', '/v1/agents', {
      name: 'Nora',
      title: 'Assistante',
      departmentId: `${orgId.slice(0, 8)}-sales`,
      grants: { [toolId]: ['search_notes'] },
      goal: 'Retrouver les notes',
      instructions: 'Toujours citer la note consultée dans la réponse.',
    });
    expect(agent.statusCode).toBe(201);
    const agentId = agent.json().data.agentId;
    // Outil désactivé : non attribuable.
    const denied = await call(app, 'POST', `/v1/agents/${agentId}/grants`, {
      grants: { [toolId]: ['create_ticket'] },
    });
    expect(denied.json().error.code).toBe('POLICY_DENIED');
    const ok = await call(app, 'POST', `/v1/agents/${agentId}/grants`, {
      grants: { [toolId]: ['search_notes'], company: ['status'] },
    });
    expect(ok.json().data.grants).toEqual({ [toolId]: ['search_notes'], company: ['status'] });
    // Machine-outil : seule l'action active, en lecture directe.
    const boot = (await call(app, 'GET', '/v1/bootstrap')).json().data;
    const machine = boot.tools.find((t: { id: string }) => t.id === toolId);
    expect(machine.actions).toEqual([
      expect.objectContaining({ action: 'search_notes', risk: 'read', kind: 'read' }),
    ]);

    expect((await call(app, 'POST', `/v1/connectors/${connectorId}/remove`)).statusCode).toBe(200);
    expect(await db.agentToolGrant.findMany({ where: { agentId, toolId } })).toHaveLength(0);
    const after = (await call(app, 'GET', '/v1/bootstrap')).json().data;
    expect(after.tools.map((t: { id: string }) => t.id)).not.toContain(toolId);
    expect((await call(app, 'GET', '/v1/connectors')).json().data).toEqual([]);
    expect(
      (await db.connector.findFirstOrThrow({ where: { id: connectorId } })).secretSealed,
    ).toBeNull();
  });

  it('resynchronisation : conserve les politiques choisies', async () => {
    const { connectorId } = (await addConnector()).json().data;
    await call(app, 'POST', `/v1/connectors/${connectorId}/tools/search_notes/policy`, {
      policy: 'read',
    });
    const r = await call(app, 'POST', `/v1/connectors/${connectorId}/sync`);
    expect(r.statusCode).toBe(200);
    expect(
      r.json().data.tools.find((t: { action: string }) => t.action === 'search_notes').policy,
    ).toBe('read');
  });
});
