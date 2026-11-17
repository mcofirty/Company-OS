'use client';

import {
  siAirtable,
  siAsana,
  siBrevo,
  siCalendly,
  siClaude,
  siClickup,
  siDiscord,
  siDropbox,
  siFacebook,
  siFigma,
  siGithub,
  siGitlab,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siGooglesheets,
  siHubspot,
  siInstagram,
  siIntercom,
  siJira,
  siLinear,
  siMailchimp,
  siMake,
  siMiro,
  siN8n,
  siNotion,
  siPaypal,
  siSentry,
  siShopify,
  siStripe,
  siTelegram,
  siTodoist,
  siTrello,
  siWhatsapp,
  siWordpress,
  siX,
  siYoutube,
  siZapier,
  siZendesk,
  type SimpleIcon,
} from 'simple-icons';
import { appById, type AppPreset } from '@company-os/contracts';

/** Icônes de marques (simple-icons, licence CC0) utilisées par le catalogue d'applications. */
const ICONS: Record<string, SimpleIcon> = {
  siAirtable,
  siAsana,
  siBrevo,
  siCalendly,
  siClaude,
  siClickup,
  siDiscord,
  siDropbox,
  siFacebook,
  siFigma,
  siGithub,
  siGitlab,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siGooglesheets,
  siHubspot,
  siInstagram,
  siIntercom,
  siJira,
  siLinear,
  siMailchimp,
  siMake,
  siMiro,
  siN8n,
  siNotion,
  siPaypal,
  siSentry,
  siShopify,
  siStripe,
  siTelegram,
  siTodoist,
  siTrello,
  siWhatsapp,
  siWordpress,
  siX,
  siYoutube,
  siZapier,
  siZendesk,
};

/** Pastilles des outils intégrés (glyphes originaux). */
const BUILTIN_GLYPH: Record<string, string> = {
  web: '🌐',
  library: '📚',
  company: '🏢',
  team: '👥',
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Logo d'une application : icône de marque, glyphe intégré ou initiales sur sa couleur. */
export function AppIcon({
  app,
  name,
  color,
  size = 30,
}: {
  app?: AppPreset | string | null;
  name: string;
  color?: string;
  size?: number;
}) {
  const preset = typeof app === 'string' ? appById(app) : (app ?? undefined);
  const icon = preset?.icon ? ICONS[preset.icon] : undefined;
  const bg = preset?.color ?? color ?? '#625d74';
  const glyph = preset ? BUILTIN_GLYPH[preset.id] : undefined;
  return (
    <span
      className="app-icon"
      style={{ width: size, height: size, background: icon ? '#ffffff' : bg }}
      aria-hidden
    >
      {icon ? (
        <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill={`#${icon.hex}`}>
          <path d={icon.path} />
        </svg>
      ) : glyph ? (
        <span style={{ fontSize: size * 0.5 }}>{glyph}</span>
      ) : (
        <span className="app-initials" style={{ fontSize: size * 0.38 }}>
          {initials(preset?.name ?? name)}
        </span>
      )}
    </span>
  );
}
