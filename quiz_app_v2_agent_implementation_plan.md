# Quiz_app V2 — Agent Implementation Plan

> Purpose: This document is an implementation specification for an LLM coding agent or autonomous engineering agent.
> It is designed to be read together with the existing `architecture.md`.
> The agent should treat the existing codebase as the source of truth and apply the changes below incrementally.
>
> Primary goal: Redesign quiz generation so it is faster, more resilient, easier to debug, and less dependent on one large LLM request.
>
> Do **not** rewrite the entire application. Preserve the current frontend, Express/Prisma structure, provider abstraction, analytics, gamification, auth, and existing tests unless a task below explicitly requires modification.

---

## 0. Current System Summary

The current system generates a complete quiz using one LLM request.

Current flow:

```text
POST /api/quiz/generate
        ↓
build one large prompt
        ↓
LLM generates entire quiz
        ↓
extract JSON manually
        ↓
validate full quiz
        ↓
if anything fails:
retry the entire quiz generation
        ↓
persist quiz + questions
```

Current major characteristics:

- One prompt contains:
  - persona
  - output rules
  - all question-type rules
  - pedagogy rules
  - all difficulty rules
  - explanation rules
  - math formatting rules
  - code formatting rules
  - topic
  - notes
  - requested question count
  - requested question types
  - expected JSON structure
- Notes may be up to 20,000 characters.
- A quiz may contain up to 20 questions.
- Every generated question includes a teaching explanation.
- Any parse, provider, or validation failure causes the whole quiz generation to retry.
- Provider timeout is currently global.
- JSON correctness relies primarily on prompt instructions plus manual extraction.
- Regeneration already operates at one-question granularity.
- Short-answer grading and failed exact-match code grading may require additional LLM calls at quiz submission time.

The main architectural problem is not only prompt size.

The larger issue is:

> A single LLM request owns too much work and therefore has too large a failure domain.

---

# 1. Target Architecture

Replace "one quiz = one LLM request" with:

> one quiz = one generation job composed of independent question batches.

Target high-level flow:

```text
                         USER REQUEST
                              │
                              ▼
                    ┌──────────────────┐
                    │ Generation API   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │GenerationPlanner │
                    │ mostly pure code │
                    └────────┬─────────┘
                             │
                         generation plan
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
    MCQ batch          True/False batch       Debug batch
       4 Q                  4 Q                   2 Q
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ▼
                    bounded concurrency
                             │
                             ▼
                      provider gateway
                             │
                             ▼
                    per-batch validation
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
              success                  failure
                 │                       │
              persist              retry only batch
                 │                       │
                 └───────────┬───────────┘
                             ▼
                         QUIZ READY
```

The design must reduce:

- wall-clock latency
- retry blast radius
- output token count
- invalid JSON failures
- unnecessary prompt instructions
- unnecessary repeated context
- synchronous HTTP request duration

The design must improve:

- observability
- partial progress
- fault isolation
- scalability
- model portability
- future RAG support
- future skill/assessment planning

---

# 2. Design Principles

All implementation work must follow these principles.

## 2.1 Do not turn every stage into an LLM call

The orchestrator should prefer deterministic code whenever possible.

Bad:

```text
LLM plan
→ LLM summarize
→ LLM choose question types
→ LLM generate
→ LLM validate
```

Preferred:

```text
application code plans batches
→ LLM generates only content
→ application code validates structure
→ LLM is used again only when semantic review is actually necessary
```

## 2.2 Preserve the provider abstraction

Existing provider abstraction must remain.

The application should not depend directly on Claude- or OpenAI-specific logic outside provider adapters.

Target conceptual interface:

```js
provider.generateQuestions({
  systemPrompt,
  userPrompt,
  schema,
  metadata
})
```

Provider-specific capabilities may be optional.

Example capabilities:

```js
provider.capabilities = {
  structuredOutput: true,
  promptCaching: false,
  streaming: true
}
```

Do not require all providers to support every capability.

## 2.3 Make retries surgical

Never regenerate already-valid questions unless explicitly requested.

Bad:

```text
20 generated
question 17 invalid
→ discard 20
→ regenerate all 20
```

