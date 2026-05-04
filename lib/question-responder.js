/**
 * question-responder.js — Jules Question Auto-Responder (PRaC Kit)
 *
 * Polls for Jules sessions in AWAITING_USER_FEEDBACK state, extracts
 * the blocking question, builds repo context, and uses an LLM to
 * either auto-respond or escalate to a human.
 *
 * Usage:
 *   node scripts/question-responder.js
 *   node scripts/question-responder.js --dry-run
 *   node scripts/question-responder.js --session-id <ID>
 *
 * Requirements:
 *   - JULES_API_KEY set in .env or environment
 *   - GEMINI_API_KEY set in .env or environment
 *   - `gh` CLI authenticated (for escalation issues)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const shared = require('./shared');
shared.loadEnv();

const LLM_MAX_RETRIES = 3;

// ── Config Accessors ─────────────────────────────────────────────────────────

function getResponderConfig() {
  const config = shared.loadConfig();
  return config.questionResponder || { enabled: false };
}

function getResponderModel() {
  const rc = getResponderConfig();
  return process.env.RESPONDER_MODEL || rc.responderModel || shared.getReviewerModel();
}

function getConfidenceThreshold() {
  return getResponderConfig().confidenceThreshold || 'HIGH';
}

function getMaxAutoResponses() {
  return getResponderConfig().maxAutoResponses || 5;
}

function getEscalationLabel() {
  return getResponderConfig().escalationLabel || 'jules-blocked';
}

function getContextFiles() {
  return getResponderConfig().contextFiles || [];
}

// ── Gemini Function Declaration ──────────────────────────────────────────────

const SUBMIT_ANSWER_DECLARATION = {
  name: 'submit_answer',
  description: 'Submit your answer to Jules\' blocking question. Call exactly once.',
  parameters: {
    type: 'object',
    properties: {
      confidence: {
        type: 'string',
        description: 'Your confidence level in the answer.',
        enum: ['HIGH', 'MEDIUM', 'LOW'],
      },
      action: {
        type: 'string',
        description: 'RESPOND to auto-reply, ESCALATE for human review.',
        enum: ['RESPOND', 'ESCALATE'],
      },
      answer: {
        type: 'string',
        description: 'The response to send to Jules. Required for RESPOND, optional for ESCALATE.',
      },
      reasoning: {
        type: 'string',
        description: 'Your internal reasoning. This is logged but NOT sent to Jules.',
      },
    },
    required: ['confidence', 'action', 'answer', 'reasoning'],
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
    if (parsed.action) return parsed;
  } catch (_) { /* regex fallback */ }
  const am = text.match(/"action"\s*:\s*"(RESPOND|ESCALATE)"/i);
  if (am) {
    const cm = text.match(/"confidence"\s*:\s*"(HIGH|MEDIUM|LOW)"/i);
    const anm = text.match(/"answer"\s*:\s*"([^"]+)"/i);
    const rm = text.match(/"reasoning"\s*:\s*"([^"]+)"/i);
    return {
      action: am[1].toUpperCase(),
      confidence: cm ? cm[1].toUpperCase() : 'LOW',
      answer: anm ? anm[1] : '',
      reasoning: rm ? rm[1] : '',
    };
  }
  return null;
}

// ── Context Builder ──────────────────────────────────────────────────────────

/**
 * Builds repository context for the LLM. Loads AGENTS.md, relevant
 * story/blueprint, and source files referenced in the story.
 *
 * @param {string} linearId - The Linear issue identifier (e.g. "DG-194")
 * @returns {string} - Concatenated context string
 */
