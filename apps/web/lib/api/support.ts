import { toIso, type SupportMessage } from '@agri-erp/shared';

/**
 * "Contact CORWADO" (2026-10-21): the columns staff read and how one row is
 * presented. Never the sender's sign-in id or the connection digest.
 */
export const SUPPORT_COLUMNS = `id, from_kind, name, phone, email, topic, body, status,
        handled_at, created_at`;

export interface SupportRow {
  id: string;
  from_kind: SupportMessage['from_kind'];
  name: string;
  phone: string | null;
  email: string | null;
  topic: SupportMessage['topic'];
  body: string;
  status: SupportMessage['status'];
  handled_at: Date | null;
  created_at: Date;
}

export const presentSupport = (row: SupportRow): SupportMessage => ({
  id: row.id,
  from_kind: row.from_kind,
  name: row.name,
  phone: row.phone,
  email: row.email,
  topic: row.topic,
  body: row.body,
  status: row.status,
  handled_at: row.handled_at ? toIso(row.handled_at) : null,
  created_at: toIso(row.created_at),
});
