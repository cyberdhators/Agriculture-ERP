# Where main stands ahead of its criteria

_For Alieu, from the owner, 15 September 2026. One page. Prepared by Lane 1
from the tree and the record, not from memory._

## The position

Since 13 September, Lane 2 has merged eleven pull requests to main. **The work in
them is good.** The auth bridge closed a seam that had 49 routes and 29 pages
never speaking. The dossier, visits and reassignment screens run on the real
routes and honour the criteria they cite. #90's weather tile read the route
contract exactly as it was written for and honoured the line about never
inviting comparison between locations — the one instruction a UI author would
not have known to follow.

**The issue is not quality. Three scope decisions have been taken by merging
rather than by deciding**, and one of them is the farmer-facing application
that `CLAUDE.md` §2 says awaits the client.

## What is on main that no criteria exist for

| PR               | What it does                                                                             | Deliverable                | Criteria                                              | Needs a farmer principal              |
| ---------------- | ---------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- | ------------------------------------- |
| #65 (re-landed)  | Farmer marketplace, farmer account, farmer login and register                            | farmer app — §2 unresolved | none                                                  | **yes** — runs on a fixture password  |
| #88              | Marketplace visible by default                                                           | (g), via the amendment     | none — "unnumbered on purpose" until CORWADO confirms | listing side, yes                     |
| #89              | Marketplace on a phone, produce first                                                    | same                       | none                                                  | same                                  |
| #91              | Buyer reaches a farmer through a contact request the officer passes on                   | (g)                        | none                                                  | partly — the request lands with staff |
| #92              | A listing shows a trading name the farmer chose                                          | amendment                  | none                                                  | **yes** — the farmer chooses it       |
| #90              | The farmer's Home: weather first, then Post, Marketplace, listings, Learn, farm, account | farmer app + (e)           | C-16 covers the **staff** tile only                   | **yes — see below**                   |
| #77 (open, held) | The marketplace becomes the front door of agrionesouthsudan.com                          | amendment                  | none                                                  | —                                     |

**Criteria-backed and not in question:** #67 (auth bridge), #71 (C-8), #72
(C-5, 6, 7, 8), #74 (C-8R), #85 (C-5.1), #86 (C-6.1), #87 (C-10), and #73 open
(C-10). Eight of the eleven merges have criteria. The three that do not are the
three scope decisions.

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
2. **The marketplace amendment is implemented and visible by default.** The
   scope document says it is _"the owner's reading, not CORWADO's instruction…
   if they decline, the work is removed."_ #77 is held for exactly that reason,
   and the substance it fronts has merged around it.
3. **Deliverable (e) reaches farmers through a home-screen tile.** C-16 was
   written for staff. #90 extended it to farmers before the contract had a
   farmer scope or the backend a farmer principal.

## What the owner is asking for

- **Nothing farmer-facing merges until §2 is answered** — by CORWADO, in writing.
  The work stays on its branches; nothing is thrown away.
- **The marketplace lives on a path, not the homepage**, until the amendment is
  confirmed. #77 stays held.
- **Before any farmer flag turns on, the farmer principal is designed** — as a
  unit with criteria, not as a flag flip. B12 is the name already in the code.
- **Staging rows come from the suite or the seed, never by hand.** The
  `Proof Officer (placeholder)` officer and its farmer, made this morning, turned
  main red twice and need removing. The rule was approved yesterday and had
  landed nowhere either lane reads; that is on the process, not the person.

_The owner asked that this be fair to the work, and it should be read that way._
