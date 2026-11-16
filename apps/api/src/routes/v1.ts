import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  toolAvailableIn,
  toolById,
  CancelTaskRequestSchema,
  CreateAgentRequestSchema,
  CreateTaskRequestSchema,
  IdempotencyKeySchema,
  SystemControlRequestSchema,
  ApprovalStatusSchema,
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
  setSystemPaused,
  decideApproval,
  setAgentLifecycle,
  ackAlert,
  alertView,
  metricsSummary,
  approvalView,
  meetingView,
  createAgentByAdmin,
  orgsOfUser,
  cancelTask,
  retryTask,
  getDocument,
  listDocuments,
} from '@company-os/db';
import { principalOf, requireRole } from '../auth';

const Id = z.object({ id: z.uuid() });
const SlugParam = z.object({ id: SlugIdSchema });
const Limit = z.coerce.number().int().min(1).max(200).default(50);

export type ApprovalSignaler = (
  workflowId: string,
  approvalId: string,
  decision: 'approved' | 'rejected',
) => Promise<void>;

const DecideBody = z
  .object({ decision: z.enum(['approve', 'reject']), reason: z.string().min(3).max(280) })
  .strict();

export function registerV1(
  app: FastifyInstance,
  db: Db,
  signalApproval?: ApprovalSignaler,
  opts: { hideDemoOrg?: boolean } = {},
): void {
  const meta = { schemaVersion: 1 };

  app.get('/v1/me', async (req) => {
    const p = principalOf(req);
    const operator = p.role !== 'viewer';
    const admin = p.role === 'admin';
    const orgs = await orgsOfUser(db, p.userId, { hideDemo: opts.hideDemoOrg });
    const live = orgs.find((o) => o.id === p.orgId)?.mode === 'live';
    return {
      data: {
        ...p,
        // Organisations accessibles (sélecteur du cockpit) ; la courante est `orgId`.
        orgs,
        // Indicatif pour l'UI : le serveur revérifie chaque action.
        capabilities: {
          createTask: operator,
          pauseAgent: operator,
          deactivateAgent: admin,
          decideApproval: admin,
          systemControl: admin,
          ackAlert: operator,
          createAgent: admin && live,
          createMission: operator && live,
          manageConnectors: admin && live,
        },
      },
      meta,
    };
  });

  /** Création d'un agent par un administrateur (organisation live uniquement). */
  app.post('/v1/agents', async (req, reply) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const key = IdempotencyKeySchema.safeParse(req.headers['idempotency-key']);
    if (!key.success) throw new DomainError('VALIDATION_ERROR', 'En-tête Idempotency-Key requis');
    const body = CreateAgentRequestSchema.parse(req.body);
    const { agentId, created } = await createAgentByAdmin(db, {
      orgId: p.orgId,
      actor: { kind: 'user', id: p.userId },
      req: body,
      idempotencyKey: key.data,
    });
    return reply
      .status(created ? 201 : 200)
      .send({ data: { agentId }, meta: { ...meta, idempotentReplay: !created } });
  });

  app.get('/v1/bootstrap', async (req) => {
    const p = principalOf(req);
    const snap = await loadSnapshot(db, p.orgId);
    if (!snap) throw new DomainError('NOT_FOUND', 'Organisation introuvable');
    return { data: snap, meta };
  });

  app.get('/v1/departments', async (req) => {
    const p = principalOf(req);
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
    const p = principalOf(req);
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
    const p = principalOf(req);
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
    const p = principalOf(req);
    const q = z.object({ status: TaskStatusSchema.optional(), limit: Limit }).parse(req.query);
    const rows = await db.task.findMany({
      where: { orgId: p.orgId, ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return { data: rows.map(taskView), meta };
  });

  app.post('/v1/tasks', async (req, reply) => {
    const p = principalOf(req);
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
      ...(body.mission ? { mission: body.mission } : {}),
      requester: { kind: 'user', id: p.userId },
      idempotencyKey: key.data,
    });
    return reply
      .status(created ? 201 : 200)
      .send({ data: task, meta: { ...meta, idempotentReplay: !created } });
  });

  /** Annulation humaine (tâche en file ou bloquée), motif obligatoire. */
  app.post('/v1/tasks/:id/cancel', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    if (!IdempotencyKeySchema.safeParse(req.headers['idempotency-key']).success) {
      throw new DomainError('VALIDATION_ERROR', 'En-tête Idempotency-Key requis');
    }
    const { id } = Id.parse(req.params);
    const { reason } = CancelTaskRequestSchema.parse(req.body);
    const task = await cancelTask(db, {
      orgId: p.orgId,
      taskId: id,
      reason,
      actor: { kind: 'user', id: p.userId },
    });
    return { data: task, meta };
  });

  /** Relance : nouvelle tâche identique ; la tâche bloquée est annulée et reliée à la nouvelle. */
  app.post('/v1/tasks/:id/retry', async (req, reply) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    if (!IdempotencyKeySchema.safeParse(req.headers['idempotency-key']).success) {
      throw new DomainError('VALIDATION_ERROR', 'En-tête Idempotency-Key requis');
    }
    const { id } = Id.parse(req.params);
    const r = await retryTask(db, {
      orgId: p.orgId,
      taskId: id,
      actor: { kind: 'user', id: p.userId },
    });
    return reply.status(201).send({ data: r, meta });
  });

  /** Documents réels produits par les agents (bibliothèque). */
  app.get('/v1/documents', async (req) => {
    const p = principalOf(req);
    const q = z
      .object({ taskId: z.uuid().optional(), query: z.string().max(120).optional() })
      .parse(req.query);
    return {
      data: await listDocuments(db, p.orgId, {
        ...(q.taskId ? { taskId: q.taskId } : {}),
        ...(q.query ? { query: q.query } : {}),
        limit: 100,
      }),
      meta,
    };
  });
  app.get('/v1/documents/:id', async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    return { data: await getDocument(db, p.orgId, id), meta };
  });

  app.get('/v1/tasks/:id', async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    const task = await db.task.findFirst({ where: { id, orgId: p.orgId } });
    if (!task) throw new DomainError('NOT_FOUND', 'Tâche introuvable');
    const [runs, invocations, events] = await Promise.all([
      db.agentRun.findMany({
        where: { taskId: id },
        orderBy: { startedAt: 'asc' },
        include: { usages: { orderBy: { step: 'asc' } } },
      }),
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
          agentVersion: r.agentVersion,
          workflowId: r.workflowId,
          status: r.status,
          stepCount: r.stepCount,
          llmCalls: r.llmCalls,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costMicros: r.costMicros,
          costSource: r.costSource,
          startedAt: r.startedAt.toISOString(),
          endedAt: r.endedAt?.toISOString() ?? null,
          outcomeSummary: r.outcomeSummary,
          failureCode: r.failureCode,
          llmCallsDetail: r.usages.map((u) => ({
            step: u.step,
            model: u.model,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            cacheReadTokens: u.cacheReadTokens,
            costMicros: u.costMicros,
            measuredOrEstimated: u.measuredOrEstimated,
            pricingVersion: u.pricingVersion,
            stopReason: u.stopReason,
          })),
        })),
        invocations: invocations.map(invocationView),
        events,
      },
      meta,
    };
  });

  app.get('/v1/tools', async (req) => {
    const p = principalOf(req);
    const [org, allTools, active] = await Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: p.orgId } }),
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
    // Même règle que le snapshot : une org live ne voit que les outils réels.
    const tools = allTools.filter((t) => {
      const entry = toolById(t.id);
      if (entry) return toolAvailableIn(entry, org.mode, org.allowDemoTools);
      return t.orgId === p.orgId && t.archivedAt === null && org.mode === 'live'; // connecteurs
    });
    return {
      data: tools.map((t) => ({ ...toolView(t), activeInvocations: counts.get(t.id) ?? 0 })),
      meta,
    };
  });

  app.get('/v1/tool-invocations', async (req) => {
    const p = principalOf(req);
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
    const p = principalOf(req);
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
    const p = principalOf(req);
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

  // Kill switch d'organisation (docs/04 §10) : admin uniquement, audité par événement.
  for (const [path, paused] of [
    ['/v1/system/pause', true],
    ['/v1/system/resume', false],
  ] as const) {
    app.post(path, async (req) => {
      const p = principalOf(req);
      requireRole(p, 'admin');
      const key = IdempotencyKeySchema.safeParse(req.headers['idempotency-key']);
      if (!key.success) throw new DomainError('VALIDATION_ERROR', 'En-tête Idempotency-Key requis');
      const body = SystemControlRequestSchema.parse(req.body);
      const r = await setSystemPaused(db, {
        orgId: p.orgId,
        paused,
        reason: body.reason,
        actor: { kind: 'user', id: p.userId },
      });
      return { data: { paused, changed: r.changed }, meta };
    });
  }

  app.get('/v1/budgets', async (req) => {
    const p = principalOf(req);
    const rows = await db.budget.findMany({
      where: { orgId: p.orgId },
      orderBy: [{ scopeType: 'asc' }, { scopeId: 'asc' }],
    });
    return {
      data: rows.map((b) => ({
        id: b.id,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
        period: b.period,
        limitMicros: b.limitMicros,
        usedMicros: b.usedMicros,
        reservedMicros: b.reservedMicros,
        hardStop: b.hardStop,
        alertThreshold: b.alertThreshold,
      })),
      meta: { ...meta, unit: 'micro-USD' },
    };
  });

  // ---------- Validations humaines (docs/05 §5, docs/07) ----------
  app.get('/v1/approvals', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    const q = z.object({ status: ApprovalStatusSchema.optional(), limit: Limit }).parse(req.query);
    const rows = await db.approvalRequest.findMany({
      where: { orgId: p.orgId, ...(q.status ? { status: q.status } : {}) },
      orderBy: { requestedAt: 'desc' },
      take: q.limit,
    });
    return { data: rows.map(approvalView), meta };
  });

  app.get('/v1/approvals/:id', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    const { id } = Id.parse(req.params);
    const a = await db.approvalRequest.findFirst({ where: { id, orgId: p.orgId } });
    if (!a) throw new DomainError('NOT_FOUND', 'Demande introuvable');
    return { data: approvalView(a), meta };
  });

  app.post('/v1/approvals/:id/decide', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const key = IdempotencyKeySchema.safeParse(req.headers['idempotency-key']);
    if (!key.success) throw new DomainError('VALIDATION_ERROR', 'En-tête Idempotency-Key requis');
    const { id } = Id.parse(req.params);
    const body = DecideBody.parse(req.body);
    const decision = body.decision === 'approve' ? 'approved' : 'rejected';
    const r = await decideApproval(db, {
      orgId: p.orgId,
      approvalId: id,
      decision,
      reviewer: { kind: 'user', id: p.userId },
      reason: body.reason,
    });
    // Reprise du workflow par signal Temporal (le workflow revérifie aussi en base).
    let signaled = false;
    if (r.workflowId && signalApproval) {
      try {
        await signalApproval(r.workflowId, id, decision);
        signaled = true;
      } catch (err) {
        req.log.warn(
          { err, workflowId: r.workflowId },
          'signal Temporal non délivré (repli par interrogation)',
        );
      }
    }
    return { data: { approval: r.approval, changed: r.changed, signaled }, meta };
  });

  // ---------- Réunions ----------
  app.get('/v1/meetings', async (req) => {
    const p = principalOf(req);
    const rows = await db.meeting.findMany({
      where: { orgId: p.orgId },
      include: { participants: true },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return { data: rows.map(meetingView), meta };
  });

  app.get('/v1/meetings/:id', async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    const m = await db.meeting.findFirst({
      where: { id, orgId: p.orgId },
      include: { participants: true },
    });
    if (!m) throw new DomainError('NOT_FOUND', 'Réunion introuvable');
    const task = m.taskId ? await db.task.findUnique({ where: { id: m.taskId } }) : null;
    const events = task
      ? (await listEventsByCorrelation(db, p.orgId, task.correlationId)).filter(
          (e) => e.aggregateId === m.id,
        )
      : [];
    const children = m.taskIdsCreated.length
      ? await db.task.findMany({ where: { id: { in: m.taskIdsCreated } } })
      : [];
    return {
      data: { meeting: meetingView(m), events, tasksCreated: children.map(taskView) },
      meta,
    };
  });

  // ---------- Cycle de vie des agents ----------
  const LifecycleBody = z.object({ reason: z.string().min(3).max(200) }).strict();
  for (const action of ['pause', 'resume', 'deactivate'] as const) {
    app.post(`/v1/agents/:id/${action}`, async (req) => {
      const p = principalOf(req);
      requireRole(p, action === 'deactivate' ? 'admin' : 'operator');
      const key = IdempotencyKeySchema.safeParse(req.headers['idempotency-key']);
      if (!key.success) throw new DomainError('VALIDATION_ERROR', 'En-tête Idempotency-Key requis');
      const { id } = SlugParam.parse(req.params);
      const body = LifecycleBody.parse(req.body);
      const r = await setAgentLifecycle(db, {
        orgId: p.orgId,
        agentId: id,
        action,
        reason: body.reason,
        actor: { kind: 'user', id: p.userId },
      });
      return { data: r, meta };
    });
  }

  // ---------- Alertes ----------
  app.get('/v1/alerts', async (req) => {
    const p = principalOf(req);
    const q = z
      .object({ unacked: z.enum(['true', 'false']).optional(), limit: Limit })
      .parse(req.query);
    const rows = await db.alert.findMany({
      where: { orgId: p.orgId, ...(q.unacked === 'true' ? { ackedAt: null } : {}) },
      orderBy: { eventSeq: 'desc' },
      take: q.limit,
    });
    return { data: rows.map(alertView), meta };
  });

  app.post('/v1/alerts/:id/ack', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'operator');
    const { id } = Id.parse(req.params);
    return {
      data: alertView(await ackAlert(db, { orgId: p.orgId, alertId: id, userId: p.userId })),
      meta,
    };
  });

  // ---------- KPI par fenêtre et santé des outils ----------
  app.get('/v1/metrics/summary', async (req) => {
    const p = principalOf(req);
    const q = z.object({ window: z.enum(['1h', '24h', '7d']).default('24h') }).parse(req.query);
    return {
      data: await metricsSummary(db, p.orgId, q.window),
      meta: { ...meta, measured: 'tokens mesurés ; coûts estimés (grille versionnée)' },
    };
  });
}