function buildRepoContext(linearId) {
  const repoRoot = shared.getRepoRoot();
  const config = shared.loadConfig();
  const sections = [];

  // ── AGENTS.md ──
  const agentsFile = path.join(repoRoot, config.agentsFile || 'AGENTS.md');
  if (fs.existsSync(agentsFile)) {
    sections.push(`## AGENTS.md\n\n${fs.readFileSync(agentsFile, 'utf-8')}`);
  }

  // ── Find matching story by scanning epics ──
  const epicsDir = path.join(repoRoot, config.epicsDir || 'epics');
  let matchedStory = null;
  let matchedBlueprint = null;
  let servicesAffected = [];

  if (fs.existsSync(epicsDir)) {
    const epicDirs = fs.readdirSync(epicsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const epicDir of epicDirs) {
      // Check stories
      const storiesDir = path.join(epicsDir, epicDir.name, 'stories');
      if (fs.existsSync(storiesDir)) {
        const storyFiles = fs.readdirSync(storiesDir).filter(f => f.endsWith('.md'));
        for (const sf of storyFiles) {
          const storyPath = path.join(storiesDir, sf);
          const content = fs.readFileSync(storyPath, 'utf-8');
          // Stories don't contain the Linear ID directly, but the GitHub
          // issue body (from trigger-jules.js) references the Linear issue.
          // We'll match on story slug from the reviewer state instead.
          if (!matchedStory) {
            matchedStory = { path: storyPath, content };
            // Extract services_affected from frontmatter
            const saMatch = content.match(/services_affected:\n((?:\s+-\s+.+\n?)+)/);
            if (saMatch) {
              servicesAffected = saMatch[1]
                .split('\n')
                .map(l => l.replace(/^\s*-\s*/, '').trim())
                .filter(Boolean);
            }
          }
        }
      }

      // Check blueprint
      const bpPath = path.join(epicsDir, epicDir.name, 'blueprint', 'BLUEPRINT.md');
      if (fs.existsSync(bpPath) && !matchedBlueprint) {
        matchedBlueprint = { path: bpPath, content: fs.readFileSync(bpPath, 'utf-8') };
      }
    }
  }

  // ── Try to find story from reviewer state ──
  const taskState = shared.getTaskState(linearId);
  if (taskState) {
    // Try to find the specific story based on the task state
    const storySlug = linearId.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (fs.existsSync(epicsDir)) {
      const epicDirs = fs.readdirSync(epicsDir, { withFileTypes: true })
        .filter(d => d.isDirectory());
      for (const epicDir of epicDirs) {
        const storiesDir = path.join(epicsDir, epicDir.name, 'stories');
        if (fs.existsSync(storiesDir)) {
          const storyFiles = fs.readdirSync(storiesDir).filter(f => f.endsWith('.md'));
          for (const sf of storyFiles) {
            const storyPath = path.join(storiesDir, sf);
            const content = fs.readFileSync(storyPath, 'utf-8');
            // Match on story ID in frontmatter
            if (content.includes(`id: ${sf.replace('.md', '')}`)) {
              matchedStory = { path: storyPath, content };
              const saMatch = content.match(/services_affected:\n((?:\s+-\s+.+\n?)+)/);
              if (saMatch) {
                servicesAffected = saMatch[1]
                  .split('\n')
                  .map(l => l.replace(/^\s*-\s*/, '').trim())
                  .filter(Boolean);
              }
              break;
            }
          }
          if (matchedStory) break;
        }
      }
    }
  }

  if (matchedStory) {
    sections.push(`## Relevant Story (${path.basename(matchedStory.path)})\n\n${matchedStory.content}`);
  }

  if (matchedBlueprint) {
    sections.push(`## Blueprint (${path.basename(matchedBlueprint.path)})\n\n${matchedBlueprint.content}`);
  }

  // ── Load affected source files ──
  for (const filePath of servicesAffected) {
    const absPath = path.join(repoRoot, filePath);
    if (fs.existsSync(absPath)) {
      const content = fs.readFileSync(absPath, 'utf-8');
      // Truncate very large files
      const truncated = content.length > 5000
        ? content.substring(0, 5000) + '\n... [TRUNCATED] ...'
        : content;
      sections.push(`## Source: ${filePath}\n\n\`\`\`\n${truncated}\n\`\`\``);
    }
  }

  // ── App entry point (to answer "where is X rendered?" questions) ──
  const commonEntryPoints = [
    'client/src/App.jsx',
    'client/src/App.js',
    'src/App.jsx',
    'src/App.js',
    'app/page.jsx',
    'app/page.js',
  ];
  for (const ep of commonEntryPoints) {
    const absPath = path.join(repoRoot, ep);
    if (fs.existsSync(absPath) && !servicesAffected.includes(ep)) {
      sections.push(`## App Entry: ${ep}\n\n\`\`\`\n${fs.readFileSync(absPath, 'utf-8')}\n\`\`\``);
      break;
    }
  }

  // ── Additional context files from config ──
  for (const cf of getContextFiles()) {
    const absPath = path.join(repoRoot, cf);
    if (fs.existsSync(absPath)) {
      const content = fs.readFileSync(absPath, 'utf-8');
      const truncated = content.length > 3000
        ? content.substring(0, 3000) + '\n... [TRUNCATED] ...'
        : content;
      sections.push(`## Context: ${cf}\n\n${truncated}`);
    }
  }

  return sections.join('\n\n---\n\n');
}

