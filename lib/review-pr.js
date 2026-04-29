/**
 * review-pr.js — The Reviewer (PRaC Kit)
 *
 * Automated PR reviewer. Reviews Jules' PRs against Linear issue spec
 * and BLUEPRINT.md Gherkin. Merges or sends feedback via Jules API.
 *
 * Usage:
 *   node scripts/review-pr.js <ISSUE_ID>
 *   node scripts/review-pr.js --linear-id <ID> --pr-number <N> --session-id <S>
 *
 * Options: --auto-poll, --dry-run
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const shared = require('./shared');
shared.loadEnv();

const LLM_MAX_RETRIES = 3;

// ── Gemini Function Declaration ──────────────────────────────────────────────

const SUBMIT_REVIEW_DECLARATION = {
  name: 'submit_review',
  description: 'Submit the final review verdict. Call exactly once.',
  parameters: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        description: 'APPROVE or REQUEST_CHANGES.',
        enum: ['APPROVE', 'REQUEST_CHANGES'],
      },
      reason: {
        type: 'string',
        description: 'One sentence (APPROVE) or one paragraph of actionable feedback (REQUEST_CHANGES).',
      },
    },
    required: ['decision', 'reason'],
  },
};

// ── JSON Extraction Helpers ──────────────────────────────────────────────────

function sanitizeJSONText(text) {
  if (!text) return text;
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

function bestEffortExtract(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(sanitizeJSONText(text));
    if (parsed.decision) return parsed;
  } catch (_) { /* regex fallback */ }
  const dm = text.match(/"decision"\s*:\s*"(APPROVE|REQUEST_CHANGES)"/i);
  if (dm) {
    const rm = text.match(/"reason"\s*:\s*"([^"]+)"/i);
    return { decision: dm[1].toUpperCase(), reason: rm ? rm[1] : 'Review completed.' };
  }
  return null;
}

// ── LLM Callers ──────────────────────────────────────────────────────────────

async function callGeminiFC(prompt, geminiKey, geminiModel, diffLen) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));

    let p = prompt;
    if (attempt > 0 && diffLen > 5000) {
      const t = Math.max(3000, Math.floor(diffLen / (attempt + 1)));
      p = prompt.replace(/```diff\n[\s\S]*?```/, m => {
        const lines = m.split('\n');
        return lines.slice(0, Math.ceil(t / 80)).join('\n') + '\n... [TRUNCATED] ...\n```';
      });
    }

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: p }] }],
          tools: [{ functionDeclarations: [SUBMIT_REVIEW_DECLARATION] }],
          toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit_review'] } },
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
      });
      const json = await res.json();
      if (json.error) { if (attempt < LLM_MAX_RETRIES - 1) continue; return { decision: 'ESCALATE', reason: json.error.message }; }

      const parts = json.candidates?.[0]?.content?.parts || [];
      const fc = parts.find(p => p.functionCall);
      if (fc?.functionCall?.args?.decision) return fc.functionCall.args;

      const tp = parts.find(p => p.text);
      if (tp) { const e = bestEffortExtract(tp.text); if (e) return e; }
      if (attempt < LLM_MAX_RETRIES - 1) continue;
    } catch (err) {
      if (attempt < LLM_MAX_RETRIES - 1) continue;
      process.exit(1);
    }
  }
  return { decision: 'ESCALATE', reason: `LLM failed after ${LLM_MAX_RETRIES} attempts.` };
}

async function callLMStudio(prompt) {
  const url = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    try {
      const res = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local-model',
          messages: [{ role: 'user', content: prompt + '\n\nRespond JSON: {"decision":"APPROVE"|"REQUEST_CHANGES","reason":"..."}' }],
          temperature: 0.1, max_tokens: 2048,
        }),
      });
      const text = (await res.json()).choices?.[0]?.message?.content || '';
      try { const p = JSON.parse(sanitizeJSONText(text)); if (p.decision) return p; } catch (_) {}
      const e = bestEffortExtract(text); if (e) return e;
    } catch (_) { if (attempt < LLM_MAX_RETRIES - 1) continue; process.exit(1); }
  }
  return { decision: 'ESCALATE', reason: 'LM Studio failed.' };
}