Target:

```text
batch A valid
batch B valid
batch C invalid
→ retry only C
```

If batch C fails repeatedly:

```text
split batch C into smaller batches
or
retry individual failed items
```

## 2.4 Generate only what is necessary to start the quiz

Teaching explanations are not required before the learner answers.

Do not block quiz generation on verbose explanations.

Question-generation critical path should produce only fields required to:

- render the question
- score the question
- identify provenance/context if available

## 2.5 Optimize for measured bottlenecks

All provider invocations must become observable.

Do not assume the problem is only input prompt size.

Measure:

- input tokens
- output tokens
- time to first token if available
- total model latency
- parsing failures
- validation failures
- provider/network failures
- retry count
- per-question-type latency
- batch-size latency
- model/provider

---

# 3. Target Domain Objects

## 3.1 GenerationPlan

Create an internal object:

```ts
type GenerationPlan = {
  topic: string
  difficulty: Difficulty
  totalQuestions: number
  contextMode: "direct" | "cached" | "retrieval"
  batches: GenerationBatchPlan[]
}
```

Example:

```json
{
  "topic": "Docker",
  "difficulty": "intermediate",
  "totalQuestions": 10,
  "contextMode": "direct",
  "batches": [
    {
      "questionType": "mcq",
      "count": 4,
      "batchSize": 4
    },
    {
      "questionType": "true_false",
      "count": 3,
      "batchSize": 3
    },
    {
      "questionType": "debug",
      "count": 3,
      "batchSize": 2
    }
  ]
}
```

The initial planner must be deterministic code.

Do not introduce an LLM planner in Phase 1.

---

## 3.2 QuizGeneration

Add a persistent generation entity.

Suggested fields:

```text
QuizGeneration
--------------
id
userId
quizId?                nullable until quiz exists if needed

status
requestedQuestions
generatedQuestions

provider
model?

inputTokens?
outputTokens?

retryCount

startedAt
completedAt?
failureReason?

promptVersion?
createdAt
updatedAt
```

Suggested status values:

```text
PENDING
GENERATING
PARTIAL
READY
FAILED
```

Use application-level string validation if the project intentionally avoids native DB enums.

---

## 3.3 GenerationBatch

Add a batch/attempt entity if useful for observability.

Suggested fields:

```text
GenerationBatch
---------------
id
generationId

questionType
requestedCount
generatedCount

status

provider
model?

inputTokens?
outputTokens?

latencyMs?
retryCount

errorType?
errorMessage?

createdAt
completedAt?
```

Suggested statuses:

```text
PENDING
RUNNING
SUCCEEDED
FAILED
RETRYING
```

Do not expose unsafe provider error details directly to clients.

---

# 4. Prompt Architecture V2

Current prompt construction must be decomposed.

Target structure:

```text
prompts/
  common.js

  types/
    mcq.js
    trueFalse.js
    ordering.js
    shortAnswer.js
    codeCompletion.js
    debug.js

  difficulty/
    beginner.js
    intermediate.js
    advanced.js

  buildQuestionPrompt.js
```

## 4.1 Common prompt

Include only cross-cutting rules such as:

- generate technically correct questions
- prefer conceptual understanding over trivial memorization
- do not create duplicates inside the same batch
- return only required fields
- remain grounded in supplied notes when notes are authoritative

Do not include type-specific rules here.

Do not include all difficulty definitions here.

---

## 4.2 Question-type prompt fragments

Only include the fragment for the requested type.

Example MCQ fragment:

```text
Create single-select multiple-choice questions.

Requirements:
- exactly 4 options unless configured otherwise
- exactly one correct answer
- distractors should reflect plausible misconceptions
- avoid obviously silly distractors
```

True/false fragment:

```text
Create true/false questions.

Requirements:
- options are exactly ["true", "false"]
- avoid relying on trivial words such as "always" or "never"
- statement should require understanding
```

Ordering fragment:

```text
Create ordering questions.

Requirements:
- options must be a shuffled list
- correctAnswer must contain the same items in the correct sequence
- the sequence must represent a meaningful process or order
```

Code fragments should contain code-specific instructions.

Non-code prompts must not receive code-formatting instructions.

