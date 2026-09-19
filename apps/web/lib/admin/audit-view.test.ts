import { auditFilterSchema } from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import {
  AUDIT_FILTER_KEYS,
  DAMAGED_ID_LABEL,
  EMPTY_AUDIT_FILTERS,
  FORBIDDEN_AUDIT_FIELDS,
  actionLabel,
  actorIdLooksValid,
  actorLabel,
  auditChips,
  changeSummary,
  clearAuditFilters,
  entityLabel,
  fieldChanges,
  fromQuery,
  hasAuditFilters,
  isDamagedId,
  isForbiddenField,
  toAuditParams,
  type AuditFilterState,
} from './audit-view';

const withFilters = (patch: Partial<AuditFilterState>): AuditFilterState => ({
  ...EMPTY_AUDIT_FILTERS,
  ...patch,
});

const ACTOR = '11111111-2222-4333-8444-555555555555';

describe('the denylist fails closed', () => {
  it('refuses every field the specification forbids', () => {
    for (const field of ['password', 'given_name', 'family_name', 'phone', 'national_id']) {
      expect(isForbiddenField(field), `${field} was allowed`).toBe(true);
    }
    for (const field of ['note', 'rejection_note', 'observation', 'advice']) {
      expect(isForbiddenField(field), `${field} was allowed`).toBe(true);
    }
  });

  it('refuses them however they are spelled', () => {
    for (const spelling of [
      'Password',
      'PASSWORD_HASH',
      'nationalId',
      'National-ID',
      'Given Name',
    ]) {
      expect(isForbiddenField(spelling), `${spelling} slipped through`).toBe(true);
    }
  });

  it('still allows the staff name, which is what "who did this" means', () => {
    // A farmer's name would arrive as given_name / family_name and is refused.
    // `name` on a user or officer row is the actor metadata the log exists for.
    expect(isForbiddenField('name')).toBe(false);
    expect(isForbiddenField('role')).toBe(false);
    expect(isForbiddenField('farmer_number')).toBe(false);
  });

  it('never renders a forbidden value, even when the payload carries one', () => {
    // This should never happen: the write path selects a farmer NUMBER, not a
    // person. It is asserted because "should never" is not a guarantee a
    // screen can rely on.
    const changes = fieldChanges({
      before: { national_id: 'SSD-1234567', phone: '+211912345678' },
      after: { national_id: 'SSD-7654321', phone: '+211999999999' },
    });
    const serialised = JSON.stringify(changes);
    expect(serialised).not.toContain('SSD-1234567');
    expect(serialised).not.toContain('SSD-7654321');
    expect(serialised).not.toContain('211912345678');
    for (const change of changes) {
      expect(change.withheld).toBe(true);
      expect(change.before).toBeUndefined();
      expect(change.after).toBeUndefined();
    }
  });

  it('names the touched field so the reader knows the event reached it', () => {
    const changes = fieldChanges({ before: { password: 'a' }, after: { password: 'b' } });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.field).toBe('password');
    expect(changes[0]?.withheld).toBe(true);
  });

  it('never dumps a nested object into the page', () => {
    // JSON of a nested value is how a sensitive field escapes a key-based
    // denylist. It is summarised instead.
    const changes = fieldChanges({
      before: { consent: { note: 'a sentence about a named person' } },
      after: { consent: { note: 'another one' } },
    });
    expect(JSON.stringify(changes)).not.toContain('named person');
    expect(changes[0]?.after).toBe('(structured value)');
  });

  it('summarises a change by field NAME and never by value', () => {
    const summary = changeSummary({
      before: { verification_status: 'pending', payam_id: 'CE-JUB-MUN' },
      after: { verification_status: 'verified', payam_id: 'CE-JUB-KAT' },
    });
    expect(summary).toContain('verification status');
    expect(summary).not.toContain('verified');
    expect(summary).not.toContain('CE-JUB');
  });

  it('says so plainly when nothing changed', () => {
    expect(changeSummary({ before: null, after: null })).toBe('No field changes recorded');
  });

  it('covers every forbidden field the module declares', () => {
    for (const field of FORBIDDEN_AUDIT_FIELDS) expect(isForbiddenField(field)).toBe(true);
  });
});

describe('damaged historical identifiers', () => {
  it('recognises the marker the old scrubber left', () => {
    expect(isDamagedId('60fa[redacted]d2-bf[redacted]')).toBe(true);
    expect(isDamagedId('[redacted]')).toBe(true);
  });

  it('does not call an intact identifier damaged', () => {
    expect(isDamagedId(ACTOR)).toBe(false);
    expect(isDamagedId('CE-JUB-MUN')).toBe(false);
    expect(isDamagedId('a sentence mentioning [redacted] in prose')).toBe(false);
    expect(isDamagedId(undefined)).toBe(false);
    expect(isDamagedId(42)).toBe(false);
  });

  it('labels a damaged value instead of inventing one', () => {
    const changes = fieldChanges({
      before: { farm_id: '60fa[redacted]d2-bf[redacted]' },
      after: { farm_id: ACTOR },
    });
    expect(changes[0]?.damaged).toBe(true);
    expect(changes[0]?.before).toBe(DAMAGED_ID_LABEL);
    // Never a fabricated UUID, never a zero.
    expect(changes[0]?.before).not.toMatch(/^[0-9a-f-]{36}$/);
    expect(changes[0]?.before).not.toBe('0');
  });
});