// ── Prompt Builder ───────────────────────────────────────────────────────────

function buildPrompt(question, context, linearId) {
  return `# PRaC Question Responder

You are the automated question responder for the PRaC autonomous development system.
Jules (an AI coding agent) is blocked on a question while implementing Linear issue ${linearId}.
Your job is to determine if the question can be **confidently answered** using ONLY the
repository context provided below.

## Repository Context

${context}

## Jules' Blocking Question

${question}

## Rules

1. **HIGH confidence** — The answer is clearly and unambiguously derivable from the codebase
   context above. No speculation required. Examples: "Is component X rendered in App.jsx?",
   "What file contains the route definitions?", "Should I update file Y?"

2. **MEDIUM confidence** — The answer is likely correct but involves some inference.
   Examples: "Is this the right design pattern to use?", "Should I add this dependency?"

3. **LOW confidence** — The question requires human judgment, product decisions, access to
   external services, or information not present in the repo. Examples: "What should the
   UX look like?", "Which third-party service should I integrate?", "Is this feature still needed?"

4. **RESPOND** only when confidence is HIGH. Otherwise, set action to ESCALATE.

5. **Never** instruct Jules to:
   - Skip writing or running tests
   - Modify files outside the story's services_affected scope
   - Ignore BLUEPRINT.md Gherkin acceptance criteria
   - Hardcode API keys, secrets, or environment-specific values

6. **Keep your answer concise and actionable.** Jules needs clear instructions, not essays.

Call \`submit_answer\` exactly once.
`;
}

// ── LLM Caller ───────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.error('ERROR: GEMINI_API_KEY not set.');
    process.exit(1);
  }

  const model = getResponderModel();
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ functionDeclarations: [SUBMIT_ANSWER_DECLARATION] }],
          toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit_answer'] } },
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
      });
      const json = await res.json();

      if (json.error) {
        console.error(`   ⚠️ Gemini error (attempt ${attempt + 1}):`, json.error.message);
        if (attempt < LLM_MAX_RETRIES - 1) continue;
        return { action: 'ESCALATE', confidence: 'LOW', answer: '', reasoning: `LLM error: ${json.error.message}` };
      }

      const parts = json.candidates?.[0]?.content?.parts || [];
      const fc = parts.find(p => p.functionCall);
      if (fc?.functionCall?.args?.action) return fc.functionCall.args;

      const tp = parts.find(p => p.text);
      if (tp) {
        const e = bestEffortExtract(tp.text);
        if (e) return e;
      }
      if (attempt < LLM_MAX_RETRIES - 1) continue;
    } catch (err) {
      console.error(`   ⚠️ Fetch error (attempt ${attempt + 1}):`, err.message);
      if (attempt < LLM_MAX_RETRIES - 1) continue;
    }
  }

  return { action: 'ESCALATE', confidence: 'LOW', answer: '', reasoning: `LLM failed after ${LLM_MAX_RETRIES} attempts.` };
}

// ── Session Processing ───────────────────────────────────────────────────────

/**
 * Extract the question text from a Jules session's activities.
 * @param {string} sessionId
 * @returns {Promise<string|null>} The question text, or null.
 */
async function extractQuestion(sessionId) {
  try {
    let allActivities = [];
    let pageToken = '';
    do {
      const data = await shared.julesListActivities(sessionId, 100, pageToken);
      if (data.activities) {
        allActivities = allActivities.concat(data.activities);
      }
      pageToken = data.nextPageToken;
      // Safety break to prevent infinite loops on giant sessions
      if (allActivities.length > 1000) break;
    } while (pageToken);

    // Jules returns activities oldest-first. Reverse to find the newest question.
    allActivities.reverse();

    for (const activity of allActivities) {
      const text = activity.textContent
        || activity.message
        || activity.content
        || (activity.agentMessage && activity.agentMessage.content)
        || (activity.agentMessaged && activity.agentMessaged.agentMessage)
        || '';

      if (text && text.length > 20) {
        return text;
      }
    }

    return null;
  } catch (err) {
    console.error(`   ⚠️ Failed to extract question from session ${sessionId}:`, err.message);
    return null;
  }
}

