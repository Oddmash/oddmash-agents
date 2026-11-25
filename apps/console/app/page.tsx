import { authConfigured, isOperator, signIn, signOut } from '../auth';
import { Dashboard } from './dashboard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!authConfigured()) return <main className="login"><h1>Oddmash Agents</h1><p>Console authentication is not configured.</p></main>;
  if (!await isOperator()) return <main className="login"><p className="eyebrow">ODDMASH / OPERATIONS</p><h1>Agents Console</h1><p>Sign in with the authorized GitHub account to view agent activity.</p><form action={async () => { 'use server'; await signIn('github', { redirectTo: '/' }); }}><button className="login-button">Sign in with GitHub</button></form></main>;
  return <Dashboard logout={<form action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}><button className="login-button">Sign out</button></form>} />;
}
