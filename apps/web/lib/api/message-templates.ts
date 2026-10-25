import type { MessageTemplate } from '@agri-erp/shared';

/** Message templates (2026-10-27): the row and its presentation, shared by the routes. */
export interface TemplateRow {
  id: string;
  name: string;
  channel: MessageTemplate['channel'];
  title: string | null;
  body: string;
  status: MessageTemplate['status'];
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
}

export const TEMPLATE_SELECT = `
  SELECT t.id, t.name, t.channel, t.title, t.body, t.status, t.created_at, t.updated_at,
         u.name AS updated_by
    FROM public.message_template t
    LEFT JOIN public."user" u ON u.id = t.updated_by`;

export const presentTemplate = (r: TemplateRow): MessageTemplate => ({
  id: r.id,
  name: r.name,
  channel: r.channel,
  title: r.title,
  body: r.body,
  status: r.status,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
  updated_by: r.updated_by,
});
