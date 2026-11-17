import { randomUUID } from 'node:crypto';
import type { PayloadOf } from '@company-os/contracts';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx, type OrgTxContext } from '../events';

/**
 * Connecteurs MCP en libre-service (docs/05 §11) : un administrateur humain ajoute un serveur
 * MCP, choisit pour chaque outil découvert sa politique, puis accorde ces outils à des agents.
 * Ce module ne fait AUCUN appel réseau : la découverte est faite par l'appelant (API) puis
 * enregistrée ici, dans une transaction qui émet l'événement correspondant.
 */
export const CONNECTOR_POLICIES = ['read', 'approval', 'disabled'] as const;
export type ConnectorPolicy = (typeof CONNECTOR_POLICIES)[number];
export const CONNECTOR_TOOL_PREFIX = 'mcp-';
export const isConnectorToolId = (toolId: string): boolean =>
  toolId.startsWith(CONNECTOR_TOOL_PREFIX);

export interface DiscoveredToolInput {
  remoteName: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint: boolean;
}

export interface ConnectorToolView {
  action: string;
  remoteName: string;
  title: string;
  description: string;
  policy: ConnectorPolicy;
  readOnlyHint: boolean;
}
export interface ConnectorView {
  id: string;
  toolId: string;
  name: string;
  /** Origine + chemin seulement : la query (qui peut contenir un secret) n'est jamais renvoyée. */
  endpoint: string;
  hasSecret: boolean;
  authHeader: string;
  status: 'healthy' | 'degraded' | 'down';
  /** Application du catalogue et mode de connexion. */
  app: string | null;
  authKind: string;
  lastError: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  tools: ConnectorToolView[];
}

const PALETTE = ['#4f7cff', '#2bb3a3', '#e0803a', '#9b5de5', '#d94f70', '#3c9d4e', '#c9a227'];

export function safeEndpoint(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return '(URL invalide)';
  }
}

