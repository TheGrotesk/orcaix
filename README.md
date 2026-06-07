<div align="center">

<img src="docs/assets/logo.jpg" alt="orcaix" width="80" />

# orcaix

**Orcaix — run AI agent workflows defined in YAML**

[![Version](https://img.shields.io/badge/version-0.1.5-6366f1?style=flat-square)](https://github.com/TheGrotesk/orcaix/releases/tag/v0.1.5)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-GPL--v3-blue?style=flat-square)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-live-10b981?style=flat-square)](https://orcaix-docs.vercel.app)

[Documentation](https://orcaix-docs.vercel.app) · [Examples](#examples) · [Releases](https://github.com/TheGrotesk/orcaix/releases)

</div>

---

**orcaix** lets you define multi-step AI workflows as YAML files and run them from the CLI. Chain LLM calls across providers, shell commands, file operations, and HTTP requests — with human approval gates, conditional branching, and automatic resume from the last completed stage after any failure.

```yaml
name: PR Code Review
stages:
  - id: review
    type: llm
    provider: anthropic
    model: claude-sonnet-4-6
    files: [src/**/*.ts]
    prompt: "Review this PR diff for bugs and security issues:\n{{input}}"

  - id: save
    type: file
    action: write
    path: ./reviews/review-{{timestamp}}.md
    content: "{{stages.review.output}}"
```

```bash
orcaix run pr-review.yaml --prompt "$(git diff main...HEAD)"
```

---

## Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Stage Types](#stage-types)
- [Interpolation](#interpolation)
- [Templates](#templates)
- [Conditional Routing](#conditional-routing)
- [Loop Stage](#loop-stage)
- [Checkpoints](#checkpoints)
- [CLI Reference](#cli-reference)
- [Examples](#examples)
- [GitHub Actions](#github-actions)

---

## Install

```bash
npm install -g @thegrotesk/orcaix
```

Or build from source:

```bash
git clone https://github.com/TheGrotesk/orcaix.git
cd orcaix
npm install && npm run build
npm link          # makes `orcaix` available globally
```

Add your API keys — only the providers you use are required:

```bash
# .env  (or export directly)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

---

## Quick Start

```bash
# Scaffold a new workflow
orcaix init my-workflow

# Validate without running
orcaix validate my-workflow.yaml

# Dry run — prints all stages, no API calls
orcaix run my-workflow.yaml --prompt "hello" --dry-run

# Run for real
orcaix run my-workflow.yaml --prompt "your input here"
```

---

## Stage Types

### `llm` — Call an AI model

```yaml
- id: analyze
  type: llm
  provider: anthropic          # anthropic | openai | gemini
  model: claude-sonnet-4-6
  system: "You are an expert code reviewer."
  files:                       # glob patterns injected as context before the prompt
    - src/**/*.ts
    - package.json
  prompt: |
    Review this for security issues:
    {{input}}
  max_tokens: 2000
```

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | ✓ | `anthropic`, `openai`, or `gemini` |
| `model` | ✓ | Model ID — e.g. `claude-sonnet-4-6`, `gpt-4o`, `gemini-2.0-flash` |
| `prompt` | ✓ | User message. Supports interpolation. |
| `system` | — | System prompt. Supports interpolation. |
| `files` | — | Glob patterns. Files injected as `<file path="...">` blocks before the prompt. |
| `max_tokens` | — | Max tokens to generate. |
| `temperature` | — | Sampling temperature 0–2. Not supported by Claude 4 models. |

**File injection** warns at 100 KB total, throws at 500 KB.

---

### `shell` — Run a command

```yaml
- id: typecheck
  type: shell
  command: npx tsc --noEmit 2>&1 || true

# Hand off the terminal to an interactive process
- id: implement
  type: shell
  interactive: true           # stdio: inherit — workflow resumes on exit
  command: claude --model sonnet "$(cat /tmp/plan.txt)"
```

| Field | Required | Description |
|-------|----------|-------------|
| `command` | ✓ | Shell command. Supports interpolation. |
| `workdir` | — | Working directory. Defaults to process CWD. |
| `interactive` | — | If `true`, spawns with `stdio: inherit`. Use to hand off to Claude Code, Codex, etc. |

stdout becomes the stage output. stderr is forwarded but does not fail the stage.

---

### `file` — Read, write, or append

```yaml
- id: save_report
  type: file
  action: write
  path: ./reports/{{timestamp}}.md
  content: |
    # Report
    {{stages.analyze.output}}
```

| `action` | Behaviour |
|----------|-----------|
| `read` | Reads file → stage output |
| `write` | Writes `content` to `path`. Creates directories. |
| `append` | Appends `content` to `path`. |

---

### `http` — Make an HTTP request

```yaml
- id: notify
  type: http
  method: POST
  url: "{{env.SLACK_WEBHOOK_URL}}"
  headers:
    Content-Type: application/json
  body:
    text: "Review complete"
    blocks:
      - type: section
        text:
          type: mrkdwn
          text: "{{stages.review.output}}"
```

Objects in `body` are JSON-serialized automatically. All values support deep interpolation.

---

### `input` — Pause for human review

```yaml
- id: approve
  type: input
  message: |
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    PLAN
    {{input}}
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Type "yes" to proceed or give feedback:
  placeholder: "yes  /  skip step 3, add X..."
  next:
    - condition: "['yes','y','ok','lgtm'].includes(output.toLowerCase().trim())"
      stage: implement
    - stage: revise
```

Requires a TTY. Not for use in CI — use `--dry-run` or CI-specific workflow variants instead.

---

### `loop` — Iterate until done

```yaml
- id: fix_loop
  type: loop
  max_iterations: 6
  until: "!stages.run_tests.output.includes('FAIL')"
  stages:
    - id: fix
      type: llm
      provider: anthropic
      model: claude-sonnet-4-6
      files: [src/**/*.ts, tests/**/*.ts]
      prompt: "Fix these failures:\n{{stages.run_tests.output}}"
    - id: run_tests
      type: shell
      command: npm test 2>&1 || true
```

With human approval after each iteration:

```yaml
- id: dev_loop
  type: loop
  max_iterations: 5
  approve: true
  approve_message: |
    Iteration {{vars.loop_iteration}}
    Typecheck: {{stages.typecheck.output}}
    Tests:     {{stages.run_tests.output}}
  until: "false"    # driven by human — type "done" when satisfied
  stages:
    # ...
```

**Approval responses:**

| Input | Effect |
|-------|--------|
| `done`, `yes`, `ship`, `ok`, `lgtm` | Accept — exit loop |
| `stop`, `quit`, `abort`, `no` | Abort — exit immediately |
| anything else | Stored as `{{vars.loop_feedback}}` for the next iteration |

---

## Interpolation

Every string field supports `{{variable}}` placeholders resolved at runtime:

| Variable | Value |
|----------|-------|
| `{{input}}` | Output of the previous stage (or initial `--prompt` for the first stage) |
| `{{stages.id.output}}` | Output of any completed stage by ID — available for the entire run |
| `{{env.VAR}}` | Environment variable |
| `{{vars.KEY}}` | Value passed via `--var KEY=value` on the CLI |
| `{{templates.name}}` | Inline or imported template snippet |
| `{{timestamp}}` | Run start time — safe for filenames (`2024-01-15T10-32-11-000Z`) |
| `{{vars.loop_iteration}}` | Current loop iteration number (inside `loop` stages) |
| `{{vars.loop_feedback}}` | Feedback typed during approval prompt (inside `loop` stages) |

---

## Templates

Reusable prompt snippets — reference with `{{templates.name}}`.

**Inline:**

```yaml
templates:
  senior_engineer: |
    You are a senior software engineer.
    Write minimal, targeted, production-ready code.

stages:
  - id: implement
    type: llm
    system: "{{templates.senior_engineer}}"
    # ...
```

**Imported from separate files:**

```yaml
import:
  - ./templates/personas.yaml
  - ./templates/formats.yaml
```

```yaml
# templates/personas.yaml
templates:
  senior_engineer: You are a senior software engineer...
  sre: You are a Site Reliability Engineer...
```

Later imports override earlier ones on key conflict. Inline `templates:` always wins.

---

## Conditional Routing

Add a `next` array to any stage to route based on its output:

```yaml
- id: classify
  type: llm
  provider: anthropic
  model: claude-haiku-4-5-20251001
  system: "Reply with one word: critical, warning, or ok"
  prompt: "{{input}}"
  max_tokens: 10
  next:
    - condition: "output.includes('critical')"
      stage: escalate
    - condition: "output.includes('warning')"
      stage: investigate
    - stage: close          # no condition = default fallback
```

Conditions are JS expressions with `output` in scope. First match wins. If no condition matches and there's no default, execution continues linearly.

---

## Checkpoints

orcaix automatically saves a checkpoint after every completed stage. If the run fails or is interrupted, the next invocation detects it:

```
Checkpoint found — started 2024-01-15T10:32, last updated 2024-01-15T10:38
  Completed stages: analyze, approve_plan, create_plan

Resume from checkpoint? (yes / no)
```

```bash
orcaix run workflow.yaml --prompt "..." --resume   # resume without prompting
orcaix run workflow.yaml --prompt "..." --fresh    # ignore checkpoint, start over
```

Checkpoints are stored in `.orcaix-checkpoints/` (keyed by a hash of workflow path + prompt). They are deleted automatically on successful completion.

> **Always pass `--fresh` in CI.** Without it, orcaix will look for a checkpoint and prompt interactively, hanging the job.

---

## CLI Reference

### `orcaix run <workflow>`

```
Options:
  -p, --prompt <text>       Initial prompt
      --prompt-file <path>  Read prompt from file
      --var <KEY=value>     Set a variable (repeatable)
      --dry-run             Print stages without executing
      --output <path>       Write final output to file
      --env-file <path>     Load .env file (default: .env)
      --resume              Resume from checkpoint silently
      --fresh               Ignore checkpoint, start fresh
```

### `orcaix validate <workflow>`

Validates the YAML schema and resolves all template imports. No API calls.

### `orcaix init <name>`

Scaffolds a new workflow YAML file with example stages and comments.

---

## Examples

| File | Description |
|------|-------------|
| [`examples/code-review.yaml`](examples/code-review.yaml) | Multi-provider review — Sonnet analyzes, GPT-4o suggests fixes, Haiku rates severity |
| [`examples/develop-feature.yaml`](examples/develop-feature.yaml) | Opus plans, GPT-4o implements in a loop, human approves each iteration |
| [`examples/fix-tests.yaml`](examples/fix-tests.yaml) | Autonomous loop — analyze failures → apply fix → run tests → repeat until green |
| [`examples/incident-response.yaml`](examples/incident-response.yaml) | Triage → severity branch → fix proposal → human approval → apply → postmortem → Slack |
| [`examples/content-pipeline.yaml`](examples/content-pipeline.yaml) | Research → draft → critique → rewrite → publish via HTTP |
| [`examples/build-app.yaml`](examples/build-app.yaml) | Full app scaffold from a single prompt |

---

## GitHub Actions

Automate PR reviews with the included CI workflow and Action templates:

```yaml
# .github/workflows/pr-review.yml
- name: Generate PR diff
  run: git diff origin/${{ github.base_ref }}...HEAD | head -c 60000 > /tmp/pr_diff.txt

- name: Run orcaix PR review
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    PR_NUMBER: ${{ github.event.pull_request.number }}
  run: orcaix run workflows/ci/pr-review.yaml --prompt "PR #$PR_NUMBER" --fresh
```

The [`workflows/ci/pr-review.yaml`](examples/github-actions/) workflow runs three reviewers (quality, security, test coverage), compiles a single comment, and posts it to the PR. Two posting strategies are available — see [`examples/github-actions/`](examples/github-actions/).

---

## Delegate to Claude Code or Codex

Use `interactive: true` to hand off implementation to an AI coding agent mid-workflow, then resume automatically:

```yaml
- id: implement
  type: shell
  interactive: true
  command: claude --model sonnet "$(cat /tmp/plan.txt)"
  # or: codex "$(cat /tmp/plan.txt)"
```

Ready-to-use workflows in `startup-workflows/workflows/dev/`:
- [`delegate-to-claude-code.yaml`](https://github.com/TheGrotesk/orcaix) — Opus plans → you approve → Claude Code implements
- [`delegate-to-codex.yaml`](https://github.com/TheGrotesk/orcaix) — same flow with OpenAI Codex

---

<div align="center">

**[📖 Full Documentation](https://orcaix-docs.vercel.app)**

</div>
