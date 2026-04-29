/**
 * on-blueprint-merge.js — Post-Merge Handler
 *
 * Runs after an Orchestrator Blueprint PR is merged into main.
 * Creates a Linear issue for the implementation task and queues it
 * for Jules via the smart priority cascade.
 *
 * Called by: .github/workflows/blueprint-merged.yml
 *
 * Usage:
 *   node scripts/on-blueprint-merge.js <pr-number>
 *
 * Requirements:
 *   - LINEAR_API_KEY, JULES_API_KEY set in environment
 *   - `gh` CLI authenticated
 */

const { execSync } = require('child_process');
const path = require('path');

const {
  loadEnv,
  loadConfig,
  getRepo,
  getRepoRoot,
  getLinearTeamId,
  getBlueprintInstructions,
  createLinearIssue,
} = require('./shared');

loadEnv();

// ── PR Metadata Extraction ───────────────────────────────────────────────────

function getPrMetadata(prNumber) {
  const REPO = getRepo();
  const raw = execSync(
    `gh pr view ${prNumber} --repo ${REPO} --json title,body,headRefName`,
    { encoding: 'utf-8' }
  );
  const pr = JSON.parse(raw);

  const isRemoval = pr.headRefName.startsWith('orchestrator/blueprint-removal-');

  const branchMatch = pr.headRefName.match(/orchestrator\/blueprint-(?:update|removal)-(.+)/);
  const storySlug = branchMatch ? branchMatch[1] : 'unknown';

  const classMatch = pr.body.match(/\*\*Classification:\*\*\s*`(\w+)`/);
  const classification = classMatch ? classMatch[1] : 'visual_and_behavioral';

  const summaryMatch = pr.body.match(/\*\*Summary:\*\*\s*(.+)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : pr.title;

  return {
    storySlug,
    classification,
    summary,
    isRemoval,
    prNumber,
    prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prNumber = process.argv[2];
  if (!prNumber) {
    console.error('Usage: node scripts/on-blueprint-merge.js <pr-number>');
    process.exit(1);
  }

  const config = loadConfig();
  const instructions = getBlueprintInstructions();

  console.log(`\n🔗 Post-Merge Handler: Processing merged Blueprint PR #${prNumber}`);

  // ── Step 1: Extract metadata from the merged PR ────────────────────────
  const meta = getPrMetadata(prNumber);
  console.log(`   Story:          ${meta.storySlug}`);
  console.log(`   Classification: ${meta.classification}`);
  console.log(`   Summary:        ${meta.summary}`);

  // ── Step 2: Create Linear Issue ────────────────────────────────────────
  console.log(`\n🎫 Creating Linear Issue (${meta.isRemoval ? 'removal' : 'implementation'})...`);

  let issueTitle, issueDescription;

  const instructionsList = instructions
    .map((inst, i) => `${i + 1}. ${inst}`)
    .join('\n');

  if (meta.isRemoval) {
    issueTitle = `Remove ${meta.storySlug}`;
    issueDescription = [
      `## Removal Task`,
      ``,
      `The Blueprint contract has been updated to **REMOVE** a feature.`,
      ``,
      `**Source PR:** ${meta.prUrl}`,
      `**Removed Story:** \`${meta.storySlug}\``,
      `**Classification:** \`${meta.classification}\``,
      `**Summary:** ${meta.summary}`,
      ``,
      `### Instructions`,
      instructionsList,
      `${instructions.length + 1}. **Delete** the component file(s) for this story.`,
      `${instructions.length + 2}. **Delete** the component's test file(s).`,
      `${instructions.length + 3}. **Remove** all imports and usages of the deleted component.`,
      `${instructions.length + 4}. Run tests to ensure nothing is broken.`,
    ].join('\n');
  } else {
    issueTitle = `Implement ${meta.storySlug}`;
    issueDescription = [
      `## Implementation Task`,
      ``,
      `The Blueprint contract has been updated and merged into \`main\`.`,
      ``,
      `**Source PR:** ${meta.prUrl}`,
      `**Classification:** \`${meta.classification}\``,
      `**Summary:** ${meta.summary}`,
      ``,
      `### Instructions`,
      instructionsList,
    ].join('\n');
  }

  const newIssue = await createLinearIssue(issueTitle, issueDescription);
  console.log(`   ✅ Linear Issue created: ${newIssue.identifier}`);

  // ── Step 3: Log queueing ───────────────────────────────────────────────
  if (meta.isRemoval) {
    console.log(`\n🗑️  Removal issue queued. It will be picked up by the smart priority cascade.`);
  } else if (meta.classification.includes('behavioral') || meta.classification.includes('visual_and_behavioral')) {
    console.log(`\n🚀 Issue queued for Jules. It will be picked up by the smart priority cascade.`);
  } else {
    console.log(`\n🎨 Visual-only story. Design step may be needed before implementation.`);
  }

  console.log(`   (Or run: node scripts/kickoff-sprint.js to start immediately)`);

  // ── Done ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ✅ POST-MERGE HANDLER COMPLETE`);
  console.log(`  Blueprint PR:  #${prNumber} (merged)`);
  console.log(`  Mode:          ${meta.isRemoval ? 'Removal' : 'Implementation'}`);
  console.log(`  Linear Issue:  ${newIssue.identifier}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