async function callReviewLLM(prompt, diffLen) {
  const key = process.env.GEMINI_API_KEY;
  return key ? callGeminiFC(prompt, key, shared.getReviewerModel(), diffLen) : callLMStudio(prompt);
}

// ── PR Helpers ───────────────────────────────────────────────────────────────

function getPrDiff(prNumber) {
  try { return execSync(`gh pr diff ${prNumber} --repo ${shared.getRepo()}`, { encoding: 'utf-8', maxBuffer: 10485760 }); }
  catch (_) { return null; }
}

function findPrNumber(sessionId) {
  const REPO = shared.getRepo();
  try {
    const prs = JSON.parse(execSync(`gh pr list --repo ${REPO} --state open --json number,body,headRefName`, { encoding: 'utf-8' }));
    const m = prs.find(pr => pr.body?.includes(sessionId) || pr.headRefName?.includes(sessionId));
    if (m) return m.number;
    const merged = JSON.parse(execSync(`gh pr list --repo ${REPO} --state merged --json number,body,headRefName -L 5`, { encoding: 'utf-8' }));
    const mm = merged.find(pr => pr.body?.includes(sessionId) || pr.headRefName?.includes(sessionId));
    if (mm) return mm.number;
  } catch (_) {}
  return null;
}

// ── Blueprint Loading ────────────────────────────────────────────────────────

