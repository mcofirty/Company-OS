import type { Metadata } from 'next';
import { Bench } from '../../components/Bench';

export const metadata: Metadata = { title: 'Banc de charge — Living HQ', robots: 'noindex' };

export default function BenchPage() {
  return <Bench />;
}
