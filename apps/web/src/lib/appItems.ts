import {
  ACTIVE_INVOCATION_STATUSES,
  appById,
  appOfToolName,
  GATEWAY_APPS,
  type AgentView,
  type AppPreset,
  type InvocationView,
  type WorldSnapshot,
} from '@company-os/contracts';

/** Barre d'applications : logique pure (testée), sans rendu. */
export interface AppItem {
  key: string;
  name: string;
  preset: AppPreset | undefined;
  color: string;
  /** Outil (machine) de la plateforme ; null pour Claude (le modèle). */
  toolId: string | null;
  /** Passerelle : seulement les actions de cette app (ex. actions gmail_* de Zapier). */
  actions: Set<string> | null;
}

const isGateway = (app: string | null | undefined): boolean =>
  !!app && (GATEWAY_APPS as readonly string[]).includes(app);

/** Applications de l'organisation : Claude, outils intégrés, connecteurs (et apps des passerelles). */
export function appItems(world: WorldSnapshot): AppItem[] {
  const items: AppItem[] = [
    {
      key: 'claude',
      name: 'Claude',
      preset: appById('claude'),
      color: '#D97757',
      toolId: null,
      actions: null,
    },
  ];
  for (const t of world.tools) {
    if (t.id === 'platform') continue;
    if (t.category !== 'connector') {
      const preset = appById(t.id);
      items.push({
        key: t.id,
        name: preset?.name ?? t.name,
        preset,
        color: t.color,
        toolId: t.id,
        actions: null,
      });
      continue;
    }
    if (isGateway(t.app)) {
      // Passerelle : une icône par application reconnue dans les noms d'outils (Gmail, WhatsApp…).
      const byApp = new Map<string, Set<string>>();
      const rest = new Set<string>();
      for (const a of t.actions) {
        const app = appOfToolName(a.label) ?? appOfToolName(a.action);
        if (app) byApp.set(app.id, (byApp.get(app.id) ?? new Set()).add(a.action));
        else rest.add(a.action);
      }
      for (const [appId, actions] of byApp) {
        const preset = appById(appId);
        items.push({
          key: `${t.id}:${appId}`,
          name: preset?.name ?? appId,
          preset,
          color: preset?.color ?? t.color,
          toolId: t.id,
          actions,
        });
      }
      if (rest.size > 0 || byApp.size === 0) {
        items.push({
          key: t.id,
          name: t.name,
          preset: appById(t.app),
          color: t.color,
          toolId: t.id,
          actions: byApp.size === 0 ? null : rest,
        });
      }
      continue;
    }
    items.push({
      key: t.id,
      name: t.name,
      preset: appById(t.app),
      color: t.color,
      toolId: t.id,
      actions: null,
    });
  }
  return items;
}

export const matches = (it: AppItem, inv: InvocationView): boolean =>
  it.toolId === inv.toolId && (!it.actions || it.actions.has(inv.action));

/** Application en cours d'utilisation : invocation réelle active (ou, pour Claude, un agent réfléchit). */
export function isAppActive(
  it: AppItem,
  invocations: InvocationView[],
  agents: AgentView[],
): boolean {
  if (it.toolId === null) return agents.some((a) => a.activity === 'working');
  return invocations.some((i) => ACTIVE_INVOCATION_STATUSES.includes(i.status) && matches(it, i));
}
