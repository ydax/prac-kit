# PRaC Operational Guide

**System:** Product Requirements as Code (PRaC)
**Version:** 1.0 — Extracted from Haas/Signal autonomous architecture

---

This guide is the canonical operational reference for the PRaC system. It documents how the autonomous development loop works — from writing stories through automated Blueprint generation, Test-Driven Autonomy, PR review, and self-healing.

## 1. The Requirements Hierarchy & Gherkin

The system operates on a "Product-Requirements-as-Code" (PRaC) model. Human intent is defined in plain text, and the system translates it into machine-enforceable rules.

### The Document Structure
1. **Epic (`EPIC.md`)**: The strategic capability and blast radius.
2. **Story (`STORY.md`)**: The atomic unit of human value. This is where you spend your time.
3. **Blueprint (`BLUEPRINT.md`)**: The machine-readable implementation contract.

### Gherkin as the System Contract
Within Stories and Blueprints, we use **Gherkin** (Given/When/Then syntax) to describe system behavior rules — whether triggered by a user or a background event.

```gherkin
Given the visitor is on the page
When the visitor clicks "Submit"
Then the form data is sent to the API
```

---

## 2. Linear: The Execution Layer

Linear is the project management backbone. The `epics/` directory is the *requirements layer*; Linear is the *execution layer*.

### Core Integrations

| Integration | What It Does |
|---|---|
| **GitHub** | PR status auto-transitions Linear issues. |
| **Sentry** | Production errors auto-create Linear issues. |
| **Jules** | Issues trigger autonomous coding sessions via the Jules REST API. |

### Triggering Jules

Jules is triggered via the **Jules REST API** using `scripts/trigger-jules.js`:

```bash
node scripts/trigger-jules.js <LINEAR_ISSUE_ID>
```

The script creates a Jules session, stores state for the Reviewer, and creates a GitHub Issue for Linear linkage.

---

## 3. The Orchestrator Pipeline (Story → Blueprint)

When you want to build a new feature:

1. Create a `STORY.md` file in `epics/{epic}/stories/{slug}/`
2. `git commit` and `git push`
3. A GitHub Action detects the change and runs `orchestrate-story.js`
4. The script calls Gemini to translate the Story into Blueprint Gherkin
5. A PR is opened (and optionally auto-merged)
6. A post-merge handler creates a Linear issue and queues it for Jules

**Push one story per commit** for clean PRs.

---

## 4. Test-Driven Autonomy (TDA)

Once the Blueprint is updated, Jules follows strict TDA:

1. Read the Gherkin scenarios in `BLUEPRINT.md`
2. Write a test asserting the described behavior
3. Run the test — **it must fail** (proves behavior doesn't exist)
4. Write implementation code to make the test pass
5. Never modify the test file during implementation

The test acts as a cage — Jules cannot invent unauthorized features.

---

## 5. Automated PR Review

When Jules opens a PR, the Reviewer workflow fires automatically:

1. GitHub Action extracts the Jules Session ID from the PR body
2. Runs `review-pr.js` with the Gemini API
3. The LLM compares the diff against the Linear issue and Blueprint
4. **APPROVE** → auto-merge, trigger next cascade task
5. **REQUEST_CHANGES** → sends feedback to Jules via REST API

**Guardrails:**
- Max 3 revisions (configurable in `prac.config.js`)
- Spec-only review (no style preferences)
- Escalates to human after max attempts

---

## 6. Task Cascades

### Smart Priority Cascade
1. **Queue:** Merging Blueprint PRs creates Linear issues without auto-starting Jules
2. **Kickoff:** Run `node scripts/kickoff-sprint.js` to start the engine
3. **Autonomous Loop:** After each merge, the Reviewer triggers the next priority task

### Scheduled Rhythms
- **Nightly:** Full test suite. Failures create Linear issues.
- **Weekly:** Optional doc audit.

---

## 7. The Self-Healing Loop

When a production error occurs:

```
Error → Sentry → Linear Issue → Jules TDA Fix → PR → Reviewer → Merge → Resolved
```

---

## 8. Feature Sunsetting

Change a story's status to `status: sunset`. The Orchestrator detects the deletion and:
1. Removes Gherkin from the Blueprint
2. Creates a removal Linear issue
3. Jules deletes code, tests, and imports

The story file remains as permanent institutional memory.

---

## 9. Configuration

All repo-specific values live in `prac.config.js`:

```bash
# Initialize in a new repo
npx @ydax/prac-kit init

# Update scripts to latest
npx @ydax/prac-kit update

# Scaffold a new epic
npx @ydax/prac-kit epic create my-feature

# Check configuration
npx @ydax/prac-kit doctor
```

---
*End of PRaC Operational Guide.*
