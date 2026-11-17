import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Bench } from '../../components/Bench';

export const metadata: Metadata = { title: 'Banc de charge — Living HQ', robots: 'noindex' };

export default function BenchPage() {
  // Serveur « réel uniquement » : aucune page de monde synthétique.
  if (process.env.NEXT_PUBLIC_LIVE_ONLY === 'true') notFound();
  return <Bench />;
}