---

## 4.3 Difficulty prompt fragments

Only include the selected difficulty.

Example intermediate:

```text
Intermediate difficulty:
- combine related concepts
- require short reasoning or tracing
- distractors may reflect partial understanding
```

Do not send beginner and advanced definitions when intermediate was selected.

---

## 4.4 Output contract

Prefer provider-native structured output when supported by the ICA/Bedrock path.

Until verified, keep existing extraction as compatibility fallback.

The application must support both:

```text
structured output capable provider
→ schema-constrained generation
```

and:

```text
non-structured provider
→ prompt JSON contract
→ extractJsonFromText()
```

Do not remove fallback behavior until provider capability has been verified in the actual environment.

---

# 5. Explanation Strategy

## 5.1 Remove verbose explanations from the generation critical path

Current question generation should no longer require a 2–4 sentence teaching explanation for every question.

Change question schema so explanation is nullable:

```text
Question.explanation?
```

Generate:

```json
{
  "type": "mcq",
  "prompt": "...",
  "options": ["A", "B", "C", "D"],
  "correctAnswer": "B",
  "explanation": null
}
```

The quiz must be runnable without explanation.

---

## 5.2 Generate explanations lazily

Preferred behavior:

```text
learner answers incorrectly
        ↓
results screen
        ↓
user clicks "Help me understand"
        ↓
generate explanation
        ↓
persist/cache explanation
```

If a product requirement demands explanations for all questions after submission, create them after scoring rather than before quiz start.

Do not block quiz-generation completion on explanation generation.

---

# 6. Batch Generation Strategy

## 6.1 Initial batch-size heuristics

Create configuration rather than hard-coding inside business logic.

Suggested first version:

```js
const QUESTION_GENERATION_PROFILE = {
  true_false: {
    batchSize: 5,
    weight: 1
  },
  mcq: {
    batchSize: 4,
    weight: 2
  },
  ordering: {
    batchSize: 4,
    weight: 2
  },
  short_answer: {
    batchSize: 4,
    weight: 2
  },
  code_completion: {
    batchSize: 2,
    weight: 4
  },
  debug: {
    batchSize: 2,
    weight: 5
  }
}
```

These numbers are initial heuristics only.

They must be configurable and later tuned from telemetry.

---

## 6.2 Bounded concurrency

Do not launch an unlimited number of LLM requests.

Initial recommendation:

```text
max concurrent generation calls = 2 or 3
```

Make it configurable:

```text
AI_GENERATION_CONCURRENCY=3
```

Use a small concurrency limiter.

Possible implementation options:

- custom promise pool
- `p-limit`
- equivalent lightweight mechanism

Do not introduce heavy orchestration infrastructure in Phase 1.

---

## 6.3 Retry logic

Retry policy:

```text
attempt batch
    ↓
provider/network failure?
    ↓
retry according to provider policy / batch policy

parse/validation failure?
    ↓
retry batch once

still invalid and batch size > 1?
    ↓
split batch

still invalid?
    ↓
retry individual item

still invalid?
    ↓
mark generation PARTIAL or FAILED depending on product rule
```

Never regenerate successful batches.

---

# 7. Validation Architecture

Separate:

```text
schema validation
```

from:

```text
semantic quality validation
```

## 7.1 Structural validation

Structural validation stays local.

Examples:

MCQ:

```text
- required fields exist
- options are strings
- option count is valid
- options are unique
- correctAnswer is one option
```

True/False:

```text
- options exactly true/false
- correctAnswer is true or false
```

Ordering:

```text
- correctAnswer is an array
- options and correctAnswer contain the same items
- order differs from displayed order when practical
```

Code:

```text
- starterCode exists
- correctAnswer exists
```

---

## 7.2 Semantic validation

Do not add an AI semantic-review call in Phase 1 for every question.

First collect telemetry.

Future optional semantic checks may include:

- answerability from notes
- ambiguous MCQ distractors
- duplicate semantic questions
- mismatch between requested difficulty and generated question
- incorrect code solution

If semantic review is added later, use it selectively.

---

# 8. Notes / Context Strategy

Replace character-count thinking with token/context-size thinking.

