-- Migration 20 (B10): what reporting needs from the schema. C-10.
--
-- 1. report_export: every export logs who, the query, the filters, the cut-off
--    and the row count (C-10.8). The data model had it "already existing" and
--    without the query; neither was true.
-- 2. A merge repoints the source's farms and visits to the survivor (C-10.1,
--    owner 2026-09-08). The visit evidence trigger admits exactly that move —
--    the new farmer is the merged_into of the old — and nothing else. A one-off
--    pass repoints the farms and visits of merges already made, following a
--    chain of merges to its survivor, with a system audit entry per moved row.
-- 3. The active views over farm and visit read through the farmer: a removed
--    farmer's farms and visits are in no count, total or export (C-10.1).
--    farm_active and visit_active remain filters of their tables and carry every
--    column (the view rule); they gain a farmer condition, not a column.
-- Additive: one table, three keys, view replacements, a trigger widened.

CREATE TABLE "public"."report_export" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "exported_by"  UUID        NOT NULL,
    "actor_type"   "public"."audit_actor_type" NOT NULL,
    "report_type"  TEXT        NOT NULL,
    -- The SQL that produced the rows, parameters inlined as literals, so a number
    -- in a PDF traces to rows without the code that made it (C-10.8).
    "query"        TEXT        NOT NULL,
    "filters"      JSONB       NOT NULL,
    "scope"        JSONB       NOT NULL,
    "data_cutoff"  DATE        NOT NULL,
    "row_count"    INTEGER     NOT NULL,
    "exported_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "report_export_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_export_exported_by_fkey" FOREIGN KEY ("exported_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "report_export_row_count_nonneg" CHECK ("row_count" >= 0),
    CONSTRAINT "report_export_type_known" CHECK ("report_type" IN ('summary', 'farmers'))
);
CREATE INDEX "report_export_exported_idx" ON "public"."report_export" ("exported_at" DESC, "id" DESC);
ALTER TABLE "public"."report_export" ENABLE ROW LEVEL SECURITY;

-- The one move the evidence trigger admits: a merge, from the source to the
-- record it was merged into. Anything else that changes farmer_id is refused
-- as before (C-8.10).
CREATE OR REPLACE FUNCTION "public"."visit_evidence_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    merged_target UUID;
BEGIN
    IF NEW.farmer_id <> OLD.farmer_id THEN
        SELECT merged_into INTO merged_target FROM public.farmer WHERE id = OLD.farmer_id;
        IF merged_target IS NULL OR merged_target <> NEW.farmer_id THEN
            RAISE EXCEPTION 'visit_evidence_immutable' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.officer_id <> OLD.officer_id
       OR NOT extensions.ST_Equals(NEW.position::extensions.geometry, OLD.position::extensions.geometry)
       OR NEW.gps_accuracy_m <> OLD.gps_accuracy_m
       OR NEW.visited_at <> OLD.visited_at OR NEW.received_at <> OLD.received_at THEN
        RAISE EXCEPTION 'visit_evidence_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

-- Audit keys first, so the one-off pass below can write its entries.
ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";
ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
    'user.created', 'user.updated', 'user.password_set', 'user.soft_deleted',
    'officer.created', 'officer.updated', 'officer.status_changed', 'officer.password_set', 'officer.soft_deleted',
    'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
    'location.created', 'location.renamed', 'location.soft_deleted',
    'farmer.created', 'farmer.updated', 'farmer.soft_deleted', 'consent.recorded',
    'farmer.verified', 'farmer.rejected', 'farmer.merged', 'farmer.resubmitted', 'farmer.reassigned',
    'farm.created', 'farm.boundary_added', 'farm.boundary_superseded', 'farm.crops_declared', 'farm.soft_deleted',
    'farm.repointed',
    'visit.recorded', 'visit.corrected', 'visit.soft_deleted',
    'visit.attachment_declared', 'visit.attachment_arrived', 'visit.attachment_failed',
    'visit.attachment_link_issued', 'visit.repointed',
    'report.exported'
));

-- One-off: farms and visits of already-merged sources move to the survivor at
-- the end of the merge chain. Each move is audited as the system's (C-4.3).
-- Visits move one merge step at a time so the trigger's rule holds for each.
DO $$
DECLARE
    moved RECORD;
