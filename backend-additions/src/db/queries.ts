// CODEOWNERS: Igor Holt
import type { Env } from "../types";
import crypto from "node:crypto";

export interface CapsuleEventParams {
  record_type: string;
  event_type: string;
  source: string;
  workspace_id: string;
  task_id?: string;
  job_id?: string;
  payload: unknown;
}

/**
 * Append an event to the capsule_events log.
 * Uses full UUID (36 chars) rather than 8-char slice — removes birthday-collision risk
 * at scale (>10k events/workspace/day).
 */
export async function appendEvent(env: Env, params: CapsuleEventParams): Promise<string> {
  const eventId = `evt_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO capsule_events
       (event_id, record_type, event_type, source, workspace_id, task_id, job_id, timestamp, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      eventId,
      params.record_type,
      params.event_type,
      params.source,
      params.workspace_id,
      params.task_id ?? null,
      params.job_id ?? null,
      now,
      JSON.stringify(params.payload)
    )
    .run();

  return eventId;
}
