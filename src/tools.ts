import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { LunidexApiClient, redactCredential, type Query, toPublicError } from './api.js';

const cursorSchema = z.string().optional();
const languageSchema = z.string().min(1);
const productIdSchema = z.number().int().safe().min(1);
const cardIdSchema = z.string().min(1);
const transactionIdSchema = z.uuid();
const safeNonNegativeIntegerSchema = z.number().int().safe().min(0);
const sealedTransactionDraftSchema = z
  .object({
    kind: z.enum(['buy', 'sell', 'exchange']),
    cardmarketProductId: productIdSchema,
    language: z.enum(['unknown', 'en', 'fr', 'es', 'de', 'it', 'ja']),
    date: z.iso.date(),
    quantity: z.number().int().safe().min(1),
    unitPriceCents: safeNonNegativeIntegerSchema.optional(),
    feesCents: safeNonNegativeIntegerSchema.optional(),
    shippingCents: safeNonNegativeIntegerSchema.optional(),
    discountCents: safeNonNegativeIntegerSchema.optional(),
    paymentFeesCents: safeNonNegativeIntegerSchema.optional(),
    otherCostsCents: safeNonNegativeIntegerSchema.optional(),
    exchangeGive: z
      .object({
        cardmarketProductId: productIdSchema,
        language: z.string().min(1),
        quantity: z.number().int().safe().min(1),
      })
      .strict()
      .optional(),
    allocationMethod: z.enum(['fifo', 'manual']).optional(),
  })
  .strict();
const catalogueQuerySchema = z
  .string()
  .describe('Optional catalogue search text, limited to 150 Unicode code points.')
  .refine((value) => Array.from(value).length <= 150, {
    message: 'Search query must be at most 150 Unicode code points.',
  })
  .optional();

function jsonResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: redactCredential(JSON.stringify(value)) }],
  };
}

function jsonFailure(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: toPublicError(error) }) }],
    isError: true,
  };
}

function readTool(
  api: LunidexApiClient,
  path: (input: Record<string, unknown>) => string,
  query: (input: Record<string, unknown>) => Query = () => ({}),
) {
  return async (input: Record<string, unknown>) => {
    try {
      return jsonResult(await api.get(path(input), query(input)));
    } catch (error) {
      return jsonFailure(error);
    }
  };
}

function writeTool(
  action: (input: Record<string, unknown>) => Promise<unknown>,
) {
  return async (input: Record<string, unknown>) => {
    try {
      return jsonResult(await action(input));
    } catch (error) {
      return jsonFailure(error);
    }
  };
}

