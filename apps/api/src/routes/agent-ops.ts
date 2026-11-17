import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CHAIN_TEMPLATES } from '@company-os/contracts';
import {
  archiveObjective,
  costReport,
  createObjective,
  decideChain,
  listChains,
  moveDepartment,
  getBranding,
  saveBranding,
  listObjectives,
  recordFeedback,
  startChain,
  type Db,
} from '@company-os/db';
import { loadPricing } from '@company-os/policies';
import { principalOf, requireRole } from '../auth';

const meta = { schemaVersion: 1 };
const Id = z.object({ id: z.uuid() });

/** Objectifs, retours, missions en chaîne et tableau des coûts (ADR-069). */
export function registerAgentOps(app: FastifyInstance, db: Db): void {
  // ---------- Objectifs ----------
  app.get('/v1/objectives', async (req) => {
    const p = principalOf(req);
    return { data: await listObjectives(db, p.orgId), meta };
  });
  app.post('/v1/objectives', async (req, reply) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const body = z
      .object({
        departmentId: z.string().min(1).max(80),
        title: z.string().trim().min(3).max(120),
        target: z.number().int().min(1).max(10_000),
        periodEnd: z.iso.datetime().optional(),
      })
      .strict()
      .parse(req.body);
    const r = await createObjective(db, {
      orgId: p.orgId,
      actorId: p.userId,
      departmentId: body.departmentId,
      title: body.title,
      target: body.target,
      ...(body.periodEnd ? { periodEnd: new Date(body.periodEnd) } : {}),
    });
    return reply.status(201).send({ data: r, meta });
  });
  app.post('/v1/objectives/:id/archive', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const { id } = Id.parse(req.params);
    await archiveObjective(db, { orgId: p.orgId, actorId: p.userId, objectiveId: id });
    return { data: { archived: true }, meta };
  });

  // ---------- Retours de l'humain ----------
  app.post('/v1/tasks/:id/feedback', async (req, reply) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    const { id } = Id.parse(req.params);
    const body = z
      .object({
        kind: z.enum(['correction', 'rejet']),
        note: z.string().trim().min(3).max(600),
        relaunch: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const r = await recordFeedback(db, {
      orgId: p.orgId,
      actor: { kind: 'user', id: p.userId },
      taskId: id,
      ...body,
    });
    return reply.status(201).send({ data: r, meta });
  });

  // ---------- Missions en chaîne ----------
  app.get('/v1/chain-templates', async () => ({ data: CHAIN_TEMPLATES, meta }));
  app.get('/v1/chains', async (req) => {
    const p = principalOf(req);
    return { data: await listChains(db, p.orgId), meta };
  });
  app.post('/v1/chains', async (req, reply) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    const body = z
      .object({
        templateId: z.string().min(1).max(60),
        topic: z.string().trim().min(3).max(300),
        agentIds: z.array(z.string().min(1).max(64)).min(1).max(6),
      })
      .strict()
      .parse(req.body);
    const r = await startChain(db, { orgId: p.orgId, actorId: p.userId, ...body });
    return reply.status(201).send({ data: r, meta });
  });
  app.post('/v1/chains/:id/decide', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    const { id } = Id.parse(req.params);
    const { decision } = z
      .object({ decision: z.enum(['validate', 'cancel']) })
      .strict()
      .parse(req.body);
    await decideChain(db, { orgId: p.orgId, actorId: p.userId, chainId: id, decision });
    return { data: { decided: decision }, meta };
  });

  // ---------- Plateau : déplacer / échanger des zones, personnalisation ----------
  app.post('/v1/departments/:id/move', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { roomId } = z
      .object({ roomId: z.string().min(1).max(64) })
      .strict()
      .parse(req.body);
    await moveDepartment(db, { orgId: p.orgId, actorId: p.userId, departmentId: id, roomId });
    return { data: { moved: true }, meta };
  });
  app.get('/v1/branding', async (req) => {
    const p = principalOf(req);
    return { data: await getBranding(db, p.orgId), meta };
  });
  app.post('/v1/branding', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const body = z
      .object({
        neonText: z.string().trim().min(1).max(20),
        neonColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        // Image matricielle seulement (jamais de SVG : aucun script possible), 200 Ko au plus.
        logo: z
          .string()
          .max(280_000)
          .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
          .nullable(),
        zoneStyles: z.record(z.string().max(64), z.enum(['modern', 'cosy', 'tech'])),
      })
      .strict()
      .parse(req.body);
    return { data: await saveBranding(db, p.orgId, body), meta };
  });

  // ---------- Coûts ----------
  app.get('/v1/costs', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    const q = z
      .object({ days: z.coerce.number().int().min(1).max(365).optional() })
      .parse(req.query);
    const since = q.days ? new Date(Date.now() - q.days * 86_400_000) : undefined;
    return { data: await costReport(db, p.orgId, loadPricing(), since), meta };
  });
}
