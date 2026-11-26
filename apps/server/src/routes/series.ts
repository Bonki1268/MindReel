import {
  SCENARIO_PACK_LOCKED_MESSAGE,
  SCENARIO_PACK_NOT_FOUND_MESSAGE,
  createSeriesSchema,
  parseVideoFilter,
  parseVideoSort,
  updateSeriesSchema,
  type ApiError,
  type DefaultsPatch,
  type ScenarioPackRegistry,
} from '@templeyard/shared';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../db/client.js';
import { toValidationError } from '../http/errors.js';
import { errorBody } from '../http/errorBody.js';
import { createSeries, findSeries, listSeries, updateSeries, type Clock } from '../series/repository.js';
import { patchQuestionnaireDefaults, readQuestionnaireDefaults } from '../series/questionnaireDefaults.js';
import { listSeriesVideos } from '../series/videos.js';

const INVALID_MESSAGE = '系列資料不正確';
/** 建立系列時沒選情境包就是廟埕包 */
const DEFAULT_SCENARIO_PACK = 'temple';

/** GET /api/series、POST /api/series、PATCH /api/series/:id */
export function registerSeriesRoutes(app: FastifyInstance, db: AppDatabase, clock: Clock, packs: ScenarioPackRegistry): void {
  app.get('/api/series', async () => ({ series: listSeries(db) }));

  // 過去的影片：這個系列的影片與共同角色（使用者 2026-11-04 提出）；第 14 階段加上狀態篩選與排序
  app.get<{ Params: { id: string }; Querystring: { status?: string; sort?: string } }>('/api/series/:id/videos', async (request, reply) => {
    if (!findSeries(db, request.params.id)) return reply.status(404).send(errorBody('找不到這個系列'));
    const status = parseVideoFilter(request.query.status);
    if (!status) return reply.status(400).send(errorBody('狀態篩選不正確'));
    const sort = parseVideoSort(request.query.sort);
    if (!sort) return reply.status(400).send(errorBody('排序方式不正確'));
    return listSeriesVideos(db, request.params.id, { status, sort });
  });

  // 系列問卷預設值：逐題列出（標明來源影片）、修改或清除（第 14 階段）
  app.get<{ Params: { id: string } }>('/api/series/:id/questionnaire-defaults', async (request, reply) => {
    const view = readQuestionnaireDefaults(db, request.params.id);
    if (!view) return reply.status(404).send(errorBody('找不到這個系列'));
    return view;
  });

  app.patch<{ Params: { id: string } }>('/api/series/:id/questionnaire-defaults', async (request, reply) => {
    const body = (request.body ?? {}) as { defaults?: DefaultsPatch };
    const result = patchQuestionnaireDefaults(db, request.params.id, body.defaults ?? {}, clock);
    if (!result) return reply.status(404).send(errorBody('找不到這個系列'));
    if (!result.ok) return reply.status(400).send(errorBody(result.message));
    return result.view;
  });

  app.post('/api/series', async (request, reply) => {
    const parsed = createSeriesSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(toValidationError(parsed.error, INVALID_MESSAGE));
    // 省略情境包就是廟埕包；情境包以登記表為準，新增情境包不用改這裡
    const scenarioPack = parsed.data.scenarioPack ?? DEFAULT_SCENARIO_PACK;
    if (!packs.has(scenarioPack)) {
      const body: ApiError = { message: INVALID_MESSAGE, fieldErrors: { scenarioPack: SCENARIO_PACK_NOT_FOUND_MESSAGE } };
      return reply.status(400).send(body);
    }
    return reply.status(201).send({ series: createSeries(db, { ...parsed.data, scenarioPack }, clock) });
  });

  app.patch<{ Params: { id: string } }>('/api/series/:id', async (request, reply) => {
    // 情境包建立後不能更改（兩種寫法都擋，整個請求拒絕）
    const body = request.body;
    if (typeof body === 'object' && body !== null && ('scenarioPack' in body || 'scenario_pack' in body)) {
      return reply.status(400).send(errorBody(SCENARIO_PACK_LOCKED_MESSAGE));
    }
    const parsed = updateSeriesSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(toValidationError(parsed.error, INVALID_MESSAGE));
    const updated = updateSeries(db, request.params.id, parsed.data, clock);
    if (!updated) {
      const notFound: ApiError = { message: '找不到這個系列' };
      return reply.status(404).send(notFound);
    }
    return { series: updated };
  });
}
