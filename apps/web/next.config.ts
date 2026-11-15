import type { NextConfig } from 'next';

/**
 * CSP de production (docs/11 §6). Le backend est choisi par navigateur (tunnel, domaine propre) :
 * les connexions sortantes sont donc limitées à HTTPS/WSS (+ localhost pour le développement),
 * jamais à HTTP en clair vers l'extérieur. Pages statiques Next => scripts inline d'amorçage
 * nécessaires ('unsafe-inline' sans nonce, ADR-036) ; aucune évaluation dynamique.
 */
const LOCAL = 'http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*';
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https: wss: ${LOCAL}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config: NextConfig = {
  transpilePackages: ['@company-os/contracts', '@company-os/world'],
  reactStrictMode: true,
  devIndicators: false,
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    if (process.env.NODE_ENV !== 'production') return [];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
