import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateTaskRequestSchema,
  IdempotencyKeySchema,
  InvocationStatusSchema,
  SlugIdSchema,
  TaskStatusSchema,
} from '@company-os/contracts';
import {
  agentView,
  createTask,
  DomainError,
  invocationView,
  listEventsAfter,
  listEventsByCorrelation,
  loadSnapshot,
  taskView,
  toolView,
  type Db,
} from '@company-os/db';
import { principalOf, requireRole, type AuthConfig } from '../auth';

const Id = z.object({ id: z.uuid() });
const SlugParam = z.object({ id: SlugIdSchema });
const Limit = z.coerce.number().int().min(1).max(200).default(50);

export function registerV1(app: FastifyInstance, db: Db, auth: AuthConfig): void {
  const meta = { schemaVersion: 1 };

  app.get('/v1/me', async (req) => {
    const p = principalOf(req, auth);
    return { data: { ...p, capabilities: { createTask: p.role !== 'viewer' } }, meta };
  });

  app.get('/v1/bootstrap', async (req) => {
    const p = principalOf(req, auth);
    const snap = await loadSnapshot(db, p.orgId);
    if (!snap) throw new DomainError('NOT_FOUND', 'Organisation introuvable');
    return { data: snap, meta };
  });

  app.get('/v1/departments', async (req) => {
    const p = principalOf(req, auth);
    const rows = await db.department.findMany({
      where: { orgId: p.orgId },
      include: { agents: { where: { deletedAt: null }, select: { id: true, status: true } } },
      orderBy: { id: 'asc' },
    });
    return {
      data: rows.map((d) => ({
        id: d.id,
        name: d.name,
        color: d.color,
        capacity: d.capacity,
        managerAgentId: d.managerAgentId,
        agentIds: d.agents.map((a) => a.id),
      })),
      meta,
    };
  });

  app.get('/v1/agents', async (req) => {
    const p = principalOf(req, auth);
    const q = z.object({ departmentId: SlugIdSchema.optional() }).parse(req.query);
    const rows = await db.agent.findMany({
      where: {
        orgId: p.orgId,
        deletedAt: null,
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      },
      orderBy: { id: 'asc' },
    });
    return { data: rows.map(agentView), meta };
  });

  app.get('/v1/agents/:id', async (req) => {
    const p = principalOf(req, auth);
    const { id } = SlugParam.parse(req.params);
    const agent = await db.agent.findFirst({
      where: { id, orgId: p.orgId, deletedAt: null },
      include: { grants: true },
    });
    if (!agent) throw new DomainError('NOT_FOUND', 'Agent introuvable');
    const [tasks, invocations] = await Promise.all([
      db.task.findMany({
        where: { orgId: p.orgId, agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.toolInvocation.findMany({
        where: { orgId: p.orgId, agentId: id },
        orderBy: { requestedAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      data: {
        agent: agentView(agent),
        grants: agent.grants.map((g) => ({ toolId: g.toolId, actions: g.actions })),
        recentTasks: tasks.map(taskView),
        recentInvocations: invocations.map(invocationView),
      },
      meta,
    };
  });

  app.get('/v1/tasks', async (req) => {
    const p = principalOf(req, auth);
    const q = z.object({ status: TaskStatusSchema.optional(), limit: Limit }).parse(req.query);
    const rows = await db.task.findMany({
      where: { orgId: p.orgId, ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return { data: rows.map(taskView), meta };
  });

  app.post('/v1/tasks', async (req, reply) => {
    const p = principalOf(req, auth);
    requireRole(p, 'operator');
    const key = IdempotencyKeySchema.safeParse(req.headers['idempotency-key']);
    if (!key.success)
      throw new DomainError(
        'VALIDATION_ERROR',
        'En-tête Idempotency-Key requis (8-128 caractères)',
      );
    const body = CreateTaskRequestSchema.parse(req.body);
    const { task, created } = await createTask(db, {
      orgId: p.orgId,
      kind: body.kind,
      agentId: body.agentId,
      requester: { kind: 'user', id: p.userId },
      idempotencyKey: key.data,
    });
    return reply
      .status(created ? 201 : 200)
      .send({ data: task, meta: { ...meta, idempotentReplay: !created } });
  });

  app.get('/v1/tasks/:id', async (req) => {
    const p = principalOf(req, auth);
    const { id } = Id.parse(req.params);
    const task = await db.task.findFirst({ where: { id, orgId: p.orgId } });
    if (!task) throw new DomainError('NOT_FOUND', 'Tâche introuvable');
    const [runs, invocations, events] = await Promise.all([
      db.agentRun.findMany({ where: { taskId: id }, orderBy: { startedAt: 'asc' } }),
      db.toolInvocation.findMany({ where: { taskId: id }, orderBy: { requestedAt: 'asc' } }),
      listEventsByCorrelation(db, p.orgId, task.correlationId),
    ]);
    return {
      data: {
        task: taskView(task),
        runs: runs.map((r) => ({
          id: r.id,
          provider: r.provider,
          model: r.model,
          status: r.status,
          stepCount: r.stepCount,
          startedAt: r.startedAt.toISOString(),
          endedAt: r.endedAt?.toISOString() ?? null,
          outcomeSummary: r.outcomeSummary,
        })),
        invocations: invocations.map(invocationView),
        events,
      },
      meta,
    };
  });

  app.get('/v1/tools', async (req) => {
    const p = principalOf(req, auth);
    const [tools, active] = await Promise.all([
      db.tool.findMany({
        where: { OR: [{ orgId: p.orgId }, { orgId: null }] },
        orderBy: { id: 'asc' },
      }),
      db.toolInvocation.groupBy({
        by: ['toolId'],
        where: { orgId: p.orgId, status: { in: ['requested', 'authorized', 'running'] } },
        _count: true,
      }),
    ]);
    const counts = new Map(active.map((a) => [a.toolId, a._count]));
    return {
      data: tools.map((t) => ({ ...toolView(t), activeInvocations: counts.get(t.id) ?? 0 })),
      meta,
    };
  });

  app.get('/v1/tool-invocations', async (req) => {
    const p = principalOf(req, auth);
    const q = z
      .object({
        status: InvocationStatusSchema.optional(),
        toolId: SlugIdSchema.optional(),
        limit: Limit,
      })
      .parse(req.query);
    const rows = await db.toolInvocation.findMany({
      where: {
        orgId: p.orgId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.toolId ? { toolId: q.toolId } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: q.limit,
    });
    return { data: rows.map(invocationView), meta };
  });

  app.get('/v1/tool-invocations/:id', async (req) => {
    const p = principalOf(req, auth);
    const { id } = Id.parse(req.params);
    const inv = await db.toolInvocation.findFirst({ where: { id, orgId: p.orgId } });
    if (!inv) throw new DomainError('NOT_FOUND', 'Invocation introuvable');
    const events = (await listEventsByCorrelation(db, p.orgId, inv.correlationId)).filter(
      (e) => e.aggregateId === id,
    );
    return {
      data: { invocation: invocationView(inv), redactedInput: inv.redactedInput, events },
      meta,
    };
  });

  app.get('/v1/events', async (req) => {
    const p = principalOf(req, auth);
    const q = z
      .object({
        afterSeq: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);
    const events = await listEventsAfter(db, p.orgId, q.afterSeq, q.limit);
    const org = await db.organization.findUniqueOrThrow({ where: { id: p.orgId } });
    return {
      data: events,
      meta: { ...meta, lastSeq: Number(org.lastSeq), hasMore: events.length === q.limit },
    };
  });
}
