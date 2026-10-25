import {
  changedSettingFields,
  droppedReasonCodes,
  settingSaveSchema,
  type ReasonCodesSetting,
  type ReferenceListsSetting,
  type SettingSaveInput,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { conflict, unprocessable } from '../../../../lib/api/errors';
import { requirePermission } from '../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { currentSetting, currentSettings } from '../../../../lib/api/settings';
import { prisma } from '../../../../lib/db';

/**
 * /api/admin/settings (2026-10-25, settings phase 1). ADMINISTRATOR ONLY, and
 * then `settings.manage`, which every administrator holds and other staff
 * only through the Administrator preset.
 *
 * GET -- every setting at its current version, with who saved it and when;
 *        a key never saved shows its fallback at version 0.
 * PUT { key, expected_version, value } -- appends version n+1. The value is
 *        checked by that key's shared schema before anything is read.
 *
 * VERSIONED, NEVER OVERWRITTEN: a save inserts a row; setting_version refuses
 * UPDATE and DELETE outright. A save made against a version that is no longer
 * current is refused (setting_changed_elsewhere), so two administrators
 * cannot silently undo each other; a concurrent save of the same version is
 * refused by the unique index.
 *
 * REASON CODES ARE ARCHIVED, NEVER REMOVED (reason_code_removed): past
 * decisions may name a code.
 *
 * THE AUDIT ROW carries the key, the two version numbers and the NAMES of
 * the changed fields -- never a contact detail or the About text. For the
 * banner it adds on/off; for reason codes, the codes added and archived.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth }) => {
      await requirePermission(auth, 'settings.manage');
      return ok(await currentSettings());
    },
  },

  PUT: {
    roles: ['admin', 'supervisor'],
    bodySchema: settingSaveSchema,
    handler: async ({ auth, body: raw }) => {
      await requirePermission(auth, 'settings.manage');
      const body = raw as SettingSaveInput;

      const saved = await audited(prisma, async (tx) => {
        // One save of one key at a time: two saves queue rather than both
        // reading the same "current" version.
        await tx.$queryRawUnsafe(
          `SELECT 1 AS locked
             FROM (SELECT pg_advisory_xact_lock(hashtext('agri-erp.setting.' || $1))) l`,
          body.key,
        );
        const current = await currentSetting(body.key, tx);
        if (current.version !== body.expected_version) throw conflict('setting_changed_elsewhere');

        const after: Record<string, unknown> = {
          version: current.version + 1,
          fields: changedSettingFields(current.value, body.value),
        };
        if (body.key === 'reason_codes') {
          const before = current.value as ReasonCodesSetting;
          if (droppedReasonCodes(before, body.value).length > 0) {
            throw unprocessable('reason_code_removed');
          }
          const known = new Set(before.codes.map((c) => c.code));
          const wasActive = new Set(before.codes.filter((c) => c.active).map((c) => c.code));
          after.codes_added = body.value.codes.filter((c) => !known.has(c.code)).map((c) => c.code);
          after.codes_archived = body.value.codes
            .filter((c) => !c.active && wasActive.has(c.code))
            .map((c) => c.code);
        }
        if (body.key === 'maintenance') after.enabled = body.value.enabled;
        // Phase 2 (2026-10-27): what was archived or restored, and the new
        // privacy defaults -- list values and switches, never anyone's data.
        if (body.key === 'reference_lists') {
          const before = current.value as ReferenceListsSetting;
          for (const list of ['archived_categories', 'archived_units', 'archived_crops'] as const) {
            const was = new Set<string>(before[list]);
            const now = new Set<string>(body.value[list]);
            const archived = [...now].filter((v) => !was.has(v));
            const restored = [...was].filter((v) => !now.has(v));
            if (archived.length || restored.length) after[list] = { archived, restored };
          }
        }
        if (body.key === 'profile_privacy') after.defaults = body.value;

        await tx.$executeRawUnsafe(
          `INSERT INTO public.setting_version (key, version, value, changed_by)
           VALUES ($1, $2, $3::jsonb, $4::uuid)`,
          body.key,
          current.version + 1,
          JSON.stringify(body.value),
          auth.principal.id,
        );
        await writeAudit(tx, {
          entityType: 'setting',
          entityId: body.key,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'setting.changed',
          before: { version: current.version },
          after,
        });
        return currentSetting(body.key, tx);
      });

      return ok(saved);
    },
  },
});
