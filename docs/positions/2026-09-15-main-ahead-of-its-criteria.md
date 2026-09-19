# Where main stands ahead of its criteria

_For Alieu, from the owner, 15 September 2026. One page. Prepared by Lane 1
from the tree and the record, not from memory._

## The position

Since 13 September, Lane 2 has merged fourteen pull requests to main. **The
work in them is good.** The auth bridge closed a seam that had 49 routes and 29
pages never speaking. The dossier, visits, reports and reassignment screens run
on the real routes and honour the criteria they cite. #90's weather tile read
the route contract exactly as it was written for and honoured the line about
never inviting comparison between locations — the one instruction a UI author
would not have known to follow. **And Lane 2's own audit (#82) reached the same
three questions for CORWADO that this page rests on**, and proposed that the
farmer principal and C-15 be written as criteria before being coded. This page
and that audit agree on the position; they differ only on sequence.

**The issue is not quality. Three scope decisions have been taken by merging
rather than by deciding**, and one of them is the farmer-facing application
that `CLAUDE.md` §2 says awaits the client.

**One correction to how this page was first drafted, for fairness.** The
marketplace being _visible_ without a staff session (#88) was **the owner's
decision**, recorded in DECISIONS in the owner's words — _"let it be visible;
changes will be applied"_ — and #91 and #92 are those changes being applied. That
is Lane 2 following an instruction, not a decision taken by merging, and it is
not counted below.

## What is on main that no criteria exist for

| PR                             | What it does                                                                                                 | Deliverable                | Criteria                                                             | Needs a farmer principal             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| #65 (re-landed)                | Farmer marketplace, farmer account, farmer login and register                                                | farmer app — §2 unresolved | none                                                                 | **yes** — runs on a fixture password |
| **#77 — merged 14 Sept 20:45** | The marketplace becomes the front door of agrionesouthsudan.com; the staff portal linked from nowhere public | amendment                  | none — the scope says "the owner's reading… removed if they decline" | —                                    |
| #90                            | The farmer's Home: weather first, then Post, Marketplace, listings, Learn, farm, account                     | farmer app + (e)           | C-16 covers the **staff** tile only                                  | **yes — see below**                  |
| #88, #89, #91, #92             | Marketplace visible, mobile layout, contact request, trading name                                            | (g), via the amendment     | none yet — "unnumbered on purpose"                                   | listing side, yes                    |

The last row is **not** a decision by merging: #88 was the owner's instruction
and #89–#92 apply it. It is listed because it has no criteria and needs a farmer
principal, which are facts about the tree.

**Criteria-backed and not in question:** #67 (auth bridge), #71 (C-8), #72
(C-5, 6, 7, 8), #73 (C-10), #74 (C-8R), #79 (C-13), #84 (officer sign-in by
phone — restores B3's rule on the web), #85 (C-5.1), #86 (C-6.1), #87 (C-10).
Ten of fourteen have criteria or are the owner's recorded instruction.

## The farmer principal, which none of the farmer-side work has

`requireRole` knows two kinds of caller: `user` and `officer`. **There is no
farmer.** `farmer-session.ts` on main says so in its own header — _"PREVIEW —
replaced by the B12 session… nothing is written anywhere… when B12 lands,
`POST /api/farmer/auth/login`"_. `produce_listing` does not exist. So every
farmer-side screen on main runs on fixtures behind a flag, and **every
farmer-side call to a real route returns 401** the day any of those flags turns
on.

**#90 is the concrete case.** Its weather tile reads `GET /api/weather` per the
contract — correctly, and behind `NEXT_PUBLIC_USE_LIVE_WEATHER`, off by default,
on one plainly-invented row. The contract scopes by `admin`, `supervisor`,
`read_only` and `officer`, because it was written for the staff tile that C-16
describes. **A farmer has no scope in it. The day the flag turns on, a farmer's
browser gets 401.** That is not a defect in #90; it is a missing backend unit
— B12, the farmer principal — which has no criteria and sits inside the §2
question.

## The three decisions, stated as decisions

1. **The farmer-facing application exists on main.** The Inception Report reaches
   farmers by SMS in this phase and excludes a farmer-installed application; the
   designs show one; `CLAUDE.md` §2 says the client decides. Main has decided.
2. **The marketplace is the public front door of the client's domain (#77).**
   The scope document says the amendment is _"the owner's reading, not
   CORWADO's instruction… if they decline, the work is removed."_ Visibility was
   the owner's call; **the homepage was not**. #77 merged on 14 September at
   20:45 under the shared GitHub identity, and the owner believed it unmerged
   on the 15th. Whoever merged it, the record cannot say — which is the
   mechanism recorded after #49 and #50, and the reason a merge is not a
   decision.
3. **Deliverable (e) reaches farmers through a home-screen tile.** C-16 was
   written for staff. #90 extended it to farmers before the contract had a
   farmer scope or the backend a farmer principal.

## What the owner is asking for

- **Nothing farmer-facing merges until §2 is answered** — by CORWADO, in writing.
  The work stays on its branches; nothing is thrown away.
- **The marketplace lives on a path, not the homepage**, until the amendment is
  confirmed. #77 is already on main, so this is a revert of one redirect, not a
  hold — and everything else in #77 (the staff link removed from public pages)
  can stay.
- **Before any farmer flag turns on, the farmer principal is designed** — as a
  unit with criteria, not as a flag flip. B12 is the name already in the code.
- **Staging rows come from the suite or the seed, never by hand.** The
  `Proof Officer (placeholder)` officer and its farmer, made this morning, turned
  main red twice and need removing. The rule was approved yesterday and had
  landed nowhere either lane reads; that is on the process, not the person.

_The owner asked that this be fair to the work, and it should be read that way._
