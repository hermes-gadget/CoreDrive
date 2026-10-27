# Contributing

CoreDrive is developed in small pull requests. `main` is protected; nothing lands without a PR.

## Before you start

- Open or claim an issue with clear acceptance criteria.
- Keep one work package per PR. Aim for under 400 changed lines, excluding lockfiles and generated files.
- Branch from `main`: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.

## What a PR needs

- A short body: what changed, why, and how you verified it.
- Tests for new behaviour. Bug fixes get a regression test.
- Screenshots for any UI change, at mobile and desktop widths.
- `Closes #<issue>`.
- Green CI. Squash merge, delete the branch.

## Writing

All prose, UI copy, commit messages and PR bodies get an editing pass with the `unslop` skill: answer first, cut filler, prefer concrete mechanisms and numbers over metaphors, no promotional padding.

## Design

UI work starts with a short design read: page kind, audience, constraints, and whether this is a preserve or overhaul job. Set the variance, motion and density dials before writing code. The `taste-skill` skill has the full checklist. Banned defaults: AI-purple gradients, mesh backgrounds, card soup, emoji headings, generic hero copy.

## Code

- TypeScript, strict mode.
- Tests: Vitest for units and integration, Playwright for end-to-end.
- No transmit calls in the client. The product is passive-only; a PR that adds a radio transmit path will be rejected.
- Do not log credentials, tokens or exact coordinates.

## Reviews

A review checks correctness, security, protocol accuracy and design. Findings are filed as issues when they are out of scope for the PR under review.
