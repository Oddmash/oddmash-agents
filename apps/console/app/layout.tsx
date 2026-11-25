import type { ReactNode } from 'react';
import '@oddmash/ui/styles.css';
import './globals.css';

export const metadata = { title: 'Oddmash Agents Console', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
