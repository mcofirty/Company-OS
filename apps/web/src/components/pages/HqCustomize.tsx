'use client';

import { useEffect, useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { HQ_MAP } from '@company-os/world';
import { api, apiPost, ApiFailure } from '../../lib/api';

export interface Branding {
  neonText: string;
  neonColor: string;
  logo: string | null;
  zoneStyles: Record<string, 'modern' | 'cosy' | 'tech'>;
}
/** Diffusé au cockpit pour appliquer la personnalisation sans recharger. */
export const BRANDING_EVENT = 'hq-branding';
const errText = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Erreur inattendue');
const STYLE_LABEL = { modern: 'Moderne', cosy: 'Chaleureux (bois)', tech: 'Tech (sombre, néons)' };

/** Réduit une image à 256 px max et l'encode en PNG (jamais de SVG). */
async function toLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Image illisible'));
      i.src = url;
    });
    const k = Math.min(1, 256 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Personnaliser le QG : enseigne, logo, style de mobilier, emplacement des pôles. */
export function HqCustomize({
  world,
  toast,
}: {
  world: WorldSnapshot;
  toast: (t: { text: string; tone: 'success' | 'danger' }) => void;
}) {
  const [b, setB] = useState<Branding | null>(null);
  useEffect(() => {
    api<Branding>('/v1/branding')
      .then((r) => setB(r.data))
      .catch(() => setB(null));
  }, []);
  if (!b) return <p className="muted">Chargement…</p>;
  const zones = HQ_MAP.rooms.filter((r) => r.kind === 'department');
  const occupant = (roomId: string) => world.departments.find((d) => d.roomId === roomId);
  const save = (next: Branding) =>
    apiPost<Branding>('/v1/branding', next)
      .then((r) => {
        setB(r.data);
        window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: r.data }));
        toast({ text: 'QG personnalisé', tone: 'success' });
      })
      .catch((e: unknown) => toast({ text: errText(e), tone: 'danger' }));
  return (
    <div className="settings-card hq-customize" data-testid="hq-customize">
      <h3>Personnaliser le QG</h3>
      <div className="inline-form">
        <label>
          Enseigne néon
          <input
            value={b.neonText}
            maxLength={20}
            onChange={(e) => setB({ ...b, neonText: e.target.value })}
            data-testid="brand-neon"
          />
        </label>
        <label>
          Couleur
          <input
            type="color"
            value={b.neonColor}
            onChange={(e) => setB({ ...b, neonColor: e.target.value })}
          />
        </label>
        <label>
          Logo (PNG, JPG)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                void toLogo(f)
                  .then((logo) => setB({ ...b, logo }))
                  .catch((err: unknown) => toast({ text: errText(err), tone: 'danger' }));
            }}
          />
        </label>
        {b.logo && (
          <span className="logo-preview">
            <img src={b.logo} alt="Logo" height={36} />
            <button className="btn ghost small-btn" onClick={() => setB({ ...b, logo: null })}>
              Retirer
            </button>
          </span>
        )}
      </div>
      <table className="data-table zones-table">
        <thead>
          <tr>
            <th>Zone</th>
            <th>Pôle</th>
            <th>Mobilier</th>
            <th>Déplacer le pôle vers…</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => {
            const d = occupant(z.id);
            return (
              <tr key={z.id}>
                <td className="muted small">{z.id.startsWith('annex') ? 'Extension' : z.label}</td>
                <td>
                  {d ? (
                    <>
                      <span className="dot" style={{ background: d.color }} /> {d.name}
                    </>
                  ) : (
                    <span className="muted">Espace libre</span>
                  )}
                </td>
                <td>
                  <select
                    value={b.zoneStyles[z.id] ?? 'modern'}
                    onChange={(e) =>
                      setB({
                        ...b,
                        zoneStyles: { ...b.zoneStyles, [z.id]: e.target.value as 'modern' },
                      })
                    }
                    data-testid={`zone-style-${z.id}`}
                  >
                    {Object.entries(STYLE_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {d && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        apiPost(`/v1/departments/${d.id}/move`, { roomId: e.target.value })
                          .then(() => toast({ text: `${d.name} déplacé`, tone: 'success' }))
                          .catch((err: unknown) => toast({ text: errText(err), tone: 'danger' }));
                      }}
                      data-testid={`zone-move-${d.id}`}
                    >
                      <option value="">—</option>
                      {zones
                        .filter((t) => t.id !== z.id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {occupant(t.id)
                              ? `Échanger avec ${occupant(t.id)!.name}`
                              : `${t.id.startsWith('annex') ? 'Extension' : t.label} (libre)`}
                          </option>
                        ))}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="actions row">
        <button className="btn primary" onClick={() => void save(b)} data-testid="brand-save">
          Enregistrer l’apparence du QG
        </button>
      </div>
    </div>
  );
}
