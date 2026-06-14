# AI Usage Log — SplitNest

> This file documents how AI (Claude via Antigravity) was used throughout
> development, including cases where the AI got something wrong and was
> corrected. The assignment requires at least 3 such cases.

## Tool Used

- **AI Assistant:** Claude (Anthropic) via Google Antigravity
- **Usage mode:** Pair programming — AI proposes, human reviews and approves

---

## Corrections Log

### Correction #1: Prisma v7 Breaking Changes (not caught proactively)

**What happened:** When installing dependencies, the AI ran `npm install prisma`
which installed Prisma v7.8.0 (the latest). Prisma 7 has a major breaking
change: the `url` property in `datasource` is no longer supported in
schema.prisma and must be configured in a separate `prisma.config.ts` file.

**How it was caught:** Running `npx prisma validate` returned error P1012:
"The datasource property `url` is no longer supported in schema files."

**What was corrected:** Downgraded to Prisma v5 (`npm install prisma@5
@prisma/client@5`) where the schema file is self-contained. This was the
right call for our use case — Prisma 5 keeps the schema as the single source
of truth with no extra config files. Documented as D-013 in DECISIONS.md.

**Lesson:** Always pin major versions when installing packages, or at least
check the changelog before using `@latest`. The AI should have specified
`prisma@5` from the start.

---

### Correction #2: (to be filled during development)

### Correction #3: (to be filled during development)

---

## How AI Was Used (Summary)

| Phase | AI Contribution | Human Review |
|-------|----------------|-------------|
| Schema design | Proposed 8-table schema with rationale | User reviewed, requested 7 specific improvements |
| Anomaly detection | Identified 19 CSV anomalies, proposed handling policies | User refined guest-participant logic, date reasoning |
| Decision documentation | Wrote DECISIONS.md entries with worked examples | User verified math, strengthened justifications |
| Auth implementation | Generated Express + bcrypt + JWT code | User to review in code walkthrough |
| CSV import | (upcoming) | (upcoming) |
| Balance engine | (upcoming) | (upcoming) |
| Frontend | (upcoming) | (upcoming) |
| Deployment | (upcoming) | (upcoming) |
