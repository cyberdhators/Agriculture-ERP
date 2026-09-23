import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The officer visit screens' boundaries, read as source with comments stripped.
 *
 * THE SERVER-SIDE RULES ARE NOT RE-TESTED HERE. `tests/visits.test.ts` already
 * proves, against real staging, that an officer records only for their own
 * farmer, that another officer's visit is a 404, that the correction window is
 * measured from the server's moment and that the evidence columns cannot be
 * changed by anyone. Repeating those assertions against a mock would add
 * confidence in nothing. What is unproven until now is that THESE SCREENS do
 * not quietly work around them.
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const RECORD = code('components/officer/OfficerRecordVisit.tsx');
const LIST = code('components/officer/OfficerVisits.tsx');
const DETAIL = code('components/officer/OfficerVisitDetail.tsx');
const ATTACH = code('components/officer/VisitAttachments.tsx');
const MODEL = code('lib/officer/visits.ts');
const FARMER_DETAIL = code('components/officer/OfficerFarmerDetail.tsx');

describe('the routes these screens link to exist', () => {
  it.each([
    'app/(portal)/visits/page.tsx',
    'app/(portal)/visits/[id]/page.tsx',
    'app/(portal)/farmers/[id]/visits/new/page.tsx',
  ])('%s', (page) => {
    expect(() => read(page)).not.toThrow();
  });

  it('an officer gets their own screens; every other role keeps what they had', () => {
    expect(code('components/visits/VisitsByRole.tsx')).toMatch(
      /role === 'officer'\s*\?\s*<OfficerVisits \/>\s*:\s*<VisitsLog \/>/,
    );
  });

  it('the administrator’s visit log is imported, not rewritten', () => {
    expect(code('components/visits/VisitsByRole.tsx')).toContain("from './VisitsLog'");
  });
});

