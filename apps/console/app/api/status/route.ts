import { isOperator } from '../../../auth';
import { operatorStoreConfig, readOperatorStatus } from '@oddmash/agent-operator-store';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  if (!await isOperator()) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    const status = await readOperatorStatus(operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_READ_TOKEN));
    return Response.json(status, { headers });
  } catch {
    return Response.json({ error: 'Status source unavailable' }, { status: 503, headers });
  }
}
