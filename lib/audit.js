// lightweight audit trail for host actions with real consequences (session
// lifecycle, destructive deletes). fire-and-forget: logging failures must
// never block or fail the action being logged.
import { adminClient } from './supabase-server';

export async function logAuditEvent({ eventType, actorId, actorLabel, sessionId, targetId, metadata }) {
  try {
    const admin = adminClient();
    await admin.from('audit_events').insert({
      event_type: eventType,
      actor_id: actorId || null,
      actor_label: actorLabel || null,
      session_id: sessionId || null,
      target_id: targetId || null,
      metadata: metadata || {},
    });
  } catch (e) {
    console.error('[audit] failed to log event', eventType, e?.message || e);
  }
}