const codeOf = (name: string): string =>
  (
    name
      .normalize('NFD')
      .replace(/[^A-Za-z0-9 ]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('') || 'MCP'
  )
    .toUpperCase()
    .slice(0, 3)
    .padEnd(2, 'X');

/** Noms d'action côté plateforme : `[a-z0-9_-]`, ≤ 48 caractères, uniques. */
export function actionNames(remoteNames: string[]): string[] {
  const used = new Set<string>();
  return remoteNames.map((n) => {
    const base =
      n
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase()
        .slice(0, 44) || 'tool';
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    return name;
  });
}

const riskOf = (p: ConnectorPolicy) =>
  p === 'read' ? ('read' as const) : ('external_write' as const);

type ToolRow = {
  action: string;
  remoteName: string;
  description: string;
  policy: string;
  readOnlyHint: boolean;
};

/** Actions visibles (machine-outil) : outils non désactivés, risque selon la politique. */
function actionsOf(tools: ToolRow[]): PayloadOf<'tool.connector.updated'>['actions'] {
  return tools
    .filter((t) => t.policy !== 'disabled')
    .sort((a, b) => (a.action < b.action ? -1 : 1))
    .slice(0, 200)
    .map((t) => ({
      action: t.action,
      kind: t.readOnlyHint ? ('read' as const) : ('execute' as const),
      risk: riskOf(t.policy as ConnectorPolicy),
      label: t.remoteName.slice(0, 80),
    }));
}

async function emitConnector(
  ctx: OrgTxContext,
  connectorId: string,
  actorId: string,
  change: PayloadOf<'tool.connector.updated'>['change'],
): Promise<string> {
  const c = await ctx.tx.connector.findUniqueOrThrow({
    where: { id: connectorId },
    include: { tools: true, tool: true },
  });
  const actions = actionsOf(c.tools);
  await ctx.tx.tool.update({
    where: { id: c.toolId },
    data: { actions, status: c.status, name: c.name, archivedAt: c.removedAt },
  });
  const version =
    (await ctx.tx.eventLog.count({ where: { orgId: ctx.orgId, aggregateId: c.toolId } })) + 1;
  return ctx.emit({
    classification: 'internal',
    aggregateType: 'tool',
    aggregateId: c.toolId,
    aggregateVersion: version,
    correlationId: randomUUID(),
    causationId: null,
    actor: { kind: 'user', id: actorId },
    provenance: 'live',
    type: 'tool.connector.updated',
    payload: {
      toolId: c.toolId,
      name: c.name,
      code: c.tool.code,
      color: c.tool.color,
      app: c.app,
      status: c.status as 'healthy' | 'degraded' | 'down',
      removed: c.removedAt !== null,
      actions,
      change,
    },
  });
}

function assertLive(ctx: OrgTxContext): void {
  if (ctx.mode !== 'live') {
    throw new DomainError('POLICY_DENIED', 'Connecteurs réservés aux organisations live');
  }
}

/** Ajout d'un connecteur (après découverte réussie). Politique par défaut : validation humaine. */
export async function createConnector(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    name: string;
    url: string;
    secretSealed: string | null;
    authHeader: string;
    discovered: DiscoveredToolInput[];
    /** Application du catalogue (github, notion, zapier…). */
    app?: string | null;
    authKind?: 'token' | 'oauth' | 'url' | 'none';
    /** Adresse complète chiffrée (contient un secret) ; `url` reçoit alors la version affichable. */
    urlSealed?: string | null;
    oauthSealed?: string | null;
  },
): Promise<{ connectorId: string; toolId: string }> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    assertLive(ctx);
    const active = await ctx.tx.connector.count({ where: { orgId: ctx.orgId, removedAt: null } });
    if (active >= 20) throw new DomainError('CONFLICT', 'Maximum 20 connecteurs par organisation');
    const connectorId = randomUUID();
    const toolId = `${CONNECTOR_TOOL_PREFIX}${connectorId.slice(0, 8)}`;
    const color = PALETTE[parseInt(connectorId.slice(0, 2), 16) % PALETTE.length]!;
    await ctx.tx.tool.create({
      data: {
        id: toolId,
        orgId: ctx.orgId,
        name: input.name,
        code: codeOf(input.name),
        category: 'connector',
        color,
        actions: [],
        status: 'healthy',
      },
    });
    await ctx.tx.connector.create({
      data: {
        id: connectorId,
        orgId: ctx.orgId,
        toolId,
        name: input.name,
        url: input.url,
        secretSealed: input.secretSealed,
        authHeader: input.authHeader,
        app: input.app ?? null,
        authKind: input.authKind ?? (input.secretSealed ? 'token' : 'none'),
        urlSealed: input.urlSealed ?? null,
        oauthSealed: input.oauthSealed ?? null,
        status: 'healthy',
        lastSyncAt: ctx.now,
        createdBy: input.actorId,
      },
    });
    const names = actionNames(input.discovered.map((d) => d.remoteName));
    await ctx.tx.connectorTool.createMany({
      data: input.discovered.map((d, i) => ({
        connectorId,
        action: names[i]!,
        remoteName: d.remoteName,
        description: d.description,
        inputSchema: d.inputSchema as object,
        policy: 'approval',
        readOnlyHint: d.readOnlyHint,
      })),
    });
    await emitConnector(ctx, connectorId, input.actorId, 'added');
    return { connectorId, toolId };
  });
  return result;
}

async function liveConnector(ctx: OrgTxContext, connectorId: string) {
  assertLive(ctx);
  const c = await ctx.tx.connector.findFirst({
    where: { id: connectorId, orgId: ctx.orgId, removedAt: null },
    include: { tools: true },
  });
  if (!c) throw new DomainError('NOT_FOUND', 'Connecteur introuvable');
  return c;
}

/**
 * Resynchronisation : outils nouveaux => politique « validation » ; outils disparus => supprimés
 * (les droits qui les citent ne s'exécutent plus : la passerelle refuse une action inconnue).
 * En cas d'échec réseau, `error` passe le connecteur en « down » sans toucher aux outils.
 */
export async function syncConnector(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    connectorId: string;
    discovered?: DiscoveredToolInput[];
    error?: string;
  },
): Promise<void> {
  await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const c = await liveConnector(ctx, input.connectorId);
    if (!input.discovered) {
      await ctx.tx.connector.update({
        where: { id: c.id },
        data: { status: 'down', lastError: (input.error ?? 'ERREUR').slice(0, 200) },
      });
      await emitConnector(ctx, c.id, input.actorId, 'error');
      return;
    }
    const byRemote = new Map(c.tools.map((t) => [t.remoteName, t]));
    const keep = new Set<string>();
    const taken = new Set(c.tools.map((t) => t.action));
    for (const d of input.discovered) {
      const prior = byRemote.get(d.remoteName);
      if (prior) {
        keep.add(prior.action);
        await ctx.tx.connectorTool.update({
          where: { connectorId_action: { connectorId: c.id, action: prior.action } },
          data: {
            description: d.description,
            inputSchema: d.inputSchema as object,
            readOnlyHint: d.readOnlyHint,
            updatedAt: ctx.now,
          },
        });
      } else {
        const [base] = actionNames([d.remoteName]);
        let action = base!;
        for (let i = 2; taken.has(action); i++) action = `${base}_${i}`;
        taken.add(action);
        keep.add(action);
        await ctx.tx.connectorTool.create({
          data: {
            connectorId: c.id,
            action,
            remoteName: d.remoteName,
            description: d.description,
            inputSchema: d.inputSchema as object,
            policy: 'approval',
            readOnlyHint: d.readOnlyHint,
          },
        });
      }
    }
    await ctx.tx.connectorTool.deleteMany({
      where: { connectorId: c.id, action: { notIn: [...keep] } },
    });
    await ctx.tx.connector.update({
      where: { id: c.id },
      data: { status: 'healthy', lastError: null, lastSyncAt: ctx.now },
    });
    await emitConnector(ctx, c.id, input.actorId, 'synced');
  });
}

