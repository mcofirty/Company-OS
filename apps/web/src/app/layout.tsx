import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Living HQ — AI Company OS' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
