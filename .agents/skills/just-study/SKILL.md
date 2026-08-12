---
name: just-study
description: Create or continue a researched 30-Day just-study learning course through the local MCP server. Use only when the user explicitly invokes just-study — `$just-study` in Codex, `/just-study` in Claude Code — optionally with 계속 to resume.
---

# Just Study

Use the local `just-study` MCP as the only source of persisted course state. Perform web research yourself; never ask the server to browse or call a model.

## Invariants

1. Call `health` first. If the call itself is unavailable, the local server is not running: tell the user to clone <https://github.com/jcmaker/just-study> if they have not, then run `npm run dev` in it, and stop. If it reports `state: "uninitialized"`, explain that the first approved `create_course` write will initialize this computer's empty local store, then continue the new-course flow. If it reports `ok: false`, surface its Korean `message` to the user — it describes a schema mismatch, storage inconsistency, or corrupt, orphaned, or temporary entries — and stop.
2. Use the latest saved `revision` for every write except `create_course`.
3. On `REVISION_CONFLICT`, read state again and explain the conflict. Do not replay the write automatically.
4. On `STORAGE_CORRUPT`, stop. Do not overwrite or attempt repair through MCP.
5. On `VALIDATION`, the payload broke a rule. Read the message, fix the payload, and call again — do not work around the rule or drop the field. On `STATE`, you called a tool the saved stage does not allow; re-read state and resume the stage it reports. On `UNAVAILABLE` or `INTERNAL`, stop and tell the user; do not retry in a loop.
6. Follow the saved current Day and stage. Do not skip research, quiz mastery, remediation, or reflection.
7. Never invent a source, URL, quote, learner answer, grade, approval, or completed activity.

## Choose a flow

Call `list_courses` after health.

- For `$just-study 계속`, show title, status, current Day, and stage. If several courses exist, ask the user to choose one. Then call `get_learning_state` and resume the saved stage.
- For a new course, check for a matching existing course and ask whether to continue it or create another. If no course matches, follow the new-course flow.

## Create a new course

1. Ask for existing knowledge, the concrete Day 30 outcome, and learning preference one question at a time. Reuse answers already supplied by the user.
2. Generate one UUID request ID and reuse it if `create_course` must be called again. Store the draft with the topic as title and the Day 30 outcome as goal.
3. Before searching, write the research questions, the fixed 100-point rubric, and topic-specific selection criteria.
4. Browse actual primary, official, university, standards, and strong educational sources. Open every URL before submitting it through `approve_outline` or `record_daily_research` when it was newly researched; the matching page-open event from your own browsing tool must exist in the current session transcript. Approved saved URLs follow the explicit reuse flow below instead.
5. Score authority 0–25, cross-validation 0–25, relevance 0–20, teaching quality 0–15, currency 0–10, and accessibility 0–5. Rank every candidate. Explain selection and limitations.
6. Support every major claim with at least two selected sources scoring at least 80 and having different independence keys. Record opposition and uncertainty.
7. Build exactly 30 ordered Days. Give each Day one observable objective.
8. Show the research summary, selected sources, limitations, and all 30 objectives. Call `approve_outline` only after the user explicitly approves what was shown.

Before `approve_outline` or `record_daily_research`, use simple unique local keys for nested research:

- Use keys such as `s-1` and `c-1` for `sources[].id` and `claims[].id`; do not use titles or URLs as keys.
- Set each `claims[].evidence[].sourceId` to exactly reuse that source key from `sources[].id`.
- The server stores and returns canonical UUIDs, so do not generate research UUIDs or use `crypto` for these nested keys.
- A source with `selected: false` must send `selectionReason: null`. The server rejects a reason on an unselected source with `VALIDATION: unselected source reason must be null`. Put why it lost in `limitation`, or leave both null. Only selected sources carry a reason.
- `claims[].evidence[]` may only cite selected sources. A major claim needs two of them scoring 80 or more with different independence keys; if you cannot reach two, set `major: false` and record the shortfall in `uncertainty` rather than lowering the bar.

## Resume by stage

### Lecture

1. If the current Day has no Day research, define its questions and criteria, browse actual sources, cross-check claims, and call `record_daily_research`.
2. Teach recall, precise explanation, ELI5, analogy, worked example, application, and an understanding interview.
3. Ask one understanding question at a time. Record only content actually taught and the user's demonstrated concept status with `save_checkpoint`. Every lecture-stage `save_checkpoint` call must include both `understoodConcepts` and `remediationConcepts` — use empty arrays before any concept status is known — and must never include `remediationMarkdown`.
4. When the seven parts are complete, write exactly five multiple-choice questions before showing any of them. Each needs four distinct single-line choices, the zero-based `correctChoiceIndex`, and an `explanation` the learner sees after answering. Make every wrong choice a plausible mistake, not filler. Call `start_quiz`, then present the first saved question.

### Quiz

1. Read the saved current attempt and present the first question that has no `response`. The learner can also answer in the local dashboard, so some questions may already be answered when you arrive, and the stage may have moved on entirely. Resume from what the server reports; never re-ask an answered question.
2. Show the saved `choices` exactly as stored, numbered 1 to 4 in stored order. Never reorder, reword, add, or drop a choice, and never reveal `correctChoiceIndex` before the learner answers.
3. Take the learner's pick and call `answer_quiz` with its zero-based `selectedChoiceIndex`. Never answer on the learner's behalf.
4. **The server grades.** It compares the pick against the stored answer key and returns the result. Report only what it returned; never state a result you decided yourself. Then present the saved `explanation` and move to the next unanswered question.
5. A question can be answered once. There is no clarification round — an unclear question is a question you should have written better.
6. A score of 5/5 moves to reflection. Any lower terminal score moves to remediation.

### Remediation

1. Explain each saved remediation concept in a materially different way with a new analogy or example.
2. Save only `remediationMarkdown` with `save_checkpoint`; a remediation-stage checkpoint must omit both `understoodConcepts` and `remediationConcepts`. Lecture and remediation checkpoints take mutually exclusive shapes — never mix them.
3. Write five new multiple-choice questions that cover every remediation concept and repeat no earlier prompt. Same shape as the first quiz: four distinct choices, a `correctChoiceIndex`, and an `explanation`. Call `start_remediation_quiz` and return to the quiz flow.

### Reflection

Ask what was learned, what remains confusing, and how the learner feels. After all three actual answers exist, call `complete_day`. Report the saved next Day, or course completion after Day 30.

## When web is unavailable

Do not claim new research and do not create URLs. If approved saved sources are relevant, ask whether to reuse them with their known limitations. Only after explicit reuse approval may you submit a Day research bundle containing those approved saved URLs; this reuse does not require a new page-open event. If no relevant approved source exists, stop until web access is available.

## Responses

Keep normal responses focused on the current question, teaching step, or decision. Do not dump the full journal unless the user asks; use `read_learning_document` for an explicitly requested long document.