Create:

```text
contextStrategy.js
```

Responsibilities:

```text
estimate input size
choose context mode
prepare source context
```

Initial conceptual modes:

```text
DIRECT
CACHED
RETRIEVAL
```

Suggested experimental ranges:

```text
small:
< ~2k estimated tokens
→ DIRECT

medium:
~2k–8k
→ DIRECT or CACHED if provider supports prompt caching

large:
> ~8k
→ RETRIEVAL
```

These are not permanent production thresholds.

Make thresholds configurable.

---

# 9. Retrieval Path for Large Notes

Do not implement this before batching and telemetry unless large-document support is immediately required.

When implemented:

```text
Document / Notes
       ↓
normalize
       ↓
chunk
       ↓
embedding
       ↓
SourceChunk storage
       ↓
retrieve relevant chunks per batch/objective
       ↓
question generation
```

Each question batch should receive only relevant context, not the entire source.

Suggested source metadata:

```text
SourceDocument
--------------
id
quizGenerationId / userId
name
contentHash
createdAt

SourceChunk
-----------
id
sourceDocumentId
chunkIndex
text
embedding?
tokenCount?
```

Do not introduce a vector database unless PostgreSQL + pgvector is insufficient for actual scale.

---

# 10. Prompt Caching

If ICA exposes Bedrock prompt caching:

Place stable content before dynamic instructions.

Conceptual order:

```text
SYSTEM RULES
STABLE NOTES / KNOWLEDGE CONTEXT
CACHE BOUNDARY

QUESTION TYPE
DIFFICULTY
BATCH COUNT
PER-BATCH DYNAMIC TASK
```

Do not depend on prompt caching for correctness.

It is an optimization only.

If unsupported, the system must continue to work normally.

---

# 11. Generation API V2

Long synchronous requests should be replaced by generation jobs.

Preferred API:

```http
POST /api/quiz/generations
```

Request:

```json
{
  "topic": "Docker",
  "notes": "...",
  "difficulty": "intermediate",
  "numQuestions": 10,
  "typeMix": ["mcq", "true_false", "debug"],
  "provider": "claude",
  "tags": ["containers"]
}
```

Immediate response:

```http
202 Accepted
```

```json
{
  "generationId": "...",
  "status": "PENDING"
}
```

---

## 11.1 Generation status endpoint

```http
GET /api/quiz/generations/:generationId
```

Response example:

```json
{
  "generationId": "...",
  "status": "GENERATING",
  "requestedQuestions": 10,
  "generatedQuestions": 6,
  "progress": 0.6,
  "quizId": null
}
```

Ready example:

```json
{
  "generationId": "...",
  "status": "READY",
  "requestedQuestions": 10,
  "generatedQuestions": 10,
  "progress": 1,
  "quizId": "..."
}
```

---

## 11.2 Progress delivery

Preferred frontend experience:

```text
Generating quiz...

3 / 10 questions ready
6 / 10 questions ready
10 / 10 questions ready

Opening quiz...
```

Preferred transport:

```text
SSE
```

Fallback:

```text
poll GET /generations/:id every 1–2 seconds
```

Do not require WebSockets for this use case.

SSE is simpler.

---

# 12. Worker Architecture

## Phase 1

Use in-process workers.

```text
Express process
    ↓
generationOrchestrator
    ↓
bounded promise pool
```

This minimizes complexity.

## Future scaling

If horizontal scaling or durable background work is required:

```text
API
 ↓
SQS / Redis-backed queue
 ↓
Generation Worker Service
 ↓
LLM providers
```

Do not introduce SQS/Redis merely to satisfy the architecture diagram.

Add durable queue infrastructure only after the application actually requires it.

---

# 13. Target Backend File Layout

Recommended evolution:

