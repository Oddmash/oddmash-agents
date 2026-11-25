import { parseOperatorControls, type OperatorControls, type ControlsRecord } from '../../packages/operator-contract/src/controls.ts';

export async function handleControlWrite(request: Request, persist: (revision: string | null, controls: OperatorControls) => Promise<ControlsRecord | null>) {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (!Number.isFinite(length) || length > 2048) return { status: 400 as const, body: { error: 'Invalid controls' } };
    const reader = request.body?.getReader();
    if (!reader) return { status: 400 as const, body: { error: 'Invalid controls' } };
    const decoder = new TextDecoder();
    let raw = '', bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2048) { await reader.cancel(); return { status: 400 as const, body: { error: 'Invalid controls' } }; }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return { status: 400 as const, body: { error: 'Invalid controls' } }; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { status: 400 as const, body: { error: 'Invalid controls' } };
    const body = input as Record<string, unknown>;
    const controls = parseOperatorControls(body.controls);
    const revision = body.revision;
    if (Object.keys(body).length !== 2 || !controls || revision !== null && (typeof revision !== 'string' || !/^[a-f0-9-]{36}$/.test(revision))) return { status: 400 as const, body: { error: 'Invalid controls' } };
    const result = await persist(revision as string | null, controls);
    return result ? { status: 200 as const, body: result } : { status: 409 as const, body: { error: 'Controls changed; reload' } };

}