/** Politique d'un outil distant, choisie par l'administrateur. */
export async function setConnectorToolPolicy(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    connectorId: string;
    action: string;
    policy: ConnectorPolicy;
  },
): Promise<void> {
  await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const c = await liveConnector(ctx, input.connectorId);
    if (!c.tools.some((t) => t.action === input.action)) {
      throw new DomainError('NOT_FOUND', 'Outil introuvable sur ce connecteur');
    }
    await ctx.tx.connectorTool.update({
      where: { connectorId_action: { connectorId: c.id, action: input.action } },
      data: { policy: input.policy, updatedAt: ctx.now },
    });
    await emitConnector(ctx, c.id, input.actorId, 'policy');
  });
}

/**
 * Retrait : jeton effacé, machine retirée du QG, droits des agents sur ce connecteur supprimés
 * (chaque agent concerné reçoit un `agent.grants.updated`). L'historique des invocations reste.
 */
export async function removeConnector(
  db: Db,
  input: { orgId: string; actorId: string; connectorId: string },
): Promise<void> {
  await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const c = await liveConnector(ctx, input.connectorId);
    await ctx.tx.connector.update({
      where: { id: c.id },
      data: { removedAt: ctx.now, secretSealed: null },
    });
    const grants = await ctx.tx.agentToolGrant.findMany({ where: { toolId: c.toolId } });
    await ctx.tx.agentToolGrant.deleteMany({ where: { toolId: c.toolId } });
    for (const g of grants) {
      const rest = await ctx.tx.agentToolGrant.findMany({ where: { agentId: g.agentId } });
      ctx.emit(grantsEvent(input.actorId, g.agentId, rest));
    }
    await emitConnector(ctx, c.id, input.actorId, 'removed');
  });
}

const grantsEvent = (
  actorId: string,
  agentId: string,
  rows: { toolId: string; actions: string[] }[],
) =>
  ({
    classification: 'internal',
    aggregateType: 'agent',
    aggregateId: agentId,
    aggregateVersion: 1,
    correlationId: randomUUID(),
    causationId: null,
    actor: { kind: 'user', id: actorId },
    provenance: 'live',
    type: 'agent.grants.updated',
    payload: { agentId, grants: Object.fromEntries(rows.map((r) => [r.toolId, r.actions])) },
  }) as const;

/**
 * Valide des droits sur des connecteurs de l'organisation : connecteur actif, action existante
 * et non désactivée. (Les outils du catalogue sont validés par `validateGrants`.)
 */
export async function validateConnectorGrants(
  tx: OrgTxContext['tx'],
  orgId: string,
  grants: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const [toolId, actions] of Object.entries(grants)) {
    const c = await tx.connector.findFirst({
      where: { toolId, orgId, removedAt: null },
      include: { tools: true },
    });
    if (!c) throw new DomainError('VALIDATION_ERROR', `Connecteur inconnu : ${toolId}`);
    for (const a of actions) {
      const t = c.tools.find((x) => x.action === a);
      if (!t) throw new DomainError('VALIDATION_ERROR', `Action inconnue : ${c.name}.${a}`);
      if (t.policy === 'disabled') {
        throw new DomainError('POLICY_DENIED', `${c.name}.${a} : outil désactivé`);
      }
    }
    if (actions.length > 0) out[toolId] = [...new Set(actions)];
  }
  return out;
}

