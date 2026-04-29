/**
 * kickoff-sprint.js — Smart Priority Cascade Kickoff
 *
 * Queries Linear for the highest priority unstarted task and
 * triggers Jules for it. This is the manual "start the engine" command.
 *
 * Usage:
 *   node scripts/kickoff-sprint.js
 */

const { execSync } = require('child_process');
const path = require('path');
const { loadEnv, getNextPriorityIssue, getRepoRoot } = require('./shared');

loadEnv();

async function main() {
  console.log(`\n🚀 Smart Priority Cascade Kickoff`);
  console.log(`🔗 Checking Linear for the highest priority unstarted or backlog task...`);

  try {
    const nextId = await getNextPriorityIssue();
    if (nextId) {
      console.log(`   Found task: ${nextId}. Triggering Jules...`);
      const triggerScript = path.resolve(__dirname, 'trigger-jules.js');
      execSync(`node ${triggerScript} ${nextId}`, { stdio: 'inherit' });
    } else {
      console.log(`   📭 Queue is empty. No unstarted or backlog tasks found in Linear.`);
    }
  } catch (err) {
    console.error(`   ❌ Failed to kickoff sprint: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
