/**
 * orchestrate-story.js — The Orchestrator
 *
 * Detects new or modified STORY.md files, reads the parent EPIC.md and
 * current BLUEPRINT.md, calls Gemini to generate a Blueprint diff, and
 * opens a Pull Request with the updated Blueprint.
 *
 * Usage:
 *   node scripts/orchestrate-story.js <path-to-STORY.md>
 *   node scripts/orchestrate-story.js --remove <path-to-STORY.md>
 *
 * Modes:
 *   (default)   Add/modify — reads the story from disk, generates an updated Blueprint
 *   --remove    Removal — reads the deleted story from git HEAD~1, generates a Blueprint
 *               with the story's sections stripped out, creating a removal PR
 *
 * Requirements:
 *   - GEMINI_API_KEY set in environment or .env
 *   - `gh` CLI authenticated (for PR creation)
 *   - `git` CLI available
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  loadEnv,
  loadConfig,
  getRepo,
  getRepoRoot,
  getOrchestratorModel,
} = require('./shared');

loadEnv();

// ── Constants ────────────────────────────────────────────────────────────────

const LLM_MAX_RETRIES = 3;

// ── Gemini Function Calling ──────────────────────────────────────────────────

const GENERATE_BLUEPRINT_DECLARATION = {
  name: 'submit_blueprint_update',
  description: 'Submit the updated BLUEPRINT.md content and story classification. You MUST call this function exactly once.',
  parameters: {
    type: 'object',
    properties: {
      classification: {
        type: 'string',
        description: 'The track classification for this story.',
        enum: ['visual', 'behavioral', 'visual_and_behavioral'],
      },
      updated_blueprint: {
        type: 'string',
        description: 'The COMPLETE updated BLUEPRINT.md file content, with the new story\'s entities, state machines, Gherkin scenarios, and component specifications merged in. This must be the full file, not a diff.',
      },
      summary: {
        type: 'string',
        description: 'A one-sentence summary of what was added to the Blueprint.',
      },
    },
    required: ['classification', 'updated_blueprint', 'summary'],
  },
};

// ── File Discovery ───────────────────────────────────────────────────────────

/**
 * Given a STORY.md path like epics/my-epic/stories/08-foo/STORY.md,
 * resolve the parent EPIC.md and BLUEPRINT.md paths.
 */
function resolveRelatedFiles(storyPath) {
  const repoRoot = getRepoRoot();
  const absStory = path.resolve(repoRoot, storyPath);

  // Walk up from the story to find the epic root (contains EPIC.md)
  let dir = path.dirname(absStory); // stories/08-foo
  dir = path.dirname(dir);          // stories/
  const epicRoot = path.dirname(dir); // epics/my-epic/

  const epicPath = path.join(epicRoot, 'EPIC.md');
  const blueprintPath = path.join(epicRoot, 'blueprint', 'BLUEPRINT.md');

  return {
    storyPath: absStory,
    epicPath,
    blueprintPath,
    storyRelative: storyPath,
    blueprintRelative: path.relative(repoRoot, blueprintPath),
    epicRoot,
  };
}

function readFileOrFallback(filePath, fallback) {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return fallback;
}

// ── Orchestrator Prompts ─────────────────────────────────────────────────────

function buildOrchestratorPrompt(story, epic, blueprint) {
  return `# Orchestrator: Story → Blueprint Translation

## Your Role
You are the Orchestrator in a self-managing autonomous development system. Your job
is to read a new user Story, understand the parent Epic, and generate an updated
Blueprint that incorporates the new Story's requirements.

The Blueprint is the machine-enforceable contract. Jules (the coding agent) writes
tests from the Blueprint's Gherkin scenarios, then implements code to make them pass.

## Rules
1. Preserve ALL existing Blueprint content. You are ADDING to it, not replacing it.
2. Add new entities to the Entities table if the story introduces new components.
3. Add new state machines only if the story introduces stateful UI elements.
4. Add ALL Gherkin scenarios from the story's Acceptance Criteria into the correct
   section of the Blueprint. Do not paraphrase — copy them precisely.
5. Add or update the Component Specifications table.
6. If the story affects an existing component, update that component's spec row.
7. Update the "Last Updated" date to today.
8. Classify the story as 'visual', 'behavioral', or 'visual_and_behavioral'.
9. Return the COMPLETE updated BLUEPRINT.md — not a diff.

## Parent Epic
\`\`\`markdown
${epic}
\`\`\`

## Current Blueprint
\`\`\`markdown
${blueprint}
\`\`\`

## New Story to Incorporate
\`\`\`markdown
${story}
\`\`\`

## Instructions
Read the new Story carefully. Determine what new entities, state machines, Gherkin
scenarios, and component specifications must be added to the Blueprint. Then call
the \`submit_blueprint_update\` function with the complete updated Blueprint content.
`;
}