/** Remplace les droits d'un agent (décision d'un administrateur humain, organisation live). */
export async function replaceAgentGrants(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    agentId: string;
    grants: Record<string, string[]>;
    validateCatalog: (
      g: Record<string, string[]>,
      allowDemoTools: boolean,
      role: string,
    ) => Record<string, string[]>;
  },
): Promise<Record<string, string[]>> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    assertLive(ctx);
    const agent = await ctx.tx.agent.findFirst({
      where: { id: input.agentId, orgId: ctx.orgId, deletedAt: null },
    });
    if (!agent) throw new DomainError('NOT_FOUND', 'Agent introuvable');
    const org = await ctx.tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const catalog = Object.fromEntries(
      Object.entries(input.grants).filter(([id]) => !isConnectorToolId(id)),
    );
    const connectors = Object.fromEntries(
      Object.entries(input.grants).filter(([id]) => isConnectorToolId(id)),
    );
    const grants = {
      ...input.validateCatalog(catalog, org.allowDemoTools, agent.role),
      ...(await validateConnectorGrants(ctx.tx, ctx.orgId, connectors)),
    };
    await ctx.tx.agentToolGrant.deleteMany({ where: { agentId: agent.id } });
    await ctx.tx.agentToolGrant.createMany({
      data: Object.entries(grants).map(([toolId, actions]) => ({
        agentId: agent.id,
        toolId,
        actions,
        grantedBy: `user:${input.actorId}`,
      })),
    });
    ctx.emit(
      grantsEvent(
        input.actorId,
        agent.id,
        Object.entries(grants).map(([toolId, actions]) => ({ toolId, actions })),
      ),
    );
    return grants;
  });
  return result;
}

export async function listConnectors(db: Db, orgId: string): Promise<ConnectorView[]> {
  const rows = await db.connector.findMany({
    where: { orgId, removedAt: null },
    include: { tools: { orderBy: { action: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((c) => ({
    id: c.id,
    toolId: c.toolId,
    name: c.name,
    endpoint: safeEndpoint(c.url),
    hasSecret: c.secretSealed !== null || c.urlSealed !== null || c.oauthSealed !== null,
    authHeader: c.authHeader,
    app: c.app,
    authKind: c.authKind,
    status: c.status as ConnectorView['status'],
    lastError: c.lastError,
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    tools: c.tools.map((t) => ({
      action: t.action,
      remoteName: t.remoteName,
      title: t.remoteName,
      description: t.description,
      policy: t.policy as ConnectorPolicy,
      readOnlyHint: t.readOnlyHint,
    })),
  }));
}

/** Données d'appel (serveur uniquement : contient le secret chiffré). */
export async function connectorForCall(db: Db, orgId: string, toolId: string, action: string) {
  const c = await db.connector.findFirst({
    where: { toolId, orgId, removedAt: null },
    include: { tools: { where: { action } } },
  });
  const tool = c?.tools[0];
  if (!c || !tool) return null;
  return {
    connectorId: c.id,
    name: c.name,
    url: c.url,
    urlSealed: c.urlSealed,
    oauthSealed: c.oauthSealed,
    authKind: c.authKind,
    secretSealed: c.secretSealed,
    authHeader: c.authHeader,
    remoteName: tool.remoteName,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
    policy: tool.policy as ConnectorPolicy,
    readOnlyHint: tool.readOnlyHint,
  };
}

/** Données internes d'un connecteur pour une resynchronisation (serveur uniquement). */
export async function connectorEndpoint(db: Db, orgId: string, connectorId: string) {
  return db.connector.findFirst({
    where: { id: connectorId, orgId, removedAt: null },
    select: {
      id: true,
      url: true,
      urlSealed: true,
      oauthSealed: true,
      authKind: true,
      secretSealed: true,
      authHeader: true,
      name: true,
    },
  });
}

/** Définitions d'outils accordés à un agent sur des connecteurs actifs (pour le modèle). */
export async function connectorToolsForGrants(
  db: Db,
  orgId: string,
  grants: { toolId: string; actions: string[] }[],
) {
  const out: {
    toolId: string;
    action: string;
    connectorName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    policy: ConnectorPolicy;
  }[] = [];
  for (const g of grants.filter((x) => isConnectorToolId(x.toolId))) {
    const c = await db.connector.findFirst({
      where: { toolId: g.toolId, orgId, removedAt: null },
      include: { tools: { where: { action: { in: g.actions }, policy: { not: 'disabled' } } } },
    });
    for (const t of c?.tools ?? []) {
      out.push({
        toolId: g.toolId,
        action: t.action,
        connectorName: c!.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        policy: t.policy as ConnectorPolicy,
      });
    }
  }
  return out;
}

/** Jetons OAuth renouvelés (refresh) : enregistrés chiffrés, sans événement (aucun impact métier). */
export async function saveConnectorOAuth(db: Db, connectorId: string, oauthSealed: string) {
  await db.connector.update({ where: { id: connectorId }, data: { oauthSealed } });
}