```text
backend/src/

  controllers/
    quiz.controller.js
    generation.controller.js

  services/
    generation/
      generationOrchestrator.js
      generationPlanner.js
      generationWorker.js
      generationRetry.js
      generationTelemetry.js

    knowledge/
      contextStrategy.js
      tokenEstimator.js
      retrievalService.js        # later phase

    quizGenerationService.js     # may become wrapper/deprecated

  providers/
    index.js
    aiProvider.interface.js

    claude.js
    openai.js
    mock.js

    prompts/
      common.js

      difficulty/
        beginner.js
        intermediate.js
        advanced.js

      types/
        mcq.js
        trueFalse.js
        ordering.js
        shortAnswer.js
        codeCompletion.js
        debug.js

      buildQuestionPrompt.js

  validation/
    quizSchema.js
    questionValidator.js
    batchValidator.js
```

Use names consistent with the existing repository conventions.

The exact filenames may vary if existing conventions make another location cleaner.

---

# 14. GenerationPlanner Responsibilities

`generationPlanner.js` should be mostly pure.

Input:

```js
{
  numQuestions,
  typeMix,
  difficulty
}
```

Output:

```js
{
  batches: [...]
}
```

The planner should:

1. Distribute requested questions roughly evenly across selected types.
2. Respect total question count exactly.
3. Respect per-type configured batch sizes.
4. Produce deterministic output for identical inputs.
5. Avoid LLM calls.
6. Be easy to unit test.

Example:

```text
10 questions
types = mcq, true_false, debug
```

Possible distribution:

```text
mcq       4
true_false 3
debug      3
```

Then batch:

```text
mcq: [4]
true_false: [3]
debug: [2, 1]
```

---

# 15. Telemetry

Create structured telemetry for every provider invocation.

Minimum fields:

```text
generationId
batchId

provider
model

questionType
batchSize

inputTokens?
outputTokens?

timeToFirstTokenMs?
latencyMs

attemptNumber
retryCount

status

errorClass?
validationError?
parseError?
timeout?
httpStatus?
```

If provider token usage is unavailable:

- estimate input tokens if practical
- leave exact fields null
- do not invent numbers

---

## 15.1 Metrics to derive

System should eventually report:

```text
p50 generation latency
p95 generation latency

generation failure rate
retry rate

average input tokens
average output tokens

latency by:
  provider
  model
  question type
  batch size
  difficulty

failure rate by:
  provider
  question type
  batch size
```

This information will be used to tune batching.

---

# 16. Submission-Time Optimization

Review `quizScoringService` and submission flow.

Independent AI grading calls should use bounded concurrency.

Target:

```text
objective questions
→ score synchronously/local

short answers
→ AI grading queue

failed exact-match code/debug
→ AI grading queue

await AI grading with bounded concurrency
```

Do not send AI requests sequentially if they are independent.

Suggested concurrency:

```text
2–4
```

Make configurable if practical.

Preserve original question order in the final results.

---

# 17. Database Changes

Modify Prisma schema incrementally.

Required first-wave schema changes:

```text
Question.explanation
→ nullable

QuizGeneration
→ add

GenerationBatch
→ optional but strongly recommended
```

Potential future additions:

```text
SourceDocument
SourceChunk
```

Do not add retrieval tables in Phase 1 unless retrieval is implemented at the same time.

Create proper migrations.

Update test schema setup automatically through the existing migration workflow.

---

# 18. Frontend Changes

Keep existing quiz runner.

Change only generation UX initially.

Current:

```text
submit form
wait
receive quiz
navigate
```

Target:

```text
submit form
receive generationId
show progress
subscribe/poll status
when READY:
fetch/start quiz
navigate
```

Generation UI should show:

```text
Generating your quiz
6 of 10 questions ready
```

If generation becomes PARTIAL:

Possible UI:

```text
8 of 10 questions generated.

[Start 8-question quiz]
[Retry missing questions]
```

Whether partial quizzes are user-visible is a product decision.

Initial implementation may instead automatically retry and only expose READY or FAILED.

---

# 19. Backward Compatibility

Do not break existing API until V2 works.

Recommended transition:

1. implement new internal orchestrator
2. keep old `/api/quiz/generate`
3. route old endpoint through new orchestrator synchronously if needed
4. add new `/api/quiz/generations`
5. migrate frontend
6. deprecate old synchronous endpoint later

This allows tests and behavior to remain stable during migration.

---

# 20. Structured Output Capability Test

Before relying on structured output, write an explicit integration experiment.

Test both real providers through ICA.