export function registerLunidexTools(server: McpServer, api = new LunidexApiClient()): void {
  server.registerTool(
    'get_me',
    {
      description: 'Read the authenticated Lunidex account profile.',
      inputSchema: z.object({}).strict(),
    },
    readTool(api, () => 'me'),
  );

  server.registerTool(
    'get_summary',
    {
      description: 'Read the authenticated Lunidex account summary and statistics.',
      inputSchema: z.object({}).strict(),
    },
    readTool(api, () => 'summary'),
  );

  server.registerTool(
    'list_cards',
    {
      description: 'List this Lunidex account’s card holdings.',
      inputSchema: z
        .object({
          cursor: cursorSchema,
          limit: z.number().int().min(1).max(100).optional(),
          language: languageSchema.optional(),
          set: z.string().min(1).optional(),
        })
        .strict(),
    },
    readTool(api, () => 'cards', (input) => ({
      cursor: input.cursor as string | undefined,
      limit: input.limit as number | undefined,
      language: input.language as string | undefined,
      set: input.set as string | undefined,
    })),
  );

  server.registerTool(
    'get_card',
    {
      description: 'Read card metadata and this Lunidex account’s holdings for one card.',
      inputSchema: z
        .object({ cardId: cardIdSchema, language: languageSchema.optional() })
        .strict(),
    },
    readTool(
      api,
      (input) => `cards/${encodeURIComponent(input.cardId as string)}`,
      (input) => ({ language: input.language as string | undefined }),
    ),
  );

  server.registerTool(
    'search_sealed_catalogue',
    {
      description: 'Search the read-only Lunidex sealed product catalogue.',
      inputSchema: z
        .object({ q: catalogueQuerySchema, cursor: cursorSchema })
        .strict(),
    },
    readTool(api, () => 'sealed/catalogue', (input) => ({
      q: input.q as string | undefined,
      cursor: input.cursor as string | undefined,
    })),
  );

  server.registerTool(
    'list_sealed_positions',
    {
      description: 'List this Lunidex account’s sealed product positions.',
      inputSchema: z
        .object({
          cursor: cursorSchema,
          limit: z.number().int().min(1).max(100).optional(),
          language: z.enum(['unknown', 'en', 'fr', 'es', 'de', 'it', 'ja']).optional(),
          productId: productIdSchema.optional(),
        })
        .strict(),
    },
    readTool(api, () => 'sealed/positions', (input) => ({
      cursor: input.cursor as string | undefined,
      limit: input.limit as number | undefined,
      language: input.language as string | undefined,
      productId: input.productId as number | undefined,
    })),
  );

  server.registerTool(
    'get_sealed_position',
    {
      description: 'Read one sealed product position for this Lunidex account.',
      inputSchema: z.object({ productId: productIdSchema }).strict(),
    },
    readTool(api, (input) => `sealed/positions/${String(input.productId)}`),
  );

  server.registerTool(
    'list_sealed_transactions',
    {
      description: 'List this Lunidex account’s sealed product transactions.',
      inputSchema: z
        .object({
          cursor: cursorSchema,
          limit: z.number().int().min(1).max(100).optional(),
          language: languageSchema.optional(),
          productId: productIdSchema.optional(),
          type: z.enum(['buy', 'sell', 'exchange']).optional(),
          includeVoided: z.boolean().optional(),
          voided: z.boolean().optional(),
        })
        .strict(),
    },
    readTool(api, () => 'sealed/transactions', (input) => ({
      cursor: input.cursor as string | undefined,
      limit: input.limit as number | undefined,
      language: input.language as string | undefined,
      productId: input.productId as number | undefined,
      type: input.type as string | undefined,
      includeVoided: input.includeVoided as boolean | undefined,
      voided: input.voided as boolean | undefined,
    })),
  );

  server.registerTool(
    'get_sealed_transaction',
    {
      description: 'Read one sealed transaction for this Lunidex account.',
      inputSchema: z.object({ id: transactionIdSchema }).strict(),
    },
    readTool(api, (input) => `sealed/transactions/${encodeURIComponent(input.id as string)}`),
  );

  server.registerTool(
    'set_card_quantity',
    {
      description:
        'Set the absolute quantity of a card owned by this Lunidex account. Requires an API key with read_write permission; quantity 0 removes the holding.',
      inputSchema: z
        .object({
          cardId: cardIdSchema,
          language: z.string().min(1),
          variant: z.enum(['unspecified', 'normal', 'reverse', 'holo']),
          quantity: z.number().int().safe().min(0).max(10_000),
        })
        .strict(),
    },
    writeTool((input) =>
      api.put(`cards/${encodeURIComponent(input.cardId as string)}`, {
        language: input.language,
        variant: input.variant,
        quantity: input.quantity,
      }),
    ),
  );

  server.registerTool(
    'create_sealed_transaction',
    {
      description:
        'Create a sealed product transaction. Requires a read_write API key, the current expectedRevision, and a caller-generated Idempotency-Key (8–200 characters) that can be reused to safely retry the same creation.',
      inputSchema: sealedTransactionDraftSchema
        .extend({
          expectedRevision: z.number().int().safe().min(0),
          idempotencyKey: z
            .string()
            .trim()
            .min(8)
            .max(200)
            .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
              message: 'Idempotency key must not contain control characters.',
            }),
        })
        .strict(),
    },
    writeTool((input) => {
      const { idempotencyKey, ...body } = input;
      return api.post('sealed/transactions', body, { idempotencyKey: idempotencyKey as string });
    }),
  );

  server.registerTool(
    'update_sealed_transaction',
    {
      description:
        'Replace a sealed transaction draft. Requires a read_write API key, the transaction UUID, its current revision, and the latest account expectedRevision.',
      inputSchema: sealedTransactionDraftSchema
        .extend({
          id: transactionIdSchema,
          revision: z.number().int().safe().min(1),
          expectedRevision: z.number().int().safe().min(0),
        })
        .strict(),
    },
    writeTool((input) => {
      const { id, ...body } = input;
      return api.patch(`sealed/transactions/${encodeURIComponent(id as string)}`, body);
    }),
  );

  server.registerTool(
    'void_sealed_transaction',
    {
      description:
        'Void a sealed transaction. Requires a read_write API key, the transaction UUID, its current revision, and the latest account expectedRevision.',
      inputSchema: z
        .object({
          id: transactionIdSchema,
          revision: z.number().int().safe().min(1),
          expectedRevision: z.number().int().safe().min(0),
        })
        .strict(),
    },
    writeTool((input) => {
      const { id, revision, expectedRevision } = input;
      return api.post(`sealed/transactions/${encodeURIComponent(id as string)}/void`, {
        revision,
        expectedRevision,
      });
    }),
  );
}