BEGIN
    FOR moved IN
        WITH RECURSIVE chain AS (
            SELECT f.id AS source_id, f.merged_into AS survivor_id, 1 AS depth
            FROM public.farmer f WHERE f.verification_status = 'merged' AND f.merged_into IS NOT NULL
            UNION ALL
            SELECT c.source_id, t.merged_into, c.depth + 1
            FROM chain c JOIN public.farmer t ON t.id = c.survivor_id
            WHERE t.verification_status = 'merged' AND t.merged_into IS NOT NULL AND c.depth < 100
        ),
        survivor AS (
            SELECT DISTINCT ON (source_id) source_id, survivor_id FROM chain ORDER BY source_id, depth DESC
        )
        SELECT fm.id AS farm_id, fm.payam_id AS farm_payam, s.source_id, s.survivor_id, sv.payam_id AS survivor_payam
        FROM public.farm fm JOIN survivor s ON s.source_id = fm.farmer_id
        JOIN public.farmer sv ON sv.id = s.survivor_id
    LOOP
        UPDATE public.farm SET farmer_id = moved.survivor_id WHERE id = moved.farm_id;
        INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action, before, after)
        VALUES ('farm', moved.farm_id::text, 'system', NULL, 'farm.repointed',
                jsonb_build_object('farmer_id', moved.source_id, 'farm_payam_id', moved.farm_payam),
                jsonb_build_object('farmer_id', moved.survivor_id, 'farm_payam_id', moved.farm_payam,
                                   'survivor_payam_id', moved.survivor_payam, 'reason', 'merge_backfill'));
    END LOOP;

    -- Visits: one step at a time along the chain, because the trigger admits
    -- only source -> merged_into. Loop until nothing moves.
    LOOP
        WITH step AS (
            SELECT v.id AS visit_id, v.farmer_id AS source_id, f.merged_into AS survivor_id
            FROM public.visit v JOIN public.farmer f ON f.id = v.farmer_id
            WHERE f.verification_status = 'merged' AND f.merged_into IS NOT NULL
        ), done AS (
            UPDATE public.visit v SET farmer_id = step.survivor_id
            FROM step WHERE v.id = step.visit_id
            RETURNING v.id, step.source_id, step.survivor_id
        )
        INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action, before, after)
        SELECT 'visit', done.id::text, 'system', NULL, 'visit.repointed',
               jsonb_build_object('farmer_id', done.source_id),
               jsonb_build_object('farmer_id', done.survivor_id, 'reason', 'merge_backfill')
        FROM done;
        EXIT WHEN NOT FOUND;
    END LOOP;
END $$;

-- Views: through the farmer. farm_active and visit_active stay filters of
-- their tables with every column; farm_mapped_v likewise; area_totals_v and
-- extension_coverage_v are aggregates and were already partly through the
-- farmer — now wholly.
CREATE OR REPLACE VIEW "public"."farm_active" WITH (security_invoker = true) AS
    SELECT f.* FROM "public"."farm" f
    JOIN "public"."farmer" fr ON fr."id" = f."farmer_id"
    WHERE f."deleted_at" IS NULL AND fr."deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."farm_mapped_v" WITH (security_invoker = true) AS
    SELECT f.* FROM "public"."farm" f
    JOIN "public"."farmer" fr ON fr."id" = f."farmer_id"
    WHERE f."deleted_at" IS NULL AND fr."deleted_at" IS NULL AND EXISTS (
        SELECT 1 FROM "public"."farm_boundary" b
        WHERE b."farm_id" = f."id" AND b."is_current" AND b."accuracy_flag" <> 'unusable'
    );

CREATE OR REPLACE VIEW "public"."area_totals_v" WITH (security_invoker = true) AS
    SELECT f."state_id", f."county_id", f."payam_id", b."season",
           count(*)::int AS "farms", sum(b."area_ha") AS "hectares"
    FROM "public"."farm" f
    JOIN "public"."farmer" fr ON fr."id" = f."farmer_id"
    JOIN "public"."farm_boundary" b ON b."farm_id" = f."id" AND b."is_current" AND b."accuracy_flag" <> 'unusable'
    WHERE f."deleted_at" IS NULL AND fr."deleted_at" IS NULL
    GROUP BY f."state_id", f."county_id", f."payam_id", b."season";

CREATE OR REPLACE VIEW "public"."visit_active" WITH (security_invoker = true) AS
    SELECT v.* FROM "public"."visit" v
    JOIN "public"."farmer" fr ON fr."id" = v."farmer_id"
    WHERE v."deleted_at" IS NULL AND fr."deleted_at" IS NULL;
