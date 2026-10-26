# Product

Written 2026-10-26, before development started. This is the target, not a description of finished work. What's actually built is tracked in [build-log.md](build-log.md).

## The problem

A container's handover is recorded on an **equipment interchange receipt (EIR)**: who handed what to whom, when, and in what condition. At inland and rail terminals and container depots, the EIR is often a paper form or a few phone photos without context. Three things go wrong:

- **Damage can't be placed in time.** Without comparable evidence from both sides of every handover, a dent found at the depot can't be traced to the handover where it appeared. The holder at the time of discovery often pays.
- **Inspections vary.** Coverage depends on the checker. Faces get skipped, photos lack dates and locations, and damage is described in free text rather than standard codes.
- **The record doesn't follow the container.** Each site keeps its own paper or photos, so the next handover starts from nothing.

## Who it's for

| Role | Need |
|---|---|
| Checker or gate clerk (user) | A fast walk-around that holds up later; no codebooks to memorise; hands mostly free |
| Terminal or depot operations (buyer) | Fewer disputed claims, consistent inspections, standard messages to customers |
| Rail operator (buyer) | Proof of condition when each container was received and handed over |
| Shipping-line claims and maintenance desks (later) | Standard-coded damage with photo evidence from every handover |

## The handover flow

1. **Identify:** read the container number and check digit, size/type code, seal number and hazard placards. Load the container's history.
2. **Locate:** register the container in AR from its faces and corner castings.
3. **Last handover:** show previously recorded damage on the container. The checker marks each item "still there" or "changed".
4. **Coverage:** each face and section is highlighted once there's evidence for it. The handover can't be closed with gaps.
5. **New damage:**
   - The app proposes damage outlines; the checker confirms or rejects by tap or voice.
   - The location code comes from where the mark sits on the container. Damage and component codes are suggested.
   - Sizes come from the container's standard dimensions.
6. **Notes and disputes:** voice notes become report fields. A disputed handover can be recorded with both parties' statements, labelled by speaker.
7. **Close:** EIR with annotated photos, comparison with the previous handover, EDIFACT CODECO gate message, draft claim if there's new damage, and a tamper-evident history entry.

## Scope for the hackathon (Oct 26 – Nov 4, 2026)

**Must work in the demo**

- Container number reading with ISO 6346 check-digit validation
- AR registration to the container and marks stored in the container's own coordinates
- The previous handover's damage shown on the container in a new session
- Coverage highlighting by face and section
- Damage proposals from SAM 3.1 with checker confirmation
- ISO 9897 (CEDEX) location codes derived from mark positions
- EIR PDF, handover comparison and CODECO message
- Blurring of faces and number plates
- A measured evaluation on licensed, labelled container photos

**Stretch goals**

- Voice commands and dispute recordings labelled by speaker
- Offline mode with Muse Glimmer
- Synthetic rare-damage test cases with Muse Image (excluded from reported accuracy)
- Draft claims from the comparison agent
- Rail wagon number capture at rail handovers
- A mixed-reality "claims room" on Quest 3 showing a container's history at full size

**Not in scope**

- Integration with a specific terminal operating system
- Repair estimates and costing (EDIFACT DESTIM)
- A full rules engine for inspection criteria
- Multiple organisations and permissions

## Principles

- **Evidence first:** every record carries time, place, the device and the checker, and history entries are hash-chained, so a record can't be quietly changed.
- **The checker decides:** the AI proposes and the checker confirms. Reported accuracy is measured on real photos only.
- **Standard output:** ISO 6346, ISO 9897 (CEDEX) and EDIFACT, so records fit the systems the industry already uses.
- **Privacy:** faces and number plates are blurred before anything is stored.
- **Clean data:** only openly licensed datasets and the author's own footage. No footage from restricted port areas.
