import { toScenarioPackSummary, type ScenarioPackRegistry } from '@templeyard/shared';
import type { FastifyInstance } from 'fastify';

/** GET /api/scenario-packs：列出情境包（建立系列時選、介面用詞、預設比例與長度、功能開關） */
export function registerScenarioPackRoutes(app: FastifyInstance, packs: ScenarioPackRegistry): void {
  app.get('/api/scenario-packs', async () => ({ scenarioPacks: packs.list().map(toScenarioPackSummary) }));
}