function loadBlueprints() {
  const config = shared.loadConfig();
  const epicsDir = path.join(shared.getRepoRoot(), config.epicsDir || 'epics');
  if (!fs.existsSync(epicsDir)) return '_No epics directory._';
  const bps = [];
  for (const d of fs.readdirSync(epicsDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const bp = path.join(epicsDir, d.name, 'blueprint', 'BLUEPRINT.md');
    if (fs.existsSync(bp)) bps.push(fs.readFileSync(bp, 'utf-8'));
  }
  return bps.length ? bps.join('\n\n---\n\n') : '_BLUEPRINT.md not found._';
}

// ── Prompt Builder ───────────────────────────────────────────────────────────

function buildPrompt(issue, diff, gherkin, attempt, prevComments) {
  const MAX = shared.getMaxRevisions();
  const constraints = shared.getBlueprintInstructions().map(i => `- ${i}`).join('\n');
  const prev = attempt > 1 && prevComments.length ? `\n## Previous Feedback\n${prevComments[prevComments.length - 1]}\n` : '';
  const d = diff.length > 15000 ? diff.substring(0, 15000) + '\n... [TRUNCATED] ...' : diff;

  return `# PR Review: ${issue.identifier} — ${issue.title}

## Role
Expert code reviewer. Only flag genuine spec violations.

## Specification
${issue.description || '_None._'}

## Acceptance Criteria (BLUEPRINT.md)
${gherkin}

## Constraints
${constraints}
- Tests must exist (TDA compliance).

## PR Diff
\`\`\`diff
${d}
\`\`\`
${prev}
## Attempt ${attempt} of ${MAX}

Call \`submit_review\` exactly once.
`;
}

// ── CLI Flag Helpers ─────────────────────────────────────────────────────────

function getFlag(args, flag) {
  const i = args.indexOf(flag);
  return (i !== -1 && i + 1 < args.length) ? args[i + 1] : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const autoPoll = args.includes('--auto-poll');
  const dryRun = args.includes('--dry-run');
  const REPO = shared.getRepo();
  const MAX = shared.getMaxRevisions();

  const flagPR = getFlag(args, '--pr-number');
  const flagSession = getFlag(args, '--session-id');
  const flagLinear = getFlag(args, '--linear-id');
  const positional = args.find(a => !a.startsWith('--') && args.indexOf(a) > 0 ? !args[args.indexOf(a) - 1].startsWith('--') : true);
  const issueId = flagLinear || positional;
  const ciMode = !!(flagPR && flagSession);

  if (!issueId) { console.error('Usage: node scripts/review-pr.js <ISSUE_ID>'); process.exit(1); }

  console.log(`\n📋 Reviewing PR for ${issueId}... (${ciMode ? 'CI' : 'local'} mode)`);

  let ts;
  if (ciMode) {
    ts = shared.getTaskState(issueId) || {
      linearId: issueId, sessionId: flagSession, prNumber: parseInt(flagPR),
      attempts: 0, maxAttempts: MAX, status: 'triggered', previousComments: [], createdAt: new Date().toISOString(),
    };
    ts.sessionId = flagSession;
    ts.prNumber = parseInt(flagPR);
    shared.setTaskState(issueId, ts);
  } else {
    ts = shared.getTaskState(issueId);
    if (!ts) { console.error(`No state for ${issueId}. Run trigger-jules.js first.`); process.exit(1); }
  }

  if (autoPoll) {
    console.log('   Polling for session completion...');
    while (true) {
      const sess = await shared.julesGetSession(ts.sessionId);
      if (sess.state === 'COMPLETED') {
        const prOut = sess.outputs?.find(o => o.pullRequest);
        if (prOut) { const m = prOut.pullRequest.url.match(/\/pull\/(\d+)/); if (m) ts.prNumber = parseInt(m[1]); }
        break;
      }
      if (sess.state === 'FAILED' || sess.state === 'AWAITING_USER_FEEDBACK') { process.exit(1); }
      await new Promise(r => setTimeout(r, shared.getPollIntervalMs()));
    }
    shared.setTaskState(issueId, ts);
  }

  let prNumber = ts.prNumber || findPrNumber(ts.sessionId);
  if (!prNumber) { console.error('   ❌ No PR found.'); process.exit(1); }
  ts.prNumber = prNumber;

  const attempt = (ts.attempts || 0) + 1;
  if (attempt > MAX) {
    execSync(`gh pr comment ${prNumber} --repo ${REPO} --body "🚨 Max revisions exceeded."`, { encoding: 'utf-8', stdio: 'pipe' }).catch(() => {});
    ts.status = 'escalated'; shared.setTaskState(issueId, ts); process.exit(0);
  }

  console.log(`\n🔍 Attempt ${attempt}/${MAX} for PR #${prNumber}`);
  const issue = await shared.getLinearIssue(issueId);
  const diff = getPrDiff(prNumber);
  if (!diff) { console.error('No diff.'); process.exit(1); }

  const blueprint = loadBlueprints();
  const prompt = buildPrompt(issue, diff, blueprint, attempt, ts.previousComments || []);
  const result = await callReviewLLM(prompt, diff.length);
  const parsed = (typeof result === 'object' && result.decision)
    ? { decision: result.decision.toUpperCase(), reason: result.reason || '' }
    : { decision: 'ESCALATE', reason: 'Unexpected response' };

  console.log(`\n📊 Result: ${parsed.decision}`);
  if (dryRun) { console.log('[DRY RUN]', JSON.stringify(parsed, null, 2)); process.exit(0); }

  if (parsed.decision === 'APPROVE') {
    execSync(`gh pr merge ${prNumber} --repo ${REPO} --merge`, { encoding: 'utf-8' });
    console.log('   ✅ Merged.');
    ts.status = 'merged'; ts.attempts = attempt; shared.setTaskState(issueId, ts);

    if (shared.loadConfig().cascadeEnabled !== false) {
      const next = await shared.getNextPriorityIssue();
      if (next) {
        console.log(`   🔗 Next: ${next}`);
        execSync(`node ${path.resolve(__dirname, 'trigger-jules.js')} ${next}`, { stdio: 'inherit' });
      }
    }
  } else if (parsed.decision === 'REQUEST_CHANGES') {
    await shared.julesSendMessage(ts.sessionId, parsed.reason);
    console.log('   💬 Feedback sent to Jules.');
    ts.status = 'revision_requested'; ts.attempts = attempt;
    ts.previousComments = [...(ts.previousComments || []), parsed.reason];
    shared.setTaskState(issueId, ts);
  } else {
    execSync(`gh pr comment ${prNumber} --repo ${REPO} --body "🚨 Escalated: ${parsed.reason}"`, { encoding: 'utf-8', stdio: 'pipe' }).catch(() => {});
    ts.status = 'escalated'; ts.attempts = attempt; shared.setTaskState(issueId, ts);
  }
}

main().catch(err => { console.error('Unexpected error:', err); process.exit(1); });
