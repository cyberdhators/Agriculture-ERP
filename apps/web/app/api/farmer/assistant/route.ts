import Anthropic from '@anthropic-ai/sdk';
import { ASSISTANT_LIMITS, FARMER_ROLE, assistantRequestSchema } from '@agri-erp/shared';

import { ApiFailure } from '../../../../lib/api/errors';
import { defineRoutes, streamed } from '../../../../lib/api/route';
import { farmerScope } from '../../../../lib/api/scope';
import {
  ASSISTANT_MODEL,
  AssistantNotConfiguredError,
  type FarmerContext,
  assistantClient,
  systemPrompt,
} from '../../../../lib/assistant/claude';
import { prisma } from '../../../../lib/db';

/**
 * POST /api/farmer/assistant — the farmer asks AgriOne AI a question and
 * the answer streams back as plain text (2026-10-17; the owner approved the
 * assistant in place of the learning library, answered by Claude Haiku 5.5).
 *
 * FARMER ONLY: a signed-in farmer, about themselves; nobody else has a use
 * for it. The conversation lives on the farmer's phone and arrives with each
 * question; nothing the farmer types is stored on the server -- only a count
 * of questions per day, for the cap that keeps a loop or a shared phone from
 * running up the bill.
 *
 * EVERY REFUSAL IS DECIDED BEFORE THE STREAM STARTS, because once the first
 * byte is sent the status is 200: validation (the shared schema), the role,
 * configuration (503 assistant_not_configured), the daily cap (429
 * assistant_daily_limit) and a provider that will not take the request (503
 * assistant_unavailable). After that, a failure mid-answer ends the text with
 * a sentence saying so, in the farmer's language.
 */

const ENDINGS = {
  en: {
    cut: '\n\n(The answer was cut off. Please ask again.)',
    declined:
      'I cannot help with that question. For farming advice, please contact your extension officer.',
  },
  ar: {
    cut: '\n\n(انقطعت الإجابة. يرجى السؤال مرة أخرى.)',
    declined: 'لا أستطيع المساعدة في هذا السؤال. للنصائح الزراعية، يرجى التواصل مع المرشد الزراعي.',
  },
} as const;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE],
    bodySchema: assistantRequestSchema,
    handler: async ({ auth, body }) => {
      const { farmerId } = farmerScope(auth);
      const language: 'en' | 'ar' = body.language === 'ar' ? 'ar' : 'en';

      let client: Anthropic;
      try {
        client = assistantClient();
      } catch (failure) {
        if (failure instanceof AssistantNotConfiguredError) {
          throw new ApiFailure(
            503,
            'assistant_not_configured',
            'The assistant is not switched on yet. Please try again later.',
          );
        }
        throw failure;
      }

      // The cap, taken atomically: the row only moves while under the limit,
      // so two phones asking at once cannot both slip past it.
      const counted = await prisma.$queryRawUnsafe<{ questions: number }[]>(
        `INSERT INTO public.assistant_usage (farmer_id, day, questions, updated_at)
         VALUES ($1::uuid, (now() AT TIME ZONE 'utc')::date, 1, now())
         ON CONFLICT (farmer_id, day) DO UPDATE
           SET questions = public.assistant_usage.questions + 1, updated_at = now()
           WHERE public.assistant_usage.questions < $2
         RETURNING questions`,
        farmerId,
        ASSISTANT_LIMITS.dailyMax,
      );
      if (counted.length === 0) {
        throw new ApiFailure(
          429,
          'assistant_daily_limit',
          `You have asked ${ASSISTANT_LIMITS.dailyMax} questions today, the daily limit. Please ask again tomorrow, or contact your extension officer.`,
        );
      }
      const refund = () =>
        prisma
          .$executeRawUnsafe(
            `UPDATE public.assistant_usage SET questions = GREATEST(questions - 1, 0)
              WHERE farmer_id = $1::uuid AND day = (now() AT TIME ZONE 'utc')::date`,
            farmerId,
          )
          .catch(() => undefined);

      const farmer = await loadContext(farmerId);
      const stream = client.messages.stream({
        model: ASSISTANT_MODEL,
        max_tokens: 4096,
        // Chat: low effort answers quickly and cheaply (Haiku 5.5 defaults to medium).
        output_config: { effort: 'low' },
        system: systemPrompt(farmer, language),
        messages: body.messages,
      });

      // Wait for the provider to accept the request, so that a refusal of the
      // whole request (credentials, rate, outage) is still a proper error.
      try {
        await stream.withResponse();
      } catch (failure) {
        await refund();
        if (failure instanceof Anthropic.APIError || failure instanceof Error) {
          throw new ApiFailure(
            503,
            'assistant_unavailable',
            'The assistant could not answer just now. Please try again in a few minutes.',
          );
        }
        throw failure;
      }

      const endings = ENDINGS[language];
      const encoder = new TextEncoder();
      const text = new ReadableStream<Uint8Array>({
        async start(controller) {
          let wrote = false;
          try {
            for await (const event of stream) {
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                wrote = true;
                controller.enqueue(encoder.encode(event.delta.text));
              }
            }
            const final = await stream.finalMessage();
            if (final.stop_reason === 'refusal') {
              controller.enqueue(encoder.encode((wrote ? '\n\n' : '') + endings.declined));
            } else if (final.stop_reason === 'max_tokens') {
              controller.enqueue(encoder.encode(endings.cut));
            }
          } catch {
            controller.enqueue(encoder.encode(endings.cut));
          } finally {
            controller.close();
          }
        },
        cancel() {
          // The farmer left the screen: stop paying for an answer nobody reads.
          stream.abort();
        },
      });
      return streamed(text);
    },
  },
});

/** What helps the assistant answer this farmer: place, crops, land. Never contact details. */
async function loadContext(farmerId: string): Promise<FarmerContext> {
  const [row] = await prisma.$queryRawUnsafe<
    {
      given_name: string;
      payam: string | null;
      county: string | null;
      state: string | null;
      primary_crops: string[] | null;
      other_crops: string | null;
      land_size: string | null;
      land_unit: string | null;
    }[]
  >(
    `SELECT f.given_name, p.name AS payam, c.name AS county, s.name AS state,
            fp.primary_crops, fp.other_crops, fp.land_size::text AS land_size, fp.land_unit
       FROM public.farmer f
       LEFT JOIN public.payam p ON p.id = f.payam_id
       LEFT JOIN public.county c ON c.id = f.county_id
       LEFT JOIN public.state s ON s.id = f.state_id
       LEFT JOIN public.farmer_profile fp ON fp.farmer_id = f.id
      WHERE f.id = $1::uuid`,
    farmerId,
  );
  const crops = [...(row?.primary_crops ?? []), ...(row?.other_crops ? [row.other_crops] : [])];
  return {
    givenName: row?.given_name ?? 'farmer',
    payam: row?.payam ?? null,
    county: row?.county ?? null,
    state: row?.state ?? null,
    crops,
    land: row?.land_size && row.land_unit ? `${Number(row.land_size)} ${row.land_unit}` : null,
  };
}
