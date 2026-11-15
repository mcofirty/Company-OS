import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Company OS — Living HQ' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