Test:

```text
simple schema
nested question schema
array output
enum constraints
nullable fields
```

Record:

```text
supported?
provider?
model?
API path?
limitations?
```

If supported:

- add provider capability flag
- use stable schemas
- retain semantic validation

If unsupported:

- continue prompt JSON + extraction fallback

Do not make structured output support a blocker for the rest of V2.

---

# 21. Testing Requirements

Every implementation phase must include tests.

## GenerationPlanner

Test:

```text
1 question / 1 type
10 questions / 3 types
20 questions / all types
counts always sum correctly
batch sizes respected
deterministic output
```

## Batch validation

Test malformed responses per type.

Examples:

```text
MCQ correctAnswer missing from options
duplicate options
ordering answer not permutation
true/false wrong values
code question missing starterCode
```

## Retry

Test:

```text
first batch succeeds
second fails once then succeeds
successful first batch is never regenerated

batch fails twice
→ split/retry behavior works
```

## Provider failures

Simulate:

```text
timeout
429
500
invalid JSON
schema-invalid JSON
```

## Partial generation

Ensure valid questions are preserved.

## Frontend

Test:

```text
generation started
progress updates
ready redirects
failure state
retry behavior
```

Use mock provider for deterministic automated tests.

---

# 22. Performance Acceptance Criteria

Create a baseline before implementation.

Measure current architecture with:

```text
5 MCQ
10 mixed questions
20 mixed questions
10 questions with large notes
code-heavy quiz
```

For V2, acceptance should include:

1. A single malformed question must not force regeneration of unrelated valid batches.
2. Successful batches must be preserved across retries.
3. Explanation generation must not block quiz readiness.
4. Prompt builder must include only selected question-type rules.
5. Prompt builder must include only selected difficulty rules.
6. Batch concurrency must be bounded.
7. Generation progress must be observable.
8. Provider invocation latency and retry counts must be logged.
9. Existing quiz-running/scoring functionality must remain correct.
10. Existing automated tests should remain green or be intentionally updated with equivalent coverage.

Do not set artificial latency targets before baseline measurements exist.

After telemetry is available, establish p50/p95 targets.

---

# 23. Implementation Phases

The coding agent must execute in this order unless there is a strong repository-specific reason not to.

---

## PHASE 0 — Baseline and safety

Goal:

Understand current behavior before changing architecture.

Tasks:

- inspect `quizGenerationService`
- inspect current provider implementations
- inspect `promptUtils`
- inspect `quizSchema`
- inspect tests
- record current generation behavior
- add missing tests around retry behavior if absent
- verify all current tests pass

Do not change product behavior yet.

Exit criteria:

```text
baseline tests pass
existing retry behavior documented
```

---

## PHASE 1 — Prompt decomposition

Goal:

Reduce unnecessary prompt content without changing external API.

Tasks:

- create common prompt fragment
- create per-type fragments
- create per-difficulty fragments
- update prompt builder
- preserve current output shape
- update prompt-related tests

Requirement:

A MCQ intermediate request must not contain:

```text
ordering rules
debug rules
short-answer rules
beginner rules
advanced rules
```

Exit criteria:

```text
all tests pass
prompt output is materially smaller
generation behavior remains compatible
```

---

## PHASE 2 — Remove eager explanations

Goal:

Reduce output size.

Tasks:

- make `Question.explanation` nullable
- change generation schema
- remove mandatory explanation generation from generation prompt
- make frontend tolerate missing explanation
- preserve existing mistake-explanation endpoint
- optionally persist generated explanation when requested

Exit criteria:

```text
quiz can be created/run/submitted with explanation=null
mistake explanation still works
results UI handles null explanation
```

---

## PHASE 3 — GenerationPlanner + batches

Goal:

Replace one giant generation request with several smaller units.

Tasks:

- implement pure `generationPlanner`
- implement batch generation
- validate per batch
- preserve successful batches
- combine valid questions in correct final order
- maintain exact requested total

Initially keep request synchronous if necessary.

Exit criteria:

```text
a 10-question mixed quiz is generated through multiple batches
successful batch is not regenerated when another batch fails
```

---

## PHASE 4 — Bounded concurrency

