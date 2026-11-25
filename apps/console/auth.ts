import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

export function authConfigured() {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && /^\d+$/.test(process.env.CONSOLE_OWNER_GITHUB_ID ?? ''));
}

function owner(id: unknown) {
  const expected = process.env.CONSOLE_OWNER_GITHUB_ID;
  return typeof expected === 'string' && /^\d+$/.test(expected) && (typeof id === 'string' || typeof id === 'number') && String(id) === expected;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub({ authorization: { params: { scope: 'read:user' } } })],
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
  callbacks: {
    signIn({ account, profile }) { return account?.provider === 'github' && owner(profile?.id); },
    jwt({ token, account, profile }) {
      if (account?.provider === 'github') token.operatorId = owner(profile?.id) ? String(profile?.id) : undefined;
      return token;
    },
    session({ session, token }) {
      session.user.id = typeof token.operatorId === 'string' ? token.operatorId : '';
      return session;
    }
  }
});

export async function isOperator() {
  if (!authConfigured()) return false;
  const session = await auth();
  return owner(session?.user?.id);
}