/**
 * Find the Linear ID for a session by checking reviewer state.
 * @param {string} sessionId
 * @returns {string|null} The Linear ID, or null.
 */
function findLinearIdForSession(sessionId) {
  const state = shared.loadState();
  for (const [linearId, taskState] of Object.entries(state)) {
    if (taskState.sessionId === sessionId) return linearId;
  }
  return null;
}

/**
 * Check if we've exceeded the daily auto-response limit.
 * @returns {boolean}
 */
function isDailyLimitReached() {
  const max = getMaxAutoResponses();
  const state = shared.loadState();
  const today = new Date().toISOString().split('T')[0];

  let count = 0;
  for (const taskState of Object.values(state)) {
    const qr = taskState.questionResponder;
    if (!qr || !qr.history) continue;
    for (const entry of qr.history) {
      if (entry.action === 'RESPOND' && entry.timestamp && entry.timestamp.startsWith(today)) {
        count++;
      }
    }
  }

  return count >= max;
}

// ── Escalation ───────────────────────────────────────────────────────────────

function createEscalationIssue(linearId, sessionId, question, draftAnswer) {
  const REPO = shared.getRepo();
  const label = getEscalationLabel();
  const title = `🤖 Jules blocked on ${linearId} — needs human input`;

  const body = [
    `## Jules is Blocked`,
    ``,
    `Jules (session \`${sessionId}\`) asked a question while working on **${linearId}** and the auto-responder could not answer with sufficient confidence.`,
    ``,
    `### Jules' Question`,
    ``,
    '```',
    question,
    '```',
    ``,
    draftAnswer ? `### Draft Answer (needs human review)\n\n${draftAnswer}\n` : '',
    `### Action Required`,
    ``,
    `1. Review the question above`,
    `2. Reply to Jules at: https://jules.google.com/session/${sessionId}`,
    `3. Close this issue when resolved`,
  ].filter(Boolean).join('\n');

  try {
    const output = execSync(
      `gh issue create --repo ${REPO} --title ${JSON.stringify(title)} --label "${label}" --body ${JSON.stringify(body)}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim();
  } catch (err) {
    console.error(`   ⚠️ Failed to create escalation issue: ${err.message}`);
    return null;
  }
}

// ── State Tracking ───────────────────────────────────────────────────────────

function recordResponse(linearId, question, result) {
  const state = shared.loadState();
  const ts = state[linearId] || {};

  if (!ts.questionResponder) {
    ts.questionResponder = { questionsAnswered: 0, history: [] };
  }

  const entry = {
    question: question.substring(0, 500), // truncate for storage
    action: result.action,
    confidence: result.confidence,
    answer: result.answer ? result.answer.substring(0, 1000) : '',
    reasoning: result.reasoning ? result.reasoning.substring(0, 500) : '',
    timestamp: new Date().toISOString(),
  };

  ts.questionResponder.history.push(entry);
  if (result.action === 'RESPOND') {
    ts.questionResponder.questionsAnswered++;
  }
  ts.questionResponder.lastQuestionAt = entry.timestamp;
  ts.questionResponder.lastAction = result.action;

  state[linearId] = ts;
  shared.saveState(state);
}

// ── CLI Helpers ──────────────────────────────────────────────────────────────

function getFlag(args, flag) {
  const i = args.indexOf(flag);
  return (i !== -1 && i + 1 < args.length) ? args[i + 1] : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetSession = getFlag(args, '--session-id');

  const rc = getResponderConfig();
  if (!rc.enabled && !targetSession && !dryRun) {
    console.log('ℹ️  Question Responder is disabled. Set questionResponder.enabled = true in prac.config.js');
    process.exit(0);
  }

  console.log(`\n🤖 PRaC Question Responder${dryRun ? ' [DRY RUN]' : ''}`);
  console.log(`   Confidence threshold: ${getConfidenceThreshold()}`);
  console.log(`   Max daily auto-responses: ${getMaxAutoResponses()}`);

  // ── Step 1: Find blocked sessions ──────────────────────────────────────
  let blockedSessions = [];

  if (targetSession) {
    // Target a specific session
    const session = await shared.julesGetSession(targetSession);
    if (session.state === 'AWAITING_USER_FEEDBACK') {
      blockedSessions.push({ id: targetSession, state: session.state });
    } else {
      console.log(`   Session ${targetSession} is in state: ${session.state} (not blocked)`);
      process.exit(0);
    }
  } else {
    // Poll all sessions
    console.log('\n🔍 Polling for blocked Jules sessions...');
    const data = await shared.julesListSessions(100);
    const allSessions = data.sessions || [];

    // Filter to AWAITING_USER_FEEDBACK sessions that we own (exist in reviewer state)
    const state = shared.loadState();
    const ownedSessionIds = new Set(
      Object.values(state)
        .filter(ts => ts.sessionId)
        .map(ts => ts.sessionId)
    );

    blockedSessions = allSessions.filter(s =>
      s.state === 'AWAITING_USER_FEEDBACK' && ownedSessionIds.has(s.name?.split('/').pop() || s.id)
    );

    // Also check by matching session IDs directly
    if (blockedSessions.length === 0) {
      blockedSessions = allSessions.filter(s => {
        const sid = s.name?.split('/').pop() || s.id;
        return s.state === 'AWAITING_USER_FEEDBACK' && ownedSessionIds.has(sid);
      });
    }
  }

  if (blockedSessions.length === 0) {
    console.log('   ✅ No blocked sessions found. All clear!');
    process.exit(0);
  }

  console.log(`   Found ${blockedSessions.length} blocked session(s).`);

  // ── Step 2: Process each blocked session ───────────────────────────────
  for (const session of blockedSessions) {
    const sessionId = session.name?.split('/').pop() || session.id;
    const linearId = findLinearIdForSession(sessionId);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📋 Session: ${sessionId}`);
    console.log(`   Linear:  ${linearId || 'unknown'}`);

    if (!linearId) {
      console.log('   ⚠️ No Linear ID found for this session. Skipping.');
      continue;
    }

    // Check daily limit
    if (!dryRun && isDailyLimitReached()) {
      console.log('   🛑 Daily auto-response limit reached. Escalating remaining.');
      const question = await extractQuestion(sessionId);
      if (question) {
        createEscalationIssue(linearId, sessionId, question, null);
        console.log('   📋 Escalation issue created.');
      }
      continue;
    }

    // Extract question
    console.log('   📝 Extracting question...');
    const question = await extractQuestion(sessionId);
    if (!question) {
      console.log('   ⚠️ Could not extract question text. Skipping.');
      continue;
    }
    console.log(`   Question: "${question.substring(0, 120)}..."`);

    // Build context
    console.log('   📚 Building repository context...');
    const context = buildRepoContext(linearId);

    // Ask LLM
    console.log('   🧠 Consulting LLM...');
    const prompt = buildPrompt(question, context, linearId);
    const result = await callGemini(prompt);

    console.log(`\n   📊 Result:`);
    console.log(`      Confidence: ${result.confidence}`);
    console.log(`      Action:     ${result.action}`);
    console.log(`      Reasoning:  ${result.reasoning}`);

    // Apply confidence threshold
    const threshold = getConfidenceThreshold();
    const confidenceLevels = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const resultLevel = confidenceLevels[result.confidence] || 0;
    const thresholdLevel = confidenceLevels[threshold] || 3;

    let effectiveAction = result.action;
    if (resultLevel < thresholdLevel) {
      console.log(`   ⬇️ Confidence ${result.confidence} below threshold ${threshold}. Forcing ESCALATE.`);
      effectiveAction = 'ESCALATE';
    }

    if (dryRun) {
      console.log(`\n   [DRY RUN] Would ${effectiveAction}:`);
      if (effectiveAction === 'RESPOND') {
        console.log(`   Answer: "${result.answer}"`);
      } else {
        console.log(`   Would create escalation GitHub Issue.`);
        if (result.answer) console.log(`   Draft answer: "${result.answer}"`);
      }
      continue;
    }

    // Execute action
    if (effectiveAction === 'RESPOND') {
      console.log('   💬 Sending response to Jules...');
      await shared.julesSendMessage(sessionId, result.answer);
      console.log('   ✅ Response sent.');
      recordResponse(linearId, question, { ...result, action: 'RESPOND' });
    } else {
      console.log('   📋 Escalating to human...');
      const issueUrl = createEscalationIssue(
        linearId,
        sessionId,
        question,
        result.confidence !== 'LOW' ? result.answer : null
      );
      if (issueUrl) console.log(`   ✅ Escalation issue: ${issueUrl}`);
      recordResponse(linearId, question, { ...result, action: 'ESCALATE' });
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ✅ QUESTION RESPONDER COMPLETE`);
  console.log(`  Sessions processed: ${blockedSessions.length}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
