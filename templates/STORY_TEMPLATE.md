# Story Template

Use this template when creating new user stories in `epics/{epic-slug}/stories/`.

---

```markdown
---
id: story-{kebab-case-name}
epic: epic-{parent-epic-id}
title: {Human-Readable Title}
status: draft                # draft | ready | in_progress | done | blocked | sunset
priority: P2                 # P0 (critical) | P1 (important) | P2 (normal) | P3 (low)
persona: user                # user | developer | admin | {custom}
points: 3                    # fibonacci: 1, 2, 3, 5, 8, 13
depends_on: []               # story IDs that must ship first
blocked_by: []               # story IDs currently blocking this
services_affected:
  - path/to/file.js
experimental: false          # set true for probationary features
# --- Only if experimental: true ---
# experiment_hypothesis: >
#   Brief hypothesis about why this feature will help users.
# experiment_success_metric: >
#   Measurable condition for promoting to permanent.
# experiment_sunset_date: 2026-07-01
created_at: {YYYY-MM-DD}
---

# Story: {Title}

## User Story

**As a** {persona},
**I want** {capability},
**So that** {business value}.

## Context

{2-3 paragraphs explaining the technical context, relevant architecture
decisions, and any background the implementer needs to understand.}

## Acceptance Criteria

\```gherkin
Feature: {Feature Name}

  Scenario: {Happy path scenario}
    Given {precondition}
    When {action}
    Then {expected result}

  Scenario: {Edge case or error scenario}
    Given {precondition}
    When {action}
    Then {expected result}
\```

## Design Notes

- {Visual or UX guidance}
- {Component library or animation notes}
- {Mobile responsiveness requirements}

## Out of Scope

- {Explicit exclusions to prevent scope creep}

## Implementation Reference

- {path/to/relevant/file.js}
```

---

## Status Lifecycle

```
draft → ready → in_progress → done
                    ↓
                 blocked → ready (when unblocked)

done → sunset (for experimental features being removed)
```

| Status | Meaning |
|--------|---------|
| `draft` | Story written but not reviewed. Not ready for implementation. |
| `ready` | Story reviewed, Gherkin approved. Ready for TDA cascade. |
| `in_progress` | Jules or a human is actively implementing. |
| `done` | Implementation merged, tests passing, feature live. |
| `blocked` | Cannot proceed — dependency not shipped. |
| `sunset` | Experimental feature being removed. Triggers reverse cascade. |

### Agent-Managed Transitions

When Jules (or another AI agent) implements a story, it is expected to
update the YAML `status` field as part of its commits:

1. **First commit:** Change `status` from `ready` to `in_progress`.
2. **Final commit (before opening the PR):** Change `status` to `done`.

This keeps the Markdown files in sync with the Linear execution layer
without requiring a background webhook to rewrite files.
