import { writeFile } from 'node:fs/promises';
import { collectAdoptionMetrics } from '../apps/console/adoption-metrics.ts';
const metrics = await collectAdoptionMetrics();
await writeFile('adoption-metrics.json', JSON.stringify({ metrics }, null, 2) + '\n');
