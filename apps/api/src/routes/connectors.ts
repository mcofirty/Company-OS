import { randomBytes } from 'node:crypto';
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
  saveConnectorOAuth,
  syncConnector,
  validateGrants,
  type Db,
} from '@company-os/db';
import { appById } from '@company-os/contracts';
import { openSecret, sealSecret } from '@company-os/policies';
import {
  beginOAuth,
  buildConnectorEndpoint,
  completeOAuth,
  discoverMcpTools,
  ToolError,
  type McpEndpoint,
  type OAuthState,
} from '@company-os/tools';
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
    /** Application du catalogue (logo, aide) : github, zapier… */
    app: z.string().trim().max(40).optional(),
    /** L'adresse contient un secret (Zapier, Make, n8n) : chiffrée, jamais réaffichée. */
    urlIsSecret: z.boolean().optional(),
  })
  .strict();
const OAuthStartSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    url: z.string().trim().url().max(500),
    app: z.string().trim().max(40).optional(),
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
  const redirectUrl = `${cfg.publicApiUrl ?? 'http://localhost:4000'}/v1/connectors/oauth/callback`;
  const webOrigin = cfg.webOrigin ?? 'http://localhost:3000';
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
    const preset = appById(body.app);
    const urlIsSecret = body.urlIsSecret ?? preset?.connect.kind === 'mcp-url';
    if (urlIsSecret && !cfg.secretKey) {
      throw new DomainError(
        'CONFLICT',
        'Stockage chiffré indisponible : CONNECTOR_SECRET_KEY absente sur le serveur',
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
      // Adresse secrète : seule une version affichable (origine) est gardée en clair.
      url: urlIsSecret ? `${new URL(body.url).origin}/…` : body.url,
      urlSealed: urlIsSecret && cfg.secretKey ? sealSecret(body.url, cfg.secretKey) : null,
      secretSealed: body.token && cfg.secretKey ? sealSecret(body.token, cfg.secretKey) : null,
      authHeader: body.authHeader,
      authKind: urlIsSecret ? 'url' : body.token ? 'token' : 'none',
      app: preset?.id ?? null,
      discovered,
    });
    return reply.status(201).send({ data: { ...r, tools: discovered.length }, meta });
  });

  app.post('/v1/connectors/:id/sync', async (req) => {
    const p = await assertLiveAdmin(req);
    const { id } = Id.parse(req.params);
    const c = await connectorEndpoint(db, p.orgId, id);
    if (!c) throw new DomainError('NOT_FOUND', 'Connecteur introuvable');
    if ((c.secretSealed || c.urlSealed || c.oauthSealed) && !cfg.secretKey) {
      throw new DomainError('CONFLICT', 'CONNECTOR_SECRET_KEY absente : secrets illisibles');
    }
    try {
      const discovered = await discoverMcpTools(
        buildConnectorEndpoint(c, {
          key: cfg.secretKey,
          allowPrivateNetwork: cfg.allowPrivateNetwork,
          timeoutMs: 15_000,
          oauthRedirectUrl: redirectUrl,
          persistOAuth: (sealed) => saveConnectorOAuth(db, c.id, sealed),
        }),
      );
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

  // ---------- « Se connecter avec … » (OAuth MCP) ----------
  /** Étape 1 : découverte + enregistrement du client ; renvoie l'URL d'autorisation à ouvrir. */
  app.post('/v1/connectors/oauth/start', async (req) => {
    const p = await assertLiveAdmin(req);
    const body = OAuthStartSchema.parse(req.body);
    const key = cfg.secretKey;
    if (!key) {
      throw new DomainError(
        'CONFLICT',
        'CONNECTOR_SECRET_KEY absente : connexion OAuth impossible',
      );
    }
    const state = randomBytes(24).toString('base64url');
    await db.oAuthSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.oAuthSession.create({
      data: {
        state,
        orgId: p.orgId,
        actorId: p.userId,
        app: appById(body.app)?.id ?? null,
        name: body.name,
        serverUrl: body.url,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    try {
      const { authorizationUrl } = await beginOAuth({
        serverUrl: body.url,
        redirectUrl,
        state,
        allowPrivateNetwork: cfg.allowPrivateNetwork,
        persist: async (s) => {
          await db.oAuthSession.update({
            where: { state },
            data: { dataSealed: sealSecret(JSON.stringify(s), key) },
          });
        },
      });
      return { data: { authorizationUrl }, meta };
    } catch (err) {
      await db.oAuthSession.deleteMany({ where: { state } });
      throw connectError(err);
    }
  });

  /**
   * Étape 2 : retour du navigateur depuis l'application (sans jeton du cockpit : la session est
   * identifiée par `state`, à usage unique, 10 min). Puis retour au cockpit.
   */
  app.get('/v1/connectors/oauth/callback', async (req, reply) => {
    const q = z
      .object({
        state: z.string().max(200).optional(),
        code: z.string().max(4000).optional(),
        error: z.string().max(200).optional(),
      })
      .parse(req.query);
    const back = (status: 'ok' | 'error', detail: string) =>
      reply.redirect(
        `${webOrigin}/?connector=${status}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    const session = q.state
      ? await db.oAuthSession.findUnique({ where: { state: q.state } })
      : null;
    if (session) await db.oAuthSession.delete({ where: { state: session.state } });
    if (!session || session.expiresAt < new Date() || !cfg.secretKey) {
      return back('error', 'Session de connexion expirée : recommence depuis le cockpit');
    }
    if (q.error || !q.code) return back('error', `Connexion refusée (${q.error ?? 'sans code'})`);
    const key = cfg.secretKey;
    try {
      const data = session.dataSealed
        ? (JSON.parse(openSecret(session.dataSealed, key)) as OAuthState)
        : {};
      const tokens = await completeOAuth({
        serverUrl: session.serverUrl,
        redirectUrl,
        code: q.code,
        data,
        allowPrivateNetwork: cfg.allowPrivateNetwork,
      });
      let sealed = sealSecret(JSON.stringify(tokens), key);
      const discovered = await discoverMcpTools(
        buildConnectorEndpoint(
          {
            url: session.serverUrl,
            urlSealed: null,
            oauthSealed: sealed,
            authKind: 'oauth',
            secretSealed: null,
            authHeader: 'authorization',
          },
          {
            key,
            allowPrivateNetwork: cfg.allowPrivateNetwork,
            timeoutMs: 15_000,
            oauthRedirectUrl: redirectUrl,
            persistOAuth: async (s) => {
              sealed = s;
            },
          },
        ),
      );
      await createConnector(db, {
        orgId: session.orgId,
        actorId: session.actorId,
        name: session.name,
        url: session.serverUrl,
        secretSealed: null,
        authHeader: 'authorization',
        authKind: 'oauth',
        oauthSealed: sealed,
        app: session.app,
        discovered,
      });
      return back('ok', `${session.name} connecté : ${discovered.length} outil(s)`);
    } catch (err) {
      return back('error', connectError(err).message);
    }
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
