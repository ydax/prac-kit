/**
 * create-linear-cascade.js — Create sequentially-blocked Linear issues.
 *
 * Reads a cascade.json file and creates issues with blocking dependencies.
 *
 * Usage:
 *   node scripts/create-linear-cascade.js cascade.json
 */

const fs = require('fs');
const path = require('path');

const {
  loadEnv,
  getLinearTeamKey,
  linearQuery,
} = require('./shared');

loadEnv();

async function getTeamId() {
  const teamKey = getLinearTeamKey();
  const data = await linearQuery(`
    query { teams { nodes { id key name } } }
  `);
  const team = data.teams.nodes.find(t => t.key === teamKey);
  if (!team) {
    console.error(`ERROR: Could not find team "${teamKey}".`);
    console.error('Available:', data.teams.nodes.map(t => `${t.key} (${t.name})`).join(', '));
    process.exit(1);
  }
  console.log(`Found team: ${team.name} (${team.key}) — ID: ${team.id}`);
  return team.id;
}

async function createIssue(teamId, title, description) {
  const data = await linearQuery(`
    mutation CreateIssue($teamId: String!, $title: String!, $description: String) {
      issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
        success
        issue { id identifier title }
      }
    }
  `, { teamId, title, description });
  if (!data.issueCreate.success) { console.error(`Failed: ${title}`); process.exit(1); }
  return data.issueCreate.issue;
}

async function addBlockedBy(issueId, blockedByIssueId) {
  await linearQuery(`
    mutation AddRelation($issueId: String!, $relatedIssueId: String!) {
      issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: blocks }) { success }
    }
  `, { issueId: blockedByIssueId, relatedIssueId: issueId });
}

async function main() {
  const cascadeFile = process.argv[2];
  if (!cascadeFile) { console.error('Usage: node scripts/create-linear-cascade.js <cascade.json>'); process.exit(1); }

  const filePath = path.resolve(cascadeFile);
  if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }

  const tasks = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`\n📋 Loaded ${tasks.length} tasks from ${cascadeFile}\n`);

  const teamId = await getTeamId();
  const created = [];

  for (let i = 0; i < tasks.length; i++) {
    console.log(`\n[${i + 1}/${tasks.length}] Creating: ${tasks[i].title}`);
    const issue = await createIssue(teamId, tasks[i].title, tasks[i].description);
    console.log(`  ✅ Created: ${issue.identifier} — ${issue.title}`);
    created.push(issue);
  }

  console.log('\n🔗 Setting blocked-by dependencies...\n');
  for (let i = 1; i < created.length; i++) {
    console.log(`  ${created[i].identifier} blocked by ${created[i - 1].identifier}`);
    await addBlockedBy(created[i].id, created[i - 1].id);
  }

  console.log(`\n🎉 Cascade created! First task: ${created[0].identifier}\n`);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
