# Bird support request — one sender delivers on a carrier, another is refused (2026-09-14)

Drafted by Lane 1 for the owner to send. **Not sent:** Bird exposes no public
support API — only `/v1/internal/support/*`, which is Bird's own surface and not
ours to call — so this goes through the dashboard or the account's support
address.

Nothing here is secret: message ids, a carrier code, registration ids, sender
strings and two destination numbers already present in the message records. No
API key.

**Scope note.** An earlier draft of this asked whether South Sudan delivery
works at all. It does — see the first table below — so the question has
narrowed to Liberia and to what `approved` guarantees.

---

## Subject

`approved` sender refused as `EC_SENDER_UNREGISTERED` (104) on 61801, while a different sender delivers on the same carrier

## Body

We are evaluating Bird for an agricultural extension programme in South Sudan.
Before building anything we tested delivery. South Sudan works. Liberia, which
we used as a control, does not, and the pattern points at the sender rather than
the route.

**What delivered.**

| Message id                       | To              | Sender         | Network                 | Result                  |
| -------------------------------- | --------------- | -------------- | ----------------------- | ----------------------- |
| `sms_01m2e70qnef6d92zvmg5pch574` | `+211922200858` | `Agrione_SS`   | 65902 MTN South Sudan   | **delivered**, 0.20 EUR |
| `sms_01m2cqwk58fs6vke9xjqwck8rk` | `+231886257473` | **`Authifly`** | 61801 Lonestar Cell MTN | **delivered**, 0.18 EUR |

**What did not.** Every one of these is sender `Agrione_SS` on 61801, refused
with `carrier_error_code: 104`, `code: content_rejected`, and billed 0.18 EUR:

| Message id                        | To              | Category       | Chars |
| --------------------------------- | --------------- | -------------- | ----- |
| `sms_01m2e6efjwf2as0hvadwawmcbh`  | `+231886257473` | service        | 128   |
| `sms_01m2e6q416ezbs10qy3jk4ehek`  | `+231886257473` | transactional  | 5     |
| `sms_01m2f313kre7avf034q2r01paa`  | `+231888022031` | authentication | 54    |
| `sms_01m2f3chc4e8mvwd9scaykr934`  | `+231888022031` | marketing      | 125   |
| `sms_01m2f3ya32f62rh5ewrs0saqcz`  | `+231888022031` | service        | 148   |
| `sms_01m2f4aaype6786jgqnkh1cph5`  | `+231888022031` | service        | 148   |
| _(retry at 2026-09-14T05:41:33Z)_ | `+231888022031` | service        | 148   |

Four categories and lengths from 5 to 148 characters all fail identically, so
this is not content. **`Authifly` delivers on the same carrier, so it is not the
route.** It is `Agrione_SS` specifically, on 61801.

**What your API says about that sender.**
`GET /v1/sms/senders/snd_01m2e5wtjcf8eveab6z0zjcnc8/requirements`:

| Field                 | LR                               | SS                               |
| --------------------- | -------------------------------- | -------------------------------- |
| `destination_enabled` | true                             | true                             |
| `required`            | false                            | false                            |
| `status`              | **approved**                     | **approved**                     |
| `registration_id`     | `scr_01m2e6bb3je43s7xkdayfmzdng` | `scr_01m2e6b51fexwt25h86t5x727g` |
| `rejection_reason`    | null                             | null                             |
| `next`                | `[]`                             | `[]`                             |

**We tested propagation and it is not the answer.** The sender was created at
`2026-09-13T20:03:48Z`. The Liberian failures start at `20:13` and the South
Sudan delivery is at `20:23`, so one registration bound within twenty minutes
and the other had not bound after ten. We waited and sent one further message at
`2026-09-14T05:41:33Z` — **9 hours 38 minutes after the sender was created** —
and it failed identically with carrier code 104. This is not a registration
still settling.

**Our questions.**

1. **Is `approved` decided per country or per carrier?** Your documentation says
   registration is "decided per destination, so there is one row per country",
   and we find no per-carrier field in the sender surface. If a country-level
   approval does not bind every network in that country, how do we see which
   networks it covers?

2. **What does `approved` mean for a network that refuses the sender as
   unregistered?** Specifically for `scr_01m2e6bb3je43s7xkdayfmzdng`: has that
   registration reached Lonestar Cell MTN, and if so is something else refusing?

3. **If it is not propagation, what is `approved` describing?** We have ruled
   propagation out by waiting nine and a half hours. Is there any field that
   distinguishes "filed with Bird" from "live at the carrier"? `approved` with
   `next: []` and `rejection_reason: null` reads as complete, and at this
   carrier it is not.

4. **Why is carrier code 104 (`EC_SENDER_UNREGISTERED`) surfaced as
   `content_rejected`?** The label points at the message, the carrier code at
   the sender. We spent two billed sends rewriting content that was never the
   problem.

5. **Is a rejected message billed by design?** Six refusals cost 1.08 EUR and
   delivered nothing. We need this confirmed before budgeting, because it means
   the figure to multiply is messages attempted, not received.

6. **South Sudan, which is the actual target.** MTN South Sudan delivered. What
   can you tell us about **Zain South Sudan (`659-91`) and Digitel** for the
   same sender — are they covered by the same `approved` row, and would you
   expect the Liberian pattern there? **This is the question that matters most
   to us**, because `approved` is the only signal we have for those two
   networks, and Liberia has just shown us what it can be worth.

7. **What is the sender `Authifly`?** It delivered on 61801 from this account on
   2026-09-13 at 06:39, it is absent from our workspace's sender list — which
   holds only `Agrione_SS` — and it predates our sender by thirteen hours. It is
   the one sender known to deliver on the carrier that refuses ours, so we would
   like to know what it is and why it works there.

We are not asking for a credit. We need to know what `approved` is worth, since
that is the signal we would otherwise rely on for the two South Sudanese
networks we have not yet tested.