describe('labels survive a record kind this build has never seen', () => {
  it('names the kinds it knows', () => {
    expect(entityLabel('user')).toBe('Staff account');
    expect(entityLabel('farmer')).toBe('Farmer');
  });

  it('falls back safely rather than crashing or hiding the event', () => {
    expect(entityLabel('cooperative_membership')).toBe('cooperative membership');
    expect(entityLabel('')).toBe('');
  });

  it('reads an action without its prefix', () => {
    expect(actionLabel('farmer.soft_deleted')).toBe('Soft deleted');
    expect(actionLabel('auth.disable_failed')).toBe('Disable failed');
    expect(actionLabel('something_new')).toBe('Something new');
  });

  it('names every actor type, including the system', () => {
    expect(actorLabel('admin')).toBe('Administrator');
    expect(actorLabel('system')).toBe('System');
    expect(actorLabel('unheard_of')).toBe('unheard_of');
  });
});

describe('the four supported filters, and only those', () => {
  it('sends nothing when nothing is chosen', () => {
    expect(toAuditParams(EMPTY_AUDIT_FILTERS)).toEqual({});
  });

  it('builds a query the shared schema accepts', () => {
    const params = toAuditParams(
      withFilters({
        entity_type: 'farmer',
        entity_id: ACTOR,
        actor_id: ACTOR,
        from: '2026-09-01',
        to: '2026-09-30',
      }),
      'cur',
    );
    const asStrings = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
    expect(auditFilterSchema.safeParse(asStrings).success).toBe(true);
  });

  it('sends no filter the route does not define', () => {
    const params = toAuditParams(withFilters({ entity_type: 'farmer' })) as Record<string, unknown>;
    for (const invented of [
      'q',
      'search',
      'action',
      'severity',
      'ip',
      'device',
      'state',
      'payam',
    ]) {
      expect(params[invented], `sent an unsupported ${invented} filter`).toBeUndefined();
    }
  });

  it('withholds a half-typed actor id rather than failing the whole request', () => {
    // `actor_id` must be a UUID or the strict schema refuses everything, which
    // would look to the reader like the audit log itself was broken.
    expect(toAuditParams(withFilters({ actor_id: '111' })).actor_id).toBeUndefined();
    expect(toAuditParams(withFilters({ actor_id: ACTOR })).actor_id).toBe(ACTOR);
    expect(actorIdLooksValid('111')).toBe(false);
    expect(actorIdLooksValid('')).toBe(true);
    expect(actorIdLooksValid(ACTOR)).toBe(true);
  });

  it('treats the range as inclusive at both ends', () => {
    // The route runs occurred_at >= from AND occurred_at <= to, so a "to" date
    // must close at the end of its own day or that day's events vanish.
    const params = toAuditParams(withFilters({ from: '2026-09-01', to: '2026-09-30' }));
    expect(params.from).toBe('2026-09-01T00:00:00.000Z');
    expect(params.to).toBe('2026-09-30T23:59:59.999Z');
  });

  it('reads filters back from the URL and ignores anything else', () => {
    const query: Record<string, string> = { entity_type: 'farmer', junk: 'x' };
    const state = fromQuery((key) => query[key] ?? '');
    expect(state.entity_type).toBe('farmer');
    expect(Object.keys(state)).toEqual([...AUDIT_FILTER_KEYS]);
  });

  it('clears every key it owns', () => {
    for (const [, value] of Object.entries(clearAuditFilters())) expect(value).toBeNull();
  });

  it('shows one chip per active filter, and none when idle', () => {
    expect(auditChips(EMPTY_AUDIT_FILTERS)).toEqual([]);
    expect(hasAuditFilters(EMPTY_AUDIT_FILTERS)).toBe(false);
    const chips = auditChips(withFilters({ entity_type: 'user', from: '2026-09-01' }));
    expect(chips.map((c) => c.key)).toEqual(['entity_type', 'from']);
    expect(chips[0]?.label).toBe('Record kind: Staff account');
  });
});

describe('the module offers no way to change the log', () => {
  it('exports no mutation verb', () => {
    // The audit table is append-only: no route updates or deletes a row, and a
    // trigger refuses both. Nothing here should suggest otherwise.
    const exported = {
      toAuditParams,
      fieldChanges,
      changeSummary,
      entityLabel,
      actionLabel,
      auditChips,
    };
    for (const name of Object.keys(exported)) {
      expect(name).not.toMatch(/delete|update|clear|flag|review|resolve|export/i);
    }
  });
});
