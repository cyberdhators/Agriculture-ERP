-- PRESETS BECOME BINDING (2026-10-30, lane-perms). DATA ONLY: no table,
-- column, constraint or index is created, changed or dropped.
--
-- Until this release an account with the role `admin` held every staff
-- permission except Super Admin WITHOUT any grant row (the "legacy rule" in
-- packages/shared/src/staff-permissions.ts). The code that ships with this
-- migration removes that rule: a staff member's permissions become exactly the
-- union of their ACTIVE preset grants.
--
-- So that nobody loses access on the day it lands, every ACTIVE administrator
-- (public.user_active, role 'admin') who holds NO active grant at all is given
-- the three ordinary presets whose union is what the legacy rule gave them
-- (ROLLOUT_PRESETS_FOR_ADMINS_WITHOUT_GRANTS, asserted by a pure test):
--
--   administrator      staff.manage, settings.manage, audit.view,
--                      reports.view, communications.send
--   moderator_editor   content.moderate, content.publish
--   support            support.handle
--
-- platform-wide, `granted_by` the administrator themself (the convention the
-- Super Admin bootstrap already uses: a self-appointment is recorded as made
-- by the account itself), with the reason
-- 'Kept their powers when presets became binding (2026-10-30)'.
--
-- NOT GIVEN: superadmin.grant (never implied by a role, before or after) and
-- exports.identifiable (the legacy rule implied it, but no route asks for it;
-- it now belongs to Super Admin alone, as the specification's "moderation ...
-- does not automatically grant ... sensitive exports" requires).
--
-- Administrators who already hold ANY active grant (a Super Admin, or a demo
-- account given one preset on purpose) are left exactly as they are: their
-- grants were chosen, and adding presets would undo the restriction this
-- release exists to make. Supervisors and read-only accounts are untouched:
-- the legacy rule never gave them anything.
--
-- Each grant writes its `staff.permission_granted` audit row (an existing
-- action key), actor `system` (a migration has no principal, C-4.3), in this
-- same transaction.
--
-- IDEMPOTENT: an administrator handled here holds active grants afterwards, so
-- a second run finds nobody. Apply it BEFORE (or together with) the code: with
-- the old code the new rows change nothing, because the legacy rule already
-- gave the same keys.

DO $$
DECLARE
    v_target RECORD;
    v_preset TEXT;
    v_grant_id UUID;
    v_reason CONSTANT TEXT := 'Kept their powers when presets became binding (2026-10-30)';
BEGIN
    FOR v_target IN
        SELECT u.id
          FROM public.user_active u
         WHERE u.role = 'admin'
           AND NOT EXISTS (
               SELECT 1 FROM public.staff_permission_grant g
                WHERE g.user_id = u.id AND g.revoked_at IS NULL)
         ORDER BY u.id
    LOOP
        FOREACH v_preset IN ARRAY ARRAY['administrator', 'moderator_editor', 'support']
        LOOP
            INSERT INTO public.staff_permission_grant
                (user_id, preset, scope_kind, reason, granted_by)
            VALUES (v_target.id, v_preset, 'platform', v_reason, v_target.id)
            RETURNING id INTO v_grant_id;

            INSERT INTO public.audit_event
                (entity_type, entity_id, actor_type, actor_id, action, before, after)
            VALUES ('staff_permission_grant', v_grant_id::text, 'system', NULL,
                    'staff.permission_granted', NULL,
                    jsonb_build_object(
                        'user_id', v_target.id,
                        'preset', v_preset,
                        'scope', 'platform',
                        'state_ids', '[]'::jsonb,
                        'reason', v_reason,
                        'rollout', 'presets_binding_2026_10_30'));
        END LOOP;
    END LOOP;
END $$;