Goal:

Reduce wall-clock latency.

Tasks:

- run independent batches concurrently
- add configurable concurrency limit
- preserve deterministic final ordering
- ensure provider/rate-limit safety

Exit criteria:

```text
no unbounded Promise.all
generation uses configured max concurrency
```

---

## PHASE 5 — Surgical retry

Goal:

Reduce failure blast radius.

Tasks:

- retry failed batch only
- split repeatedly failing multi-question batch
- allow individual-question fallback
- preserve successful results
- track retry telemetry

Exit criteria:

```text
one malformed question no longer causes entire quiz regeneration
```

---

## PHASE 6 — Telemetry

Goal:

Know where latency actually occurs.

Tasks:

- instrument provider calls
- log batch type/count
- capture latency
- capture tokens when provider returns them
- capture error category
- capture retry count
- persist or emit structured logs

Exit criteria:

Developer can answer:

```text
Which question type is slowest?
What batch size fails most often?
What percentage of generations retry?
Which provider/model has highest p95 latency?
```

---

## PHASE 7 — Async generation API

Goal:

Remove long-running synchronous request dependency.

Tasks:

- add `QuizGeneration`
- add generation endpoints
- create in-process job execution
- add status polling
- add SSE if practical
- update frontend generation flow

Exit criteria:

```text
POST generation returns quickly with 202
quiz generation continues as job
frontend shows progress
READY state yields quizId
```

---

## PHASE 8 — Structured-output capability

Goal:

Reduce parse failures when available.

Tasks:

- test ICA/Bedrock path
- add provider capability flag
- implement stable schemas
- preserve fallback extractor

Exit criteria:

```text
structured-output providers use schemas
other providers still work
```

---

## PHASE 9 — Context strategy

Goal:

Avoid repeatedly sending unnecessarily large notes.

Tasks:

- token estimate
- context thresholds
- direct mode
- optional prompt caching capability
- preserve current note sanitization/security

Exit criteria:

```text
context strategy selected explicitly for every generation
```

---

## PHASE 10 — Retrieval for large sources

Goal:

Support large training/reference material efficiently.

Tasks:

- normalize/chunk
- embeddings
- source storage
- retrieval
- relevant-context generation
- provenance identifiers

Do this only after earlier phases are stable.

---

## PHASE 11 — Advanced assessment architecture

Future product work.

Potential domain objects:

```text
KnowledgePack
LearningObjective
AssessmentPrimitive
SkillGraph
QuestionBank
```

Do not block V2 generation architecture on these.

---

# 24. Non-Goals for Initial V2

Do not do these during early phases unless required:

- rewrite React in TypeScript
- replace Express
- replace Prisma
- introduce microservices
- introduce Kafka
- introduce Kubernetes
- introduce a vector DB without need
- add LLM agents for orchestration
- add an LLM reviewer to every question
- rewrite analytics/gamification
- redesign auth
- migrate all providers simultaneously to a new protocol

Keep the redesign focused on generation latency and reliability.

---

# 25. Agent Working Rules

The implementation agent must follow these rules.

## Before editing

1. Read `architecture.md`.
2. Inspect relevant source files.
3. Inspect existing tests.
4. Preserve existing naming and coding style.
5. Do not assume architecture.md is perfectly synchronized with source code; source code wins if there is a discrepancy.
6. Mention discrepancies in implementation notes.

## During implementation

1. Work one phase at a time.
2. Prefer small commits/patches.
3. Add or update tests in the same phase.
4. Run focused tests first.
5. Run the full relevant suite before marking a phase complete.
6. Do not remove compatibility behavior until the replacement is verified.
7. Avoid unrelated refactors.

## After each phase

Report:

```text
PHASE:
STATUS:

FILES CHANGED:

IMPLEMENTED:

TESTS ADDED/UPDATED:

TEST RESULTS:

KNOWN ISSUES:

NEXT PHASE:
```

Do not claim completion if tests are failing.

---

# 26. Error Taxonomy

Generation failures should be classified.

Suggested categories:

```text
PROVIDER_TIMEOUT
PROVIDER_RATE_LIMIT
PROVIDER_4XX
PROVIDER_5XX
NETWORK_ERROR

PARSE_ERROR
STRUCTURE_VALIDATION_ERROR
SEMANTIC_VALIDATION_ERROR

GENERATION_CANCELLED
UNKNOWN
```

Keep internal error details in logs.

Client-facing messages should remain safe.

---

# 27. Configuration Additions

Suggested new environment variables:

```text
AI_GENERATION_CONCURRENCY=3

AI_BATCH_SIZE_MCQ=4
AI_BATCH_SIZE_TRUE_FALSE=5
AI_BATCH_SIZE_ORDERING=4
AI_BATCH_SIZE_SHORT_ANSWER=4
AI_BATCH_SIZE_CODE_COMPLETION=2
AI_BATCH_SIZE_DEBUG=2

AI_BATCH_MAX_RETRIES=1

AI_CONTEXT_DIRECT_TOKEN_LIMIT=2000
AI_CONTEXT_RETRIEVAL_TOKEN_LIMIT=8000
```

Exact names may be adapted to existing config conventions.

Avoid configuration sprawl if values are unlikely to change.

---

# 28. Example End-to-End V2 Flow

User asks:

```text
Topic: Kubernetes
Difficulty: intermediate
Questions: 12
Types:
- MCQ
- True/False
- Ordering
Notes: 5 pages
```

Backend:

```text
1. validate request

2. sanitize notes

3. contextStrategy:
   medium context
   → direct/cached mode

4. generationPlanner:
   MCQ        4
   T/F        4
   ordering   4

5. create QuizGeneration

6. create 3 batches

7. concurrency = 3

8. generate batches simultaneously

9. validate each independently

10. ordering batch fails:
    retry ordering only

11. MCQ and T/F remain preserved

12. ordering succeeds

13. combine 12 questions

14. persist Quiz + Question rows

15. mark generation READY

16. frontend opens quiz
```

If ordering repeatedly fails:

```text
split ordering 4
→ 2 + 2

retry failed half only
```

At no point should successful MCQ and T/F questions be thrown away.

---

# 29. Example Minimal Question Output

MCQ generation:

```json
{
  "questions": [
    {
      "type": "mcq",
      "prompt": "Which Kubernetes object directly manages ReplicaSets?",
      "options": [
        "Deployment",
        "Pod",
        "Service",
        "ConfigMap"
      ],
      "correctAnswer": "Deployment",
      "starterCode": null
    }
  ]
}
```

No verbose explanation is required.

---

# 30. Future Product Evolution

Once V2 is stable, evolve from:

```text
AI quiz generator
```

toward:

```text
AI assessment platform
```

Potential architecture:

```text
Sources
  ↓
KnowledgePack
  ↓
Learning Objectives
  ↓
Assessment Blueprint
  ↓
Assessment Primitives
  ↓
Question Renderers
  ↓
Question Bank
  ↓
Attempts
  ↓
Skill Graph
  ↓
Adaptive future quizzes
```

Important:

Do not implement this entire future architecture while solving the current latency problem.

V2 generation reliability comes first.

---

# 31. Definition of Done

Quiz Generation V2 is considered successful when:

- generation no longer depends on one giant LLM response
- prompts include only relevant type/difficulty instructions
- explanations are removed from the generation critical path
- questions are generated in bounded concurrent batches
- one failed batch does not discard valid batches
- retries are surgical
- generation latency/failures are observable
- asynchronous generation is supported
- structured output is used when the actual provider path supports it
- large-note handling has an explicit context strategy
- existing quiz runner/scoring/analytics/gamification behavior remains functional
- automated tests cover the new orchestration logic

---

# 32. First Agent Instruction

When an implementation agent receives this file, begin with:

```text
1. Read architecture.md completely.
2. Inspect the current quiz generation service, prompt builder,
   provider adapters, validators, Prisma schema, and generation tests.
3. Run the existing backend tests.
4. Implement PHASE 1 only.
5. Do not proceed to later phases until PHASE 1 tests pass.
6. Report changes using the phase report format in Section 25.
```

This staged approach is intentional.

Do not attempt the entire redesign in a single uncontrolled refactor.
