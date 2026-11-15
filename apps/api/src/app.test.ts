import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  DomainEvent,
  ServerToClientEvents,
} from '@company-os/contracts';
import {
  appendEvents,
  createDb,
  DEMO_COMPANY,
  demoSpawnEvents,
  ensureCompany,
} from '@company-os/db';
import { buildApp } from './app';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST manquant');
const db = createDb(url);
const built = await buildApp({ db, webOrigin: 'http://localhost:3000' });
const { app, relayOnce } = built;
let baseUrl = '';

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "OutboxMessage", "Event", "Agent", "Company" CASCADE');
  await ensureCompany(db, DEMO_COMPANY);
  await appendEvents(db, demoSpawnEvents());
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const statusEvent = (activity: string) =>
  ({
    type: 'agent.status_changed',
    companyId: DEMO_COMPANY.id,
    mode: 'demo',
    actor: { kind: 'system', id: null },
    payload: { agentId: 'ag_demo_eng', status: 'working', activity },
  }) as const;

describe('HTTP', () => {
  it('GET /health', async () => {
    const res = await app.inject('/health');
    expect(res.json()).toEqual({ ok: true });
  });
  it('GET world snapshot en mode demo', async () => {
    const res = await app.inject(`/api/companies/${DEMO_COMPANY.id}/world`);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ mode: string; agents: unknown[]; lastSeq: number }>();
    expect(body.mode).toBe('demo');
    expect(body.agents).toHaveLength(5);
    expect(body.lastSeq).toBeGreaterThan(0);
  });
  it('404 pour une entreprise inconnue, 400 pour paramètre invalide', async () => {
    expect((await app.inject('/api/companies/nope/world')).statusCode).toBe(404);
    expect((await app.inject(`/api/companies/${DEMO_COMPANY.id}/events?after=-3`)).statusCode).toBe(
      400,
    );
  });
  it("inspecteur d'agent avec historique", async () => {
    await appendEvents(db, [statusEvent('Code la feature X')]);
    const res = await app.inject(`/api/companies/${DEMO_COMPANY.id}/agents/ag_demo_eng`);
    const body = res.json<{ agent: { status: string }; events: DomainEvent[] }>();
    expect(body.agent.status).toBe('working');
    expect(body.events.map((e) => e.type)).toEqual(['agent.status_changed', 'agent.spawned']);
  });
});

describe('Socket.IO', () => {
  const open = (): Socket<ServerToClientEvents, ClientToServerEvents> =>
    connect(baseUrl, { transports: ['websocket'], forceNew: true });

  it('rejoue les événements manqués puis pousse le live depuis l’outbox', async () => {
    const socket = open();
    const received: DomainEvent[] = [];
    socket.on('world:event', (e) => received.push(e));
    const ack = await socket.emitWithAck('world:subscribe', {
      companyId: DEMO_COMPANY.id,
      afterSeq: 0,
    });
    expect(ack).toEqual({ ok: true, replayed: 5 });

    await appendEvents(db, [statusEvent('live!')]);
    await relayOnce();
    await expect.poll(() => received.length).toBeGreaterThanOrEqual(6);
    expect(received.at(-1)?.type).toBe('agent.status_changed');
    socket.close();
  });

  it('reprise après déconnexion : seuls les événements après afterSeq sont rejoués', async () => {
    const all = await appendEvents(db, [statusEvent('a'), statusEvent('b')]);
    const socket = open();
    const received: DomainEvent[] = [];
    socket.on('world:event', (e) => received.push(e));
    const ack = await socket.emitWithAck('world:subscribe', {
      companyId: DEMO_COMPANY.id,
      afterSeq: all[0]!.seq,
    });
    expect(ack).toEqual({ ok: true, replayed: 1 });
    expect(received.map((e) => e.payload)).toMatchObject([{ activity: 'b' }]);
    socket.close();
  });

  it('refuse une souscription invalide', async () => {
    const socket = open();
    const ack = await socket.emitWithAck('world:subscribe', {
      companyId: '',
      afterSeq: -1,
    });
    expect(ack).toEqual({ ok: false, error: 'invalid_request' });
    socket.close();
  });
});