function buildRemovalPrompt(deletedStory, epic, blueprint, storySlug) {
  return `# Orchestrator: Story Removal → Blueprint Update

## Your Role
You are the Orchestrator in a self-managing autonomous development system. A user
Story has been DELETED from the repository. Your job is to generate an updated
Blueprint with all traces of that story REMOVED.

## Rules
1. Remove ALL entities, state machines, Gherkin scenarios, and component specifications
   that were introduced by the deleted story.
2. Do NOT remove anything that belongs to other stories. Be surgical.
3. If removing an entity leaves orphaned references in other sections, remove those too.
4. Preserve the overall Blueprint structure and formatting.
5. Update the "Last Updated" date to today.
6. Classify this as 'visual_and_behavioral' (removals always affect both tracks).
7. Return the COMPLETE updated BLUEPRINT.md — not a diff.

## Parent Epic
\`\`\`markdown
${epic}
\`\`\`

## Current Blueprint
\`\`\`markdown
${blueprint}
\`\`\`

## Story That Was DELETED (remove all traces of this)
Story slug: \`${storySlug}\`
\`\`\`markdown
${deletedStory}
\`\`\`

## Instructions
Carefully identify every entity, state machine, Gherkin scenario section, and
component specification row that was added by the deleted story above. Remove them
all. Then call the \`submit_blueprint_update\` function with the complete updated
Blueprint content (with the deleted story's sections stripped out).
`;
}

// ── Gemini API Call ──────────────────────────────────────────────────────────

