import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_ADMIN, endDueMeetings, initLiveOrg, loadSnapshot } from '@company-os/db';
import { comparable, foldAll, resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const { app } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
});
let orgId = '';
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
const call = (method: 'GET' | 'POST', url: string, payload?: object, role?: string) =>
  app.inject({
    method,
    url,
    remoteAddress: '127.0.0.1',
    headers: {
      'x-org-id': orgId,
      ...(role ? { 'x-dev-role': role } : {}),
      ...(method === 'POST' ? { 'idempotency-key': `k-${randomUUID()}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const newAgent = async (name: string) => {
  const r = await call('POST', '/v1/agents', {
    name,
    title: 'Chargé de mission',
    departmentId: `${orgId.slice(0, 8)}-direction`,
    grants: { company: ['status'] },
    goal: 'Aider l’équipe',
    instructions: 'Réponses courtes et claires.',
  });
  if (r.statusCode !== 201) throw new Error(r.body);
  return r.json().data.agentId as string;
};

describe('Extension de l’entreprise : nouveaux pôles', () => {
  it('crée un pôle dans un local libre, le renomme, puis refuse quand l’aile est pleine', async () => {
    expect(
      (await call('POST', '/v1/departments', { name: 'Juridique', color: '#3D8BD9' }, 'operator'))
        .statusCode,
    ).toBe(403);
    const r = await call('POST', '/v1/departments', { name: 'Juridique', color: '#3D8BD9' });
    expect(r.statusCode).toBe(201);
    const { departmentId, roomId } = r.json().data;
    expect(roomId).toBe('annex-1');
    let snap = (await loadSnapshot(db, orgId))!;
    expect(snap.departments.find((d) => d.id === departmentId)).toMatchObject({
      name: 'Juridique',
      capacity: 6,
      roomId: 'annex-1',
    });
    // Recrutement dans le nouveau pôle : il a ses bureaux.
    const hire = await call('POST', '/v1/agents', {
      name: 'Léa',
      title: 'Juriste',
      departmentId,
      grants: { company: ['status'] },
      goal: 'Relire les contrats',
      instructions: 'Signaler les clauses à risque.',
    });
    expect(hire.statusCode, hire.body).toBe(201);
    snap = (await loadSnapshot(db, orgId))!;
    expect(snap.agents.find((a) => a.name === 'Léa')?.deskAnchor).toMatch(/^annex-1-desk-/);

    expect(
      (
        await call('POST', `/v1/departments/${departmentId}`, {
          name: 'Juridique & conformité',
          color: '#9B6BD3',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', '/v1/departments', { name: 'Produit', color: '#4CAF7A' })).json().data
        .roomId,
    ).toBe('annex-2');
    expect(
      (await call('POST', '/v1/departments', { name: 'Achats', color: '#C9A227' })).json().data
        .roomId,
    ).toBe('annex-3');
    const full = await call('POST', '/v1/departments', { name: 'Encore', color: '#C9A227' });
    expect(full.statusCode).toBe(409);
    snap = (await loadSnapshot(db, orgId))!;
    expect(snap.departments.find((d) => d.id === departmentId)?.name).toBe(
      'Juridique & conformité',
    );
    // Le pli des événements redonne exactement les pôles du snapshot.
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
    expect((await foldAll(db, snap)).departments).toEqual(snap.departments);
  });
});

describe('Réunions convoquées par l’humain', () => {
  it('les agents disponibles rejoignent la salle ; ceux en mission ne sont pas interrompus', async () => {
    const a = await newAgent('Alice');
    const b = await newAgent('Bruno');
    const c = await newAgent('Chloé');
    // Chloé est en mission : elle ne doit pas être arrachée à son travail.
    await db.agent.update({
      where: { id: c },
      data: { currentTaskId: randomUUID(), activity: 'working' },
    });
    expect(
      (await call('POST', '/v1/meetings', { topic: 'Point', participantIds: [a, b] }, 'viewer'))
        .statusCode,
    ).toBe(403);
    const r = await call('POST', '/v1/meetings', {
      topic: 'Point hebdo',
      agenda: 'Priorités de la semaine',
      participantIds: [a, b, c],
      facilitatorId: b,
      durationMin: 15,
      minutes: true,
    });
    expect(r.statusCode).toBe(201);
    const { meetingId, participants, excluded } = r.json().data;
    expect(participants).toEqual([b, a]);
    expect(excluded).toEqual([c]);
    let snap = (await loadSnapshot(db, orgId))!;
    const m = snap.meetings.find((x) => x.id === meetingId)!;
    expect(m.status).toBe('in_progress');
    expect(Object.values(m.seats).every((s) => s.startsWith('meeting-seat-'))).toBe(true);
    expect(m.endsAt).toBeTruthy();
    expect(snap.agents.find((x) => x.id === a)?.activity).toBe('in_meeting');
    // Salle occupée
    expect(
      (await call('POST', '/v1/meetings', { topic: 'Autre', participantIds: [a, b] })).statusCode,
    ).toBe(409);
    {
      const f = await foldAll(db, snap);
      expect(f.meetings).toEqual(snap.meetings);
      for (const id of [a, b])
        expect(f.agents.find((x) => x.id === id)).toEqual(snap.agents.find((x) => x.id === id));
    }

    const end = await call('POST', `/v1/meetings/${meetingId}/end`, {
      notes: 'On priorise les devis.',
      decisions: [{ decision: 'Envoyer 3 devis', ownerAgentId: a }],
    });
    expect(end.statusCode).toBe(200);
    const minutesTaskId = end.json().data.minutesTaskId as string;
    const task = await db.task.findUniqueOrThrow({ where: { id: minutesTaskId } });
    expect(task.agentId).toBe(b);
    expect(task.title).toBe('Compte rendu — Point hebdo');
    snap = (await loadSnapshot(db, orgId))!;
    expect(snap.meetings.find((x) => x.id === meetingId)).toMatchObject({ status: 'completed' });
    expect(snap.agents.find((x) => x.id === a)?.activity).not.toBe('in_meeting');
    {
      const f = await foldAll(db, snap);
      expect(f.meetings).toEqual(snap.meetings);
      for (const id of [a, b])
        expect(f.agents.find((x) => x.id === id)).toEqual(snap.agents.find((x) => x.id === id));
    }
    // Clôture idempotente
    expect(
      (await call('POST', `/v1/meetings/${meetingId}/end`, {})).json().data.minutesTaskId,
    ).toBeNull();
  });

  it('se termine seule à l’heure prévue (horloge du worker), sans compte rendu si non demandé', async () => {
    const a = await newAgent('Alice');
    const b = await newAgent('Bruno');
    const r = await call('POST', '/v1/meetings', {
      topic: 'Café',
      participantIds: [a, b],
      durationMin: 5,
    });
    const { meetingId } = r.json().data;
    expect(await endDueMeetings(db, new Date())).toBe(0);
    expect(await endDueMeetings(db, new Date(Date.now() + 6 * 60_000))).toBe(1);
    const m = await db.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    expect(m.status).toBe('completed');
    expect(await db.task.count({ where: { orgId, title: { startsWith: 'Compte rendu' } } })).toBe(
      0,
    );
  });
});
