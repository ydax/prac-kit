/**
 * trigger-jules.js — Trigger a Jules coding session via the REST API.
 *
 * Creates a Jules session for a Linear issue, stores state for the
 * Reviewer, updates Linear status, and creates a GitHub Issue for linkage.
 *
 * Usage:
 *   node scripts/trigger-jules.js <LINEAR_ISSUE_ID>
 *   node scripts/trigger-jules.js HAA-6
 *
 * Requirements:
 *   - `gh` CLI must be authenticated
 *   - LINEAR_API_KEY set in .env
 *   - JULES_API_KEY set in .env
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  loadEnv,
  getRepo,
  getRepoRoot,
  getBlueprintInstructions,
  getLinearStateId,
  getLinearIssue,
  updateLinearIssueStatus,
  julesCreateSession,
  setTaskState,
  getMaxRevisions,
} = require('./shared');

loadEnv();

function buildPrompt(issue) {
  const instructions = getBlueprintInstructions();
  const instructionsList = instructions
    .map((inst, i) => `${i + 1}. ${inst}`)
    .join('\n');

  return `## Task: ${issue.identifier} — ${issue.title}

${issue.description || '_No description provided._'}

## Instructions

${instructionsList}
${instructions.length + 1}. Name your branch starting with \`${issue.identifier.toLowerCase()}\` so Linear auto-links the PR.
${instructions.length + 2}. Include "Closes ${issue.identifier}" in the PR description.
`;
}

function buildGitHubBody(issue, sessionId) {
  const instructions = getBlueprintInstructions();
  const instructionsList = instructions
    .map((inst, i) => `${i + 1}. ${inst}`)
    .join('\n');

  return `## Task

${issue.description || '_See Linear issue for full description._'}

## Linear Reference

This issue corresponds to Linear issue **${issue.identifier}**.

## Jules Session

Session ID: \`${sessionId}\`
Session URL: https://jules.google.com/session/${sessionId}

## Instructions for Jules

${instructionsList}
${instructions.length + 1}. **Name your branch starting with \`${issue.identifier.toLowerCase()}\`** so Linear auto-links the PR.

---
Closes ${issue.identifier}
`;
}

async function main() {
  const issueId = process.argv[2];
  if (!issueId) {
    console.error('Usage: node scripts/trigger-jules.js <LINEAR_ISSUE_ID>');
    process.exit(1);
  }

  const REPO = getRepo();

  console.log(`\n🔍 Fetching Linear issue ${issueId}...`);
  const issue = await getLinearIssue(issueId);

  if (!issue) {
    console.error(`Issue ${issueId} not found in Linear.`);
    process.exit(1);
  }

  console.log(`   Found: "${issue.title}" (${issue.state.name})`);

  // ── Step 1: Create Jules session via REST API ──────────────────────────
  const prompt = buildPrompt(issue);
  const title = `${issue.identifier}: ${issue.title}`;

  console.log(`\n🤖 Creating Jules session via REST API...`);
  const session = await julesCreateSession(prompt, title);
  const sessionId = session.id;
  console.log(`   ✅ Session created: ${sessionId}`);
  console.log(`   URL: https://jules.google.com/session/${sessionId}`);

  // ── Step 2: Store state for the Reviewer ───────────────────────────────
  setTaskState(issueId, {
    linearId: issueId,
    linearUuid: issue.id,
    sessionId,
    sessionUrl: `https://jules.google.com/session/${sessionId}`,
    prNumber: null,
    prUrl: null,
    attempts: 0,
    maxAttempts: getMaxRevisions(),
    status: 'triggered',
    previousComments: [],
    createdAt: new Date().toISOString(),
  });
  console.log(`   📋 State saved to .reviewer-state.json`);

  // ── Step 2.5: Update Linear Status to "In Progress" ────────────────────
  const inProgressStateId = getLinearStateId('inProgress');
  if (inProgressStateId) {
    console.log(`\n🔄 Updating Linear status to "In Progress"...`);
    try {
      await updateLinearIssueStatus(issue.id, inProgressStateId);
      console.log(`   ✅ Linear status updated.`);
    } catch (err) {
      console.warn(`   ⚠️ Failed to update Linear status: ${err.message}`);
    }
  }

  // ── Step 3: Create GitHub Issue for Linear linkage ─────────────────────
  const linearLabels = issue.labels.nodes.map(l => l.name.toLowerCase());
  const trackLabel = linearLabels.includes('visual') ? 'visual' : 'behavioral';
  const labels = `tracked,${trackLabel}`;
  const body = buildGitHubBody(issue, sessionId);

  console.log(`\n📋 Creating GitHub Issue for Linear linkage...`);
  const tmpFile = path.join(getRepoRoot(), '.jules-issue-body.tmp.md');
  try {
    fs.writeFileSync(tmpFile, body, 'utf-8');
    const output = execSync(
      `gh issue create --repo ${REPO} --title ${JSON.stringify(title)} --label "${labels}" --body-file ${tmpFile}`,
      { encoding: 'utf-8' }
    );
    const issueUrl = output.trim();
    console.log(`   ✅ GitHub Issue created: ${issueUrl}`);
  } catch (err) {
    // Non-fatal — the Jules session is already running
    console.warn(`   ⚠️ GitHub Issue creation failed (non-fatal): ${err.message}`);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }

  console.log(`\n🎯 Jules is now working on ${issueId}.`);
  console.log(`   When Jules finishes, the Reviewer workflow will handle the PR.\n`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
