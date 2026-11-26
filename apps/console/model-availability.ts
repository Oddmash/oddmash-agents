import { modelRoles, type ModelOverrides } from '../../packages/operator-contract/src/model-settings.ts';

export async function verifyModelAvailability(overrides: ModelOverrides, env: Readonly<Record<string, string | undefined>> = process.env, request = fetch): Promise<boolean> {
  const checks = new Map<string, Map<string, Promise<boolean>>>();
  for (const role of modelRoles) {
    const model = overrides[role];
    if (!model) continue;
    const key = role === 'reviewer' ? env.OPENAI_API_KEY : env[role.toUpperCase() + '_OPENAI_API_KEY'] || env.OPENAI_API_KEY;
    if (!key) return false;
    const models = checks.get(key) ?? new Map<string, Promise<boolean>>();
    checks.set(key, models);
    if (!models.has(model)) models.set(model, (async () => {
      try {
        const response = await request('https://api.openai.com/v1/models/' + encodeURIComponent(model), { headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return false;
        const body = await response.json() as { object?: unknown; id?: unknown };
        return body.object === 'model' && body.id === model;
      } catch { return false; }
    })());
  }
  return (await Promise.all([...checks.values()].flatMap(models => [...models.values()]))).every(Boolean);
}
