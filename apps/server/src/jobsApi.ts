import type { JobRepository } from '@mymind/db';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { validator } from 'hono/validator';
import { z } from 'zod';
import type { EventBus } from './events';
import type { JobRunner } from './jobRunner';

export type JobsApiDeps = { runner: JobRunner; jobs: JobRepository; events: EventBus };

const dayParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形式で指定してください');

/** FB の依頼（FR-A01、FR-A05）。過去の日の FB も依頼できるので、業務日の一致は求めない */
const createJobBody = z.strictObject({
  kind: z.literal('daily_feedback'),
  period: dayParam,
});

const feedbackQuery = z.strictObject({ scope: z.literal('daily'), period: dayParam });

/** SSE の接続を保つための空のコメントを送る間隔 */
const KEEP_ALIVE_MS = 15_000;

const invalid = (issues: z.core.$ZodIssue[]) => ({
  error: {
    code: 'INVALID_REQUEST' as const,
    message: '入力が正しくありません',
    issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  },
});

/** エージェントのジョブと FB の API、画面への通知（architecture.md 6章、7.1、ADR-0008） */
export function createJobsApi({ runner, jobs, events }: JobsApiDeps) {
  const notFound = { error: { code: 'NOT_FOUND' as const, message: 'ジョブが見つかりません' } };

  return new Hono()
    .post(
      '/jobs',
      validator('json', (value, c) => {
        const parsed = createJobBody.safeParse(value);
        return parsed.success ? parsed.data : c.json(invalid(parsed.error.issues), 400);
      }),
      (c) => {
        const { kind, period } = c.req.valid('json');
        const { job } = runner.enqueue(kind, period);
        // 生成は非同期で進むので、すぐにジョブを返す。進み具合は GET /api/events で知らせる
        return c.json({ job }, 202);
      },
    )

    .get('/jobs/:id', (c) => {
      const job = jobs.find(c.req.param('id'));
      return job === undefined ? c.json(notFound, 404) : c.json({ job }, 200);
    })

    .post('/jobs/:id/cancel', (c) => {
      const result = runner.cancel(c.req.param('id'));
      if (result.ok) return c.json({ job: result.job }, 200);
      return result.reason === 'not_found'
        ? c.json(notFound, 404)
        : c.json(
            { error: { code: 'JOB_FINISHED' as const, message: 'ジョブはもう終わっています' } },
            409,
          );
    })

    .get(
      '/feedbacks',
      validator('query', (value, c) => {
        const parsed = feedbackQuery.safeParse(value);
        return parsed.success ? parsed.data : c.json(invalid(parsed.error.issues), 400);
      }),
      (c) => {
        const { scope, period } = c.req.valid('query');
        return c.json({ feedbacks: jobs.listFeedbacks(scope, period) }, 200);
      },
    )

    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        const unsubscribe = events.subscribe((event) => {
          stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        });
        stream.onAbort(unsubscribe);
        while (!stream.aborted) {
          await stream.sleep(KEEP_ALIVE_MS);
          if (!stream.aborted) await stream.write(': keep-alive\n\n');
        }
      }),
    );
}
