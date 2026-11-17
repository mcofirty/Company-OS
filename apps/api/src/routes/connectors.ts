import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CONNECTOR_POLICIES,
  connectorEndpoint,
  createConnector,
  DomainError,
  listConnectors,
  removeConnector,
  replaceAgentGrants,
  setConnectorToolPolicy,
  syncConnector,
  validateGrants,
  type Db,
} from '@company-os/db';
import { openSecret, sealSecret } from '@company-os/policies';
import { discoverMcpTools, ToolError, type McpEndpoint } from '@company-os/tools';
import { principalOf, requireRole } from '../auth';
import type { ConnectorSettings } from '../config';

const CreateConnectorSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    url: z.string().trim().url().max(500),
    /** Jeton d'accès du serveur MCP (facultatif) : chiffré au repos, jamais renvoyé. */
    token: z.string().trim().min(8).max(4000).optional(),
    /** En-tête recevant le jeton : `authorization` (Bearer) par défaut, ou p. ex. `x-api-key`. */
    authHeader: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{1,40}$/)
      .default('authorization'),
  })
  .strict();
const Id = z.object({ id: z.uuid() });

/** Erreur de connexion lisible par l'administrateur (jamais le jeton ni la réponse brute). */
function connectError(err: unknown): DomainError {
  const te = err instanceof ToolError ? err : new ToolError('CONNECTOR_UNREACHABLE', true, '');
  const why: Record<string, string> = {
    VALIDATION_ERROR: te.message,
    SSRF_BLOCKED: 'adresse privée ou locale refusée (seuls les serveurs publics en HTTPS)',
    CONNECTOR_AUTH: 'authentification refusée : vérifier le jeton et l’en-tête',
    CONNECTOR_REJECTED: te.message,
    TIMEOUT: 'délai dépassé',
    CONNECTOR_UNREACHABLE: 'serveur injoignable ou réponse non MCP',
  };
  return new DomainError(
    te.code === 'CONNECTOR_UNREACHABLE' || te.code === 'TIMEOUT'
      ? 'TOOL_UNAVAILABLE'
      : 'VALIDATION_ERROR',
    `Connexion MCP impossible : ${why[te.code] ?? te.code}`,
  );
}

/**
 * Connecteurs MCP en libre-service (docs/05 §11) : l'administrateur ajoute ses propres outils,
 * choisit leur politique et les accorde aux agents. Toutes les mutations passent par les
 * services (événements + audit) ; l'API ne renvoie jamais de secret.
 */
export function registerConnectors(app: FastifyInstance, db: Db, cfg: ConnectorSettings): void {
  const meta = { schemaVersion: 1 };
  const endpoint = (url: string, headers: Record<string, string>): McpEndpoint => ({
    url,
    headers,
    allowPrivateNetwork: cfg.allowPrivateNetwork,
    timeoutMs: 15_000,
  });
  const authHeaders = (authHeader: string, token: string | undefined): Record<string, string> =>
    !token
      ? {}
      : authHeader === 'authorization'
        ? { Authorization: `Bearer ${token}` }
        : { [authHeader]: token };
  const assertLiveAdmin = async (req: Parameters<typeof principalOf>[0]) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const org = await db.organization.findUniqueOrThrow({ where: { id: p.orgId } });
    if (org.mode !== 'live') {
      throw new DomainError('POLICY_DENIED', 'Connecteurs réservés aux organisations live');
    }
    return p;
  };

  app.get('/v1/connectors', async (req) => {
    const p = principalOf(req);
    return {
      data: await listConnectors(db, p.orgId),
      meta: { ...meta, secretStorage: cfg.secretKey !== null },
    };
  });

  app.post('/v1/connectors', async (req, reply) => {
    const p = await assertLiveAdmin(req);
    const body = CreateConnectorSchema.parse(req.body);
    if (body.token && !cfg.secretKey) {
      throw new DomainError(
        'CONFLICT',
        'Stockage de jetons indisponible : CONNECTOR_SECRET_KEY absente sur le serveur',
      );
    }
    let discovered;
    try {
      discovered = await discoverMcpTools(
        endpoint(body.url, authHeaders(body.authHeader, body.token)),
      );
    } catch (err) {
      throw connectError(err);
    }
    const r = await createConnector(db, {
      orgId: p.orgId,
      actorId: p.userId,
      name: body.name,
      url: body.url,
      secretSealed: body.token && cfg.secretKey ? sealSecret(body.token, cfg.secretKey) : null,
      authHeader: body.authHeader,
      discovered,
    });
    return reply.status(201).send({ data: { ...r, tools: discovered.length }, meta });
  });

  app.post('/v1/connectors/:id/sync', async (req) => {
    const p = await assertLiveAdmin(req);
    const { id } = Id.parse(req.params);
    const c = await connectorEndpoint(db, p.orgId, id);
    if (!c) throw new DomainError('NOT_FOUND', 'Connecteur introuvable');
    if (c.secretSealed && !cfg.secretKey) {
      throw new DomainError('CONFLICT', 'CONNECTOR_SECRET_KEY absente : jeton illisible');
    }
    const token =
      c.secretSealed && cfg.secretKey ? openSecret(c.secretSealed, cfg.secretKey) : undefined;
    try {
      const discovered = await discoverMcpTools(endpoint(c.url, authHeaders(c.authHeader, token)));
      await syncConnector(db, { orgId: p.orgId, actorId: p.userId, connectorId: id, discovered });
    } catch (err) {
      const e = connectError(err);
      await syncConnector(db, {
        orgId: p.orgId,
        actorId: p.userId,
        connectorId: id,
        error: e.message,
      });
      throw e;
    }
    return { data: (await listConnectors(db, p.orgId)).find((x) => x.id === id), meta };
  });

  app.post('/v1/connectors/:id/tools/:action/policy', async (req) => {
    const p = await assertLiveAdmin(req);
    const { id, action } = z
      .object({ id: z.uuid(), action: z.string().min(1).max(64) })
      .parse(req.params);
    const { policy } = z
      .object({ policy: z.enum(CONNECTOR_POLICIES) })
      .strict()
      .parse(req.body);
    await setConnectorToolPolicy(db, {
      orgId: p.orgId,
      actorId: p.userId,
      connectorId: id,
      action,
      policy,
    });
    return { data: { id, action, policy }, meta };
  });

  app.post('/v1/connectors/:id/remove', async (req) => {
    const p = await assertLiveAdmin(req);
    const { id } = Id.parse(req.params);
    await removeConnector(db, { orgId: p.orgId, actorId: p.userId, connectorId: id });
    return { data: { id, removed: true }, meta };
  });

  /** Droits d'un agent remplacés par un administrateur (catalogue réel + connecteurs). */
  app.post('/v1/agents/:id/grants', async (req) => {
    const p = await assertLiveAdmin(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { grants } = z
      .object({ grants: z.record(z.string().max(64), z.array(z.string().max(64)).max(200)) })
      .strict()
      .parse(req.body);
    const saved = await replaceAgentGrants(db, {
      orgId: p.orgId,
      actorId: p.userId,
      agentId: id,
      grants,
      validateCatalog: (g, allowDemoTools, role) => validateGrants(g, { allowDemoTools, role }),
    });
    return { data: { agentId: id, grants: saved }, meta };
  });
}
