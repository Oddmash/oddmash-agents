import { approvedModelOverrides, parseModelOverrides, type ModelOverrides, type ModelPolicy, type OperatorModelsRecord } from '../../packages/operator-contract/src/model-settings.ts';
import { readOperatorWriteInput } from './control-request.ts';

export async function handleModelWrite(request: Request, policy: ModelPolicy, verifyAvailability: (overrides: ModelOverrides) => Promise<boolean>, persist: (revision: string | null, overrides: ModelOverrides) => Promise<OperatorModelsRecord | null>) {
  const body = await readOperatorWriteInput(request);
  if (!body) return { status: 400 as const, body: { error: 'Invalid model settings' } };
  const overrides = parseModelOverrides(body.overrides);
  const revision = body.revision;
  if (Object.keys(body).length !== 2 || !overrides || !approvedModelOverrides(overrides, policy) || revision !== null && (typeof revision !== 'string' || !/^[a-f0-9-]{36}$/.test(revision))) return { status: 400 as const, body: { error: 'Invalid model settings' } };
  if (!await verifyAvailability(overrides)) return { status: 422 as const, body: { error: 'Model availability could not be verified' } };
  const result = await persist(revision as string | null, overrides);
  return result ? { status: 200 as const, body: { ...result, policy } } : { status: 409 as const, body: { error: 'Model settings changed; reload' } };
}
