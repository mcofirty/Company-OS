import { OPEN_TASK_STATUSES } from '@company-os/contracts';
import type { Db } from '../client';

/**
 * État RÉEL de l'organisation pour l'outil « Entreprise » (rapports du DG) : agents, missions
 * ouvertes et récentes, blocages, validations en attente, budgets. Données bornées et sans
 * secret ; `focus` restreint à un département ou un agent (nom ou identifiant).
 */
export async function companyStatus(db: Db, orgId: string, focus = 'tout') {
  const f = focus.trim().toLowerCase();
  const all = !f || f === 'tout' || f === 'all';
  const [org, departments, agents] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId } }),
    db.department.findMany({ where: { orgId } }),
    db.agent.findMany({ where: { orgId, deletedAt: null }, orderBy: { name: 'asc' } }),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const scoped = all
    ? agents
    : agents.filter(
        (a) =>
          a.id.toLowerCase() === f ||
          a.name.toLowerCase() === f ||
          (deptName.get(a.departmentId) ?? '').toLowerCase() === f,
      );
  const ids = scoped.map((a) => a.id);
  const name = new Map(agents.map((a) => [a.id, a.name]));
  const [open, recent, approvals, budgets] = await Promise.all([
    db.task.findMany({
      where: { orgId, agentId: { in: ids }, status: { in: [...OPEN_TASK_STATUSES] } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    db.task.findMany({
      where: { orgId, agentId: { in: ids }, status: { notIn: [...OPEN_TASK_STATUSES] } },
      orderBy: { endedAt: 'desc' },
      take: 15,
    }),
    db.approvalRequest.count({ where: { orgId, status: 'pending' } }),
    db.budget.findMany({ where: { orgId } }),
  ]);
  const usd = (m: number): number => Math.round(m / 10_000) / 100;
  const orgBudget = budgets.find((b) => b.scopeType === 'org');
  return {
    generatedAt: new Date().toISOString(),
    organization: org.name,
    scope: all ? 'toute l’entreprise' : focus,
    agents: scoped.map((a) => {
      const b = budgets.find((x) => x.scopeType === 'agent' && x.scopeId === a.id);
      return {
        id: a.id,
        name: a.name,
        title: a.title,
        department: deptName.get(a.departmentId) ?? a.departmentId,
        status: a.status,
        activity: a.activity,
        budgetUsedUsd: b ? usd(b.usedMicros) : null,
        budgetLimitUsd: b ? usd(b.limitMicros) : null,
      };
    }),
    openMissions: open.map((t) => ({
      id: t.id,
      title: t.title,
      agent: name.get(t.agentId) ?? t.agentId,
      status: t.status,
      blockedReason: t.status === 'blocked' ? t.failureCode : null,
      createdAt: t.createdAt.toISOString(),
    })),
    recentMissions: recent.map((t) => ({
      id: t.id,
      title: t.title,
      agent: name.get(t.agentId) ?? t.agentId,
      status: t.status,
      result: (t.resultSummary ?? '').slice(0, 400),
      endedAt: t.endedAt?.toISOString() ?? null,
    })),
    pendingApprovals: approvals,
    organizationBudget: orgBudget
      ? { usedUsd: usd(orgBudget.usedMicros), limitUsd: usd(orgBudget.limitMicros) }
      : null,
  };
}