describe('the farmer is the route’s, never the screen’s to choose', () => {
  it('the record screen takes a farmerId and never lists farmers', () => {
    expect(RECORD).toMatch(/farmerId\s*\}\s*:\s*\{\s*farmerId:\s*string/);
    expect(RECORD).not.toContain('listFarmers(');
    expect(RECORD).not.toContain('FARMER_OPTIONS');
  });

  it('posts to the farmer-scoped route, so there is no farmer_id in the body', () => {
    expect(RECORD).toMatch(/createVisit\(\s*farmer\.id\s*,/);
    expect(MODEL).not.toMatch(/farmer_id:\s*/);
  });

  it('runs no ownership comparison of its own', () => {
    for (const source of [RECORD, LIST, DETAIL]) {
      expect(source).not.toMatch(/caseload_officer_id\s*===/);
    }
  });

  it('treats 404 as not-found rather than as a session problem', () => {
    expect(RECORD).toMatch(/404/);
    expect(DETAIL).toMatch(/404/);
  });

  it('the farmer detail’s “Record visit” carries THAT farmer’s id', () => {
    expect(FARMER_DETAIL).toContain('/farmers/${farmer.id}/visits/new');
  });
});

describe('it cannot do an administrator’s job', () => {
  it.each(['removeVisit', 'verifyFarmer', 'rejectFarmer', 'mergeFarmer', 'reassign'])(
    'never calls %s',
    (fn) => {
      for (const source of [RECORD, LIST, DETAIL, ATTACH]) {
        expect(source).not.toContain(fn);
      }
    },
  );

  it('offers no removal control anywhere in the officer’s visit screens', () => {
    for (const source of [LIST, DETAIL]) {
      expect(source).not.toMatch(/>\s*Remove\s*</);
    }
  });
});

describe('the correction window is the server’s', () => {
  it('the model measures from received_at, never from visited_at', () => {
    expect(MODEL).toMatch(/new Date\(visit\.received_at\)/);
    expect(MODEL).not.toMatch(/correctionState[\s\S]{0,400}visited_at/);
  });

  it('uses the shared limit rather than a hardcoded twenty-four hours', () => {
    expect(MODEL).toContain('VISIT_LIMITS.correctionWindowHours');
    expect(MODEL).not.toMatch(/=\s*24\s*\*/);
  });

  it('the correction body is built by the shared strict schema’s shape and checked by it', () => {
    expect(MODEL).toContain('correctVisitSchema.safeParse');
  });

  it('the detail screen never sends a moment or a position in a correction', () => {
    expect(DETAIL).not.toMatch(/visited_at:\s*/);
    expect(DETAIL).not.toMatch(/position:\s*/);
    expect(DETAIL).not.toMatch(/received_at:\s*/);
  });
});

describe('topics come from the canonical list', () => {
  it('the model re-exports the shared array rather than listing nine again', () => {
    expect(MODEL).toContain('export const TOPICS = VISIT_TOPICS');
    expect(MODEL).not.toContain("'land_preparation'");
  });

  it('the screens render from it, with the repository’s own labels', () => {
    for (const source of [RECORD, DETAIL]) {
      expect(source).toContain('TOPICS.map');
      expect(source).toContain('VISIT_TOPIC_LABELS');
    }
  });
});

describe('the position is the device’s, and never invented', () => {
  it('reads it from the browser’s geolocation, once, on purpose', () => {
    expect(RECORD).toContain('navigator.geolocation.getCurrentPosition');
    expect(RECORD).toContain('maximumAge: 0');
  });

  it('keeps no remembered position: no storage, no default coordinates', () => {
    for (const api of ['localStorage', 'sessionStorage', 'indexedDB']) {
      expect(RECORD).not.toContain(api);
    }
    expect(RECORD).not.toMatch(/longitude:\s*3\d/);
    expect(RECORD).not.toMatch(/latitude:\s*\d+\.\d+/);
  });

  it('cannot be submitted without one', () => {
    expect(RECORD).toMatch(/if \(problems\.length > 0 \|\| !fix\) return;/);
  });
});

describe('absent is not null, and not a dash', () => {
  it('the model omits unanswered optionals rather than sending null', () => {
    expect(MODEL).toMatch(/if \(observation !== ''\) body\.observation = observation;/);
  });

  it('the detail screen hides a section that was never recorded', () => {
    expect(DETAIL).toContain('visit.observation !== null');
    expect(DETAIL).toContain('visit.position ?');
  });

  it('never renders a placeholder for a missing value', () => {
    for (const filler of ['>—<', '>None<', 'Not recorded']) {
      expect(DETAIL).not.toContain(filler);
    }
  });
});

describe('attachments come after the visit, and keep their own three states', () => {
  it('the panel takes a saved visit, not a draft', () => {
    expect(ATTACH).toMatch(/\{\s*visit\s*\}\s*:\s*\{\s*visit:\s*Visit\s*\}/);
  });

  it('the record form shows it only once a visit came back from the server', () => {
    expect(RECORD).toMatch(/if \(saved\) \{[\s\S]*?<VisitAttachments visit=\{saved\} \/>/);
  });

  it('there is no attachment field inside the visit body', () => {
    expect(MODEL).not.toContain('attachment');
    expect(RECORD).not.toMatch(/photo:\s*/);
  });

  it('follows declare, then upload, then confirm — and the server decides arrival', () => {
    expect(ATTACH).toContain('declareAttachment(');
    expect(ATTACH).toContain('uploadAttachmentBytes(');
    expect(ATTACH).toContain('confirmAttachment(');
    // The phone never writes 'arrived' itself.
    expect(ATTACH).not.toMatch(/status:\s*'arrived'/);
  });

  it('a failed upload is reported as failed rather than left claiming to be sending', () => {
    expect(ATTACH).toContain('failAttachment(');
  });

  it('the three states stay distinguishable — three words and three classes', () => {
    // Not three spellings of the same thing: the status drives both the word
    // the officer reads and the colour it is read in.
    for (const word of ['Received', 'Waiting', 'Failed']) {
      expect(ATTACH).toContain(word);
    }
    expect(ATTACH).toMatch(/state_\$\{a\.status\}/);
    expect(ATTACH).toContain('ATTACHMENT_STATUS_MESSAGES');
  });

  it('is not an offline queue', () => {
    for (const api of ['localStorage', 'indexedDB', 'serviceWorker', 'navigator.onLine']) {
      expect(ATTACH).not.toContain(api);
    }
  });
});

describe('the list shows the officer’s work, not a report', () => {
  it('reads the scoped route and pages by its cursor', () => {
    expect(LIST).toContain('listVisits(');
    expect(LIST).toContain('cursor');
  });

  it('invents no search the route does not have', () => {
    expect(LIST).not.toMatch(/\bsearch\b/i);
    expect(LIST).not.toContain('.filter((v');
  });

  it('carries no administrative filter', () => {
    for (const filter of ['payam:', 'officer:']) {
      expect(LIST).not.toContain(filter);
    }
  });
});

describe('the follow-up link is offered safely, or not at all', () => {
  it('eligible visits come from the FARMER-scoped route, never a global list', () => {
    expect(RECORD).toMatch(/listFarmerVisits\(\s*farmerId\s*,/);
    expect(RECORD).not.toContain('listVisits(');
  });

  it('offers a choice from that list rather than a box to type an id into', () => {
    // A free-text UUID would let an officer name a visit they were never shown.
    expect(RECORD).toContain('earlier.map(');
    expect(RECORD).not.toMatch(/label="[^"]*follow[^"]*"[\s\S]{0,200}<Input/i);
  });

  it('is hidden entirely when the farmer has no earlier visit', () => {
    expect(RECORD).toMatch(/earlier\.length > 0 \?/);
  });

  it('defaults to following nothing', () => {
    expect(RECORD).toContain('Not a follow-up');
  });

  it('does not narrow the list to the officer’s OWN visits', () => {
    // The contract scopes a follow-up by farmer, not by officer: a reassigned
    // farmer's earlier visits belong to someone else and are still valid
    // targets. Filtering here would invent a rule the server does not have.
    expect(RECORD).not.toMatch(/earlier[\s\S]{0,120}officer_id\s*===/);
  });

  it('judges nothing itself — the id travels to the server as given', () => {
    expect(RECORD).not.toContain('follow_up_not_found');
    expect(RECORD).not.toContain('follow_up_cycle');
  });
});

describe('the visit detail says what a visit follows, and what followed it', () => {
  it('reads the existing chain route rather than walking visits itself', () => {
    expect(DETAIL).toContain('getVisitChain(');
    expect(DETAIL).not.toContain('listVisits(');
  });

  it('shows both directions', () => {
    expect(DETAIL).toContain('Follow-up to');
    expect(DETAIL).toContain('Followed up by');
  });

  it('a removed ancestor is said to be removed, never dropped and never filled in', () => {
    expect(DETAIL).toContain('isRemovedLink');
    expect(DETAIL).toMatch(/has since been removed/);
  });

  it('says nothing about a chain the visit does not have', () => {
    expect(DETAIL).toMatch(/visit\.follow_up_of !== null \|\| followUps\.length > 0/);
  });

  it('is two statements, not a timeline: the recent-visit presentation is untouched', () => {
    expect(FARMER_DETAIL).toContain('Recent visits');
    expect(DETAIL).not.toContain('timeline');
  });
});

describe('the follow-up can be corrected, inside the window and nowhere else', () => {
  it('the correction form is rendered ONLY when the server’s window is open', () => {
    // The whole editor, follow-up control included, sits inside the branch
    // guarded by `correcting`, which can only be entered from the button that
    // `window.canCorrect` renders. A shut window offers no editor at all.
    expect(DETAIL).toMatch(/window\.canCorrect \?/);
    expect(DETAIL).toMatch(/setCorrecting\(true\)/);
    expect(DETAIL).toMatch(/correcting && draft \?/);
  });

  it('the deadline is still the server’s, measured from received_at', () => {
    expect(DETAIL).not.toMatch(/visited_at[\s\S]{0,80}correctionState/);
    expect(MODEL).toMatch(/new Date\(visit\.received_at\)/);
  });

  it('a correction can never send a moment or a position', () => {
    expect(MODEL).not.toMatch(/patch\.visited_at/);
    expect(MODEL).not.toMatch(/patch\.position/);
    expect(MODEL).not.toMatch(/patch\.received_at/);
  });

  it('eligible visits come from the FARMER-scoped route, not a global list', () => {
    expect(DETAIL).toMatch(/listFarmerVisits\(\s*visit\.farmer_id\s*,/);
    expect(DETAIL).not.toContain('listVisits(');
  });

  it('offers a choice, never a box to type a uuid into', () => {
    expect(DETAIL).toContain('options.map(');
    expect(DETAIL).not.toMatch(/label="Follow-up[^"]*"[\s\S]{0,200}<Input/);
  });

  it('offers clearing the relationship as a real choice', () => {
    expect(DETAIL).toContain('Not a follow-up');
  });

  it('the option list is built by the shared helper, not assembled in the view', () => {
    expect(DETAIL).toContain('followUpOptions({');
    expect(DETAIL).toContain('currentId: visit.follow_up_of');
  });

  it('excludes the visit itself and its known follow-ups from the choices', () => {
    expect(DETAIL).toMatch(/selfId: visit\.id/);
    expect(DETAIL).toMatch(/excludeIds: followUps\.map/);
  });

  it('does not judge the target itself — the server’s refusals are not re-implemented', () => {
    expect(DETAIL).not.toContain('follow_up_not_found');
    expect(DETAIL).not.toContain('follow_up_cycle');
    expect(MODEL).not.toContain('follow_up_cycle');
  });

  it('eligible visits are fetched only once a correction is begun', () => {
    expect(DETAIL).toMatch(/!correcting/);
  });
});

describe('the visit detail as a field record', () => {
  it('names the farmer through the OFFICER-SAFE single lookup, not a directory read', () => {
    // `listFarmers({limit:200})` was a 200-row read to turn one id into one
    // name, and it never returned the farmer number.
    expect(DETAIL).toContain('getFarmer(visit.farmer_id)');
    expect(DETAIL).not.toContain('useVisitNames');
    expect(DETAIL).not.toContain('listFarmers(');
  });

  it('shows the farmer number and a route back to the farmer', () => {
    expect(DETAIL).toContain('farmer.farmer_number');
    expect(DETAIL).toContain('/farmers/${farmer.id}');
  });

  it('a farmer that cannot be read does not take the visit down with it', () => {
    expect(DETAIL).toMatch(/getFarmer\(visit\.farmer_id\)[\s\S]{0,200}catch/);
  });

  it('shows both moments with their times, not the date alone', () => {
    expect(DETAIL).toContain('stamp(visit.visited_at)');
    expect(DETAIL).toContain('stamp(visit.received_at)');
  });
});

describe('the visit’s location is read, never taken again or invented', () => {
  it('grades the accuracy with the CANONICAL helper — the route sends none for a visit', () => {
    expect(DETAIL).toContain('gradeAccuracy(visit.gps_accuracy_m)');
    for (const invented of ['excellent', 'acceptable', 'high accuracy']) {
      expect(DETAIL.toLowerCase()).not.toContain(invented);
    }
  });

  it('never reads a new position while viewing a visit', () => {
    expect(DETAIL).not.toContain('getCurrentPosition');
    expect(DETAIL).not.toContain('watchPosition');
  });

  it('fabricates no coordinates and borrows none from the farmer', () => {
    expect(DETAIL).not.toMatch(/coordinates:\s*\[\s*0\s*,\s*0\s*\]/);
    expect(DETAIL).not.toMatch(/farmer\.[a-z_]*(lat|lon|position)/i);
  });

  it('an absent position is simply not a section, rather than empty coordinates', () => {
    expect(DETAIL).toMatch(/visit\.position \?/);
  });
});

describe('the correction window, and the server having the last word', () => {
  it('shows the server’s own refusal sentence, and re-asks the server about the window', () => {
    /*
     * THIS TEST USED TO PIN DEAD CODE. It asserted the source contained
     * `failure?.code === 'correction_window_closed'`, which could never be
     * true: `unprocessable(rule)` sends the generic code `unprocessable` and
     * puts the rule's sentence in `message`. The string was present, so the
     * test passed, and the branch never ran. A source match is not a
     * behaviour.
     */
    expect(DETAIL).not.toContain("=== 'correction_window_closed'");
    expect(DETAIL).toContain('classify(failure)');
    expect(DETAIL).toMatch(/getVisit\(visit\.id\)[\s\S]{0,200}correctionState\(fresh/);
  });

  it('renders no edit control at all once the window has shut', () => {
    expect(DETAIL).toMatch(/window\.canCorrect \?/);
    expect(DETAIL).toContain('The day for correcting this visit has passed');
  });

  it('still measures from received_at, never visited_at', () => {
    expect(MODEL).toMatch(/new Date\(visit\.received_at\)/);
    expect(DETAIL).not.toMatch(/visited_at[\s\S]{0,80}correctionState/);
  });
});

describe('attachments are read without pretending the visit failed with them', () => {
  it('an arrived attachment can be opened through the existing link route', () => {
    expect(ATTACH).toContain('getAttachmentLink(');
    expect(ATTACH).toMatch(/a\.status === 'arrived' \?/);
  });

  it('a waiting or failed attachment is NOT offered an open action', () => {
    // The route answers 409 attachment_not_received for those two states.
    expect(ATTACH).not.toMatch(/status !== 'arrived'[\s\S]{0,80}getAttachmentLink/);
  });

  it('the link is fetched when asked for, never in advance for a list', () => {
    expect(ATTACH).not.toMatch(/rows\.map[\s\S]{0,200}getAttachmentLink/);
  });

  it('a failed attachment does not make the visit itself a failure', () => {
    // Attachment state lives on its own row and is rendered on its own row;
    // nothing about it reaches the visit's own heading or status.
    expect(DETAIL).not.toMatch(/attachment[\s\S]{0,60}(failed|error)[\s\S]{0,40}visit/i);
    expect(ATTACH).toContain('the visit is still recorded');
  });

  it('introduces no offline queue while viewing', () => {
    for (const api of ['localStorage', 'indexedDB', 'serviceWorker', 'navigator.onLine']) {
      expect(DETAIL).not.toContain(api);
    }
  });
});