async function callGemini(prompt) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.error('ERROR: GEMINI_API_KEY not set. Cannot run the Orchestrator.');
    process.exit(1);
  }

  const geminiModel = getOrchestratorModel();
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`   ⏳ Retry ${attempt + 1}/${LLM_MAX_RETRIES} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{
        functionDeclarations: [GENERATE_BLUEPRINT_DECLARATION],
      }],
      toolConfig: {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['submit_blueprint_update'],
        },
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 16384,
      },
    });

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const json = await res.json();

      if (json.error) {
        console.error(`   Gemini API error (attempt ${attempt + 1}):`, JSON.stringify(json.error, null, 2));
        if (attempt < LLM_MAX_RETRIES - 1) continue;
        console.error('   All retry attempts exhausted.');
        process.exit(1);
      }

      const candidate = json.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const functionCall = parts.find(p => p.functionCall);

      if (functionCall) {
        const args = functionCall.functionCall.args;
        if (args && args.updated_blueprint && args.classification) {
          console.log(`   ✅ Blueprint update generated (attempt ${attempt + 1}).`);
          return args;
        }
      }

      // Fallback: check for text response
      const textPart = parts.find(p => p.text);
      if (textPart) {
        console.warn(`   ⚠️ Model returned text instead of function call (attempt ${attempt + 1}).`);
        console.warn(`   Text preview: ${textPart.text.substring(0, 200)}...`);
      }

      if (attempt < LLM_MAX_RETRIES - 1) continue;

    } catch (err) {
      console.error(`   Network error (attempt ${attempt + 1}): ${err.message}`);
      if (attempt < LLM_MAX_RETRIES - 1) continue;
      process.exit(1);
    }
  }

  console.error('   ❌ All retries exhausted. Could not generate Blueprint update.');
  process.exit(1);
}

// ── Git Operations ───────────────────────────────────────────────────────────

function getStorySlug(storyPath) {
  const parts = storyPath.split(path.sep);
  const storiesIdx = parts.indexOf('stories');
  if (storiesIdx >= 0 && storiesIdx + 1 < parts.length) {
    return parts[storiesIdx + 1];
  }
  return 'unknown-story';
}

function readDeletedFileFromGit(relPath, commitRef = 'HEAD~1') {
  try {
    return execSync(`git show ${commitRef}:${relPath}`, { encoding: 'utf-8' });
  } catch (err) {
    console.warn(`   ⚠️ Could not read deleted file from git history (ref: ${commitRef}): ${err.message}`);
    return null;
  }
}

function checkDependencies(storySlug, epicRoot) {
  const storiesDir = path.join(epicRoot, 'stories');
  const dependents = [];

  if (!fs.existsSync(storiesDir)) return dependents;

  const dirs = fs.readdirSync(storiesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== storySlug);

  for (const dir of dirs) {
    const storyFile = path.join(storiesDir, dir.name, 'STORY.md');
    if (fs.existsSync(storyFile)) {
      const content = fs.readFileSync(storyFile, 'utf-8');
      if (content.includes(storySlug)) {
        dependents.push(`stories/${dir.name}/STORY.md`);
      }
    }
  }

  return dependents;
}

function autoMergePR(branchName) {
  const REPO = getRepo();
  console.log(`\n🔀 Auto-merging Blueprint PR...`);
  try {
    execSync(
      `gh pr merge ${branchName} --repo ${REPO} --merge --delete-branch`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    console.log(`   ✅ PR merged and branch deleted.`);
  } catch (err) {
    console.error(`   ⚠️ Auto-merge failed: ${err.message}`);
    console.error(`   The PR was created but needs manual merge.`);
  }
}

function createBranchAndPR(blueprintRelPath, storySlug, classification, summary, { isRemoval = false } = {}) {
  const REPO = getRepo();
  const config = loadConfig();
  const shouldAutoMerge = config.autoMergeBlueprints !== false;

  const branchPrefix = isRemoval ? 'orchestrator/blueprint-removal' : 'orchestrator/blueprint-update';
  const branchName = `${branchPrefix}-${storySlug}`;
  const today = new Date().toISOString().split('T')[0];

  console.log(`\n📝 Creating branch: ${branchName}`);

  try {
    execSync('git checkout main', { encoding: 'utf-8', stdio: 'pipe' });
    execSync('git pull origin main', { encoding: 'utf-8', stdio: 'pipe' });
  } catch (err) {
    console.warn(`   ⚠️ Could not pull main: ${err.message}`);
  }

  try {
    execSync(`git push origin --delete ${branchName}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (_) { /* branch doesn't exist remotely */ }

  try {
    execSync(`git branch -D ${branchName}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (_) { /* doesn't exist locally */ }

  execSync(`git checkout -b ${branchName}`, { encoding: 'utf-8' });
  execSync(`git add ${blueprintRelPath}`, { encoding: 'utf-8' });

  const commitVerb = isRemoval ? 'removal of' : 'update for';
  execSync(
    `git commit -m "docs(blueprint): ${commitVerb} ${storySlug}\n\nClassification: ${classification}\n${summary}\n\nGenerated by the Orchestrator (prac-kit)"`,
    { encoding: 'utf-8' }
  );
  execSync(`git push -u origin ${branchName}`, { encoding: 'utf-8' });

  console.log(`   ✅ Branch pushed.`);

  const trackLabel = classification === 'behavioral' ? 'behavioral' : 'visual';
  const labels = `${trackLabel},blueprint`;
  const tmpBodyFile = path.join(getRepoRoot(), '.orchestrator-pr-body.tmp.md');

  const prTitle = isRemoval
    ? `Blueprint Removal: ${storySlug}`
    : `Blueprint Update: ${storySlug}`;

  const prBody = isRemoval
    ? `## Orchestrator-Generated Blueprint Removal

**Removed Story:** \`${storySlug}\`
**Classification:** \`${classification}\`
**Summary:** ${summary}

### This is a REMOVAL PR
Merging this PR will update the Blueprint to remove all entities, state machines,
Gherkin scenarios, and component specifications that belonged to story \`${storySlug}\`.

---
*Generated by PRaC Orchestrator.*
*Date: ${today}*`
    : `## Orchestrator-Generated Blueprint Update

**Source Story:** \`${storySlug}\`
**Classification:** \`${classification}\`
**Summary:** ${summary}

### Action Items
- [ ] Review the Blueprint diff against the source Story
- [ ] Merge to finalize the machine contract
${classification !== 'behavioral' ? '- [ ] Stitch design generation (visual track)\n' : ''}- [ ] Jules TDA implementation

---
*Generated by PRaC Orchestrator.*
*Date: ${today}*`;

  console.log(`\n📬 Creating Pull Request...`);
  try {
    fs.writeFileSync(tmpBodyFile, prBody, 'utf-8');
    const output = execSync(
      `gh pr create --repo ${REPO} --title "${prTitle}" --body-file ${tmpBodyFile} --label "${labels}"`,
      { encoding: 'utf-8' }
    );
    const prUrl = output.trim();
    console.log(`   ✅ PR created: ${prUrl}`);

    if (shouldAutoMerge) {
      autoMergePR(branchName);
    }

    return prUrl;
  } catch (err) {
    console.error(`   ❌ PR creation failed: ${err.message}`);
    return null;
  } finally {
    if (fs.existsSync(tmpBodyFile)) fs.unlinkSync(tmpBodyFile);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isRemoval = args.includes('--remove');

  let baseCommit = null;
  const baseIdx = args.indexOf('--base-commit');
  if (baseIdx >= 0 && args[baseIdx + 1]) {
    baseCommit = args[baseIdx + 1];
  }

  const storyPath = args.find(a => !a.startsWith('--') && (baseIdx < 0 || a !== args[baseIdx + 1]));

  if (!storyPath) {
    console.error('Usage: node scripts/orchestrate-story.js [--remove] [--base-commit <sha>] <path-to-STORY.md>');
    process.exit(1);
  }

  const modeLabel = isRemoval ? '🗑️  REMOVAL' : '🎯 Addition';
  console.log(`\n${modeLabel}: Processing ${storyPath}`);

  // ── Step 1: Resolve related files ──────────────────────────────────────
  const files = resolveRelatedFiles(storyPath);
  const storySlug = getStorySlug(storyPath);

  let story;
  if (isRemoval) {
    const ref = baseCommit || 'HEAD~1';
    console.log(`   📂 Reading deleted story from ref: ${ref}`);
    story = readDeletedFileFromGit(storyPath, ref);
    if (!story) {
      console.error(`   ❌ Could not retrieve deleted story from git history: ${storyPath}`);
      process.exit(1);
    }
  } else {
    story = readFileOrFallback(files.storyPath, null);
    if (!story) {
      console.error(`   ❌ Story file not found: ${files.storyPath}`);
      process.exit(1);
    }
    console.log(`   📄 Story:     ${files.storyRelative}`);
  }

  const epic = readFileOrFallback(files.epicPath, '_EPIC.md not found._');
  const blueprint = readFileOrFallback(files.blueprintPath, '_No existing BLUEPRINT.md — create one from scratch._');

  console.log(`   📄 Epic:      ${files.epicPath}`);
  console.log(`   📄 Blueprint: ${files.blueprintRelative}`);

  // ── Step 1.5 (removal only): Check for dependent stories ──────────────
  if (isRemoval) {
    const dependents = checkDependencies(storySlug, files.epicRoot);
    if (dependents.length > 0) {
      console.warn(`\n   ⚠️  DEPENDENCY WARNING: The following stories reference "${storySlug}":`);
      dependents.forEach(d => console.warn(`       - ${d}`));
      console.warn(`   Proceeding with removal, but dependent stories may need updating.\n`);
    }
  }

  // ── Step 2: Call Gemini ────────────────────────────────────────────────
  console.log(`\n🤖 Calling Orchestrator LLM (${isRemoval ? 'removal' : 'addition'} mode)...`);
  const prompt = isRemoval
    ? buildRemovalPrompt(story, epic, blueprint, storySlug)
    : buildOrchestratorPrompt(story, epic, blueprint);
  const result = await callGemini(prompt);

  console.log(`   Classification: ${result.classification}`);
  console.log(`   Summary: ${result.summary}`);

  // ── Step 3: Write the updated Blueprint ────────────────────────────────
  console.log(`\n💾 Writing updated BLUEPRINT.md...`);
  fs.writeFileSync(files.blueprintPath, result.updated_blueprint, 'utf-8');
  console.log(`   ✅ Blueprint updated.`);

  // ── Step 4: Create branch and PR ───────────────────────────────────────
  const prUrl = createBranchAndPR(
    files.blueprintRelative,
    storySlug,
    result.classification,
    result.summary,
    { isRemoval }
  );

  // ── Step 5: Switch back to main ────────────────────────────────────────
  try {
    execSync('git checkout main', { encoding: 'utf-8', stdio: 'pipe' });
  } catch (_) { /* non-fatal */ }

  const verb = isRemoval ? 'REMOVAL' : 'ADDITION';
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ✅ ORCHESTRATOR ${verb} COMPLETE`);
  console.log(`  Story:          ${storyPath}`);
  console.log(`  Classification: ${result.classification}`);
  console.log(`  Blueprint PR:   ${prUrl || '(create manually from pushed branch)'}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
