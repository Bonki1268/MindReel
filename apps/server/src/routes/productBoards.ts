import { PRODUCT_BOARD_NOT_FOUND_MESSAGE, generateProductBoardSchema, regenerateProductViewSchema, updateProductBoardSchema, type ApiError } from '@templeyard/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';
import { errorBody } from '../http/errorBody.js';
import { toValidationError } from '../http/errors.js';
import { ProductBoardError, type ProductBoardService, type ProductGenerateOutcome } from '../productBoards/service.js';

const INVALID_MESSAGE = '定裝版的資料不正確';
const CONSENT_MESSAGE = '這次生成需要先同意費用';

type VideoParams = { Params: { id: string } };
type ViewParams = { Params: { id: string; viewKey: string } };

/** 請求資料不正確：說明直接寫第一個欄位的錯誤（使用者一看就知道要改什麼），各欄位的說明照樣附上 */
function invalid(error: z.ZodError): ApiError {
  const body = toValidationError(error, INVALID_MESSAGE);
  return { ...body, message: Object.values(body.fieldErrors ?? {})[0] ?? body.message };
}

/** 商品定裝版服務的錯誤轉成 HTTP 回應；其他錯誤往上丟（500） */
async function handle<T>(reply: FastifyReply, run: () => T | Promise<T>): Promise<T | FastifyReply> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof ProductBoardError) return reply.status(error.status).send(errorBody(error.message));
    throw error;
  }
}

/** 送出生成的結果：需要同意時 409 並附上預估；送出後 202 */
function sendOutcome(reply: FastifyReply, outcome: ProductGenerateOutcome) {
  if (outcome.status === 'consent_required') return reply.status(409).send({ message: CONSENT_MESSAGE, check: outcome.check });
  return reply.status(202).send({ board: outcome.board });
}

/**
 * GET   /api/videos/:id/product-board
 * POST  /api/videos/:id/product-board/generate            需要同意時 409，附上 check
 * POST  /api/videos/:id/product-board/views/:viewKey/regenerate
 * POST  /api/videos/:id/product-board/views/:viewKey/confirm
 * PATCH /api/videos/:id/product-board                     外觀規範與光線
 * POST  /api/videos/:id/product-board/confirm
 * POST  /api/videos/:id/product-board/reuse
 * POST  /api/videos/:id/product-board/versions            另存新版本
 */
export function registerProductBoardRoutes(app: FastifyInstance, boards: ProductBoardService): void {
  app.get<VideoParams>('/api/videos/:id/product-board', async (request, reply) =>
    handle(reply, () => {
      const board = boards.detail(request.params.id);
      if (!board) throw new ProductBoardError(404, PRODUCT_BOARD_NOT_FOUND_MESSAGE);
      return { board };
    }),
  );

  app.post<VideoParams>('/api/videos/:id/product-board/generate', async (request, reply) => {
    const parsed = generateProductBoardSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(invalid(parsed.error));
    return handle(reply, async () => sendOutcome(reply, await boards.generate(request.params.id, parsed.data)));
  });

  app.post<ViewParams>('/api/videos/:id/product-board/views/:viewKey/regenerate', async (request, reply) => {
    const parsed = regenerateProductViewSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(invalid(parsed.error));
    return handle(reply, async () => sendOutcome(reply, await boards.regenerateView(request.params.id, request.params.viewKey, parsed.data)));
  });

  app.post<ViewParams>('/api/videos/:id/product-board/views/:viewKey/confirm', async (request, reply) =>
    handle(reply, () => ({ board: boards.confirmView(request.params.id, request.params.viewKey) })),
  );

  app.patch<VideoParams>('/api/videos/:id/product-board', async (request, reply) => {
    const parsed = updateProductBoardSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(invalid(parsed.error));
    return handle(reply, () => ({ board: boards.update(request.params.id, parsed.data) }));
  });

  app.post<VideoParams>('/api/videos/:id/product-board/confirm', async (request, reply) => handle(reply, () => boards.confirm(request.params.id)));

  app.post<VideoParams>('/api/videos/:id/product-board/reuse', async (request, reply) =>
    handle(reply, () => ({ board: boards.reuse(request.params.id) })),
  );

  app.post<VideoParams>('/api/videos/:id/product-board/versions', async (request, reply) =>
    handle(reply, () => reply.status(201).send({ board: boards.saveAsNewVersion(request.params.id) })),
  );
}
