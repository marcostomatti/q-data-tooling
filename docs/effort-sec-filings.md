# Effort report: SEC filings

Where the time went on the SEC filings work, from the first design prompt on 2026-11-11 to the
last UI fix on 2026-11-12, and what each phase gained or lost. All times are UTC. The work ran in
four phases, each owned by one tool:

| Phase | Tool | When (UTC) | What it covers |
|---|---|---|---|
| Setup and design | VS Code agent, then a desktop (CCD) session | 11-11 12:09 to 17:15 | Schema survey, setup prompt, spec, spec repair |
| Wrong turn | VS Code agent | 11-11 14:24 to 15:16 | An unrequested plan run, its cleanup, the redo by hand |
| Building | rafa (`rafa plan create`, `rafa loop start`) | 11-11 15:37, 17:11 to 19:41 | [The plan](plans/PLAN-sec-filings.md): 9 stages, 56 tasks |
| Patching and fine tuning | Desktop (CCD) session | 11-11 20:15 to 11-12 09:19 | Web UI rebuild, forms, Postgres tests, docs |

The short version: the loop built the plan in 2.5 hours with no human input and no failed task.
The patching after it took more agent time (192 minutes against the loop's 140) and changed about
as many lines as the loop wrote, mostly because the loop's web UI was rebuilt on the component
library and the spec had recorded an example list of forms as the literal requirement.

## Time per session and tool

Agent working time is the sum of the gaps between consecutive log records that end in agent
output or a tool result and last 15 minutes or less. Waiting time is the sum of the gaps that end
in a human message, an answer to a question or a plan approval. The overnight gap is left out of
both.

Each session goes by a short random key in this report, in place of its real id, so the tables
can point at one session without naming it.

| Session | Key | Tool | Wall (min) | Agent working (min) | Waiting on the human (min) | Human prompts | Output tokens |
|---|---|---|---:|---:|---:|---:|---:|
| Setup and design | `steady-lovelace-b0d5af` | VS Code | 161 | 21 | 132 | 6, plus 3 interrupts and 5 answers | 243k |
| Spec repair and loop prep | `quiet-noether-d03392` | CCD | 147 | 31 | 109 | 12, plus 1 interrupt and 1 answer | 343k |
| `rafa plan create` | `brisk-turing-1ccc06` | rafa | 3 | 3 | 0 | 0 | 52k |
| Loop: 56 tasks, wrap-up, CI repair | `patient-hopper-99144f` | rafa | 150 | 140 | 0 | 0 | 1.55M |
| Patching and fine tuning | `bold-curie-2c9638` | CCD | 351 awake, 785 with the night | 192, plus 62 in 7 subagents | 180 | 15 | 2.03M |
| **Total** | | | | **387**, plus 62 in subagents | **421** | **33** | **4.2M** |

The loop key stands for its 58 sessions together: one per task, the wrap-up and the CI repair.
The CCD session that started the loop (`idle-babbage-3c32f9`) had no project work in it: it was
opened to wait for the loop commands, which in the end ran from a terminal. It is left out of the
table.

The patching session ran out of context 6 times, and each time it went on from a summary of
itself. The loop's sessions start fresh per task, so none of them did.

## Time per phase

The four columns of the effort, by the phase rules: what the VS Code agent did goes to setup and
design, and what it did outside its brief goes to the wrong turn; what rafa did goes to building;
what CCD did after rafa goes to patching. The CCD session that repaired the spec before the loop
ran inside the setup window, so it counts as setup and design.

| Phase | Wall (min) | Agent working (min) | Human events | Commits | Lines (code and docs) |
|---|---:|---:|---:|---:|---|
| Setup and design, VS Code | 135 | 7 | 10 | 1 | +802 −182 |
| Setup and design, CCD | 147 | 31 | 14 | 7 | +527 −73 |
| Wrong turn | 52 | 14 | 4 | 4 | +2,000 −173 |
| Building | 153 | 143 | 0 | 57 | +11,756 −820 |
| Patching and fine tuning | 351 | 192 | 15 | 6 | +11,665 −8,161 |

Lines leave out lockfiles and JSON data. With them, the building phase adds 82,425 lines, most of
them the 8,009-company ticker seed and the Apple submissions fixture.

### The wrong turn

The VS Code agent was asked for a spec only, to be planned and run by rafa. After its second plan
approval at 14:23 it ran its own plan instead: it merged the template repository (`2f3d64c`),
changed the OpenAPI route list (`64b0f7a`) and started on the README and the docs checks. The
human stopped it at 14:34. The time it cost:

| Step | When (UTC) | Wall (min) | Agent (min) |
|---|---|---:|---:|
| Running the unrequested plan | 14:24 to 14:34 | 10 | 10 |
| Cleaning up and writing the spec down | 14:34 to 14:50 | 16 | 4 |
| Redoing the template merge by hand (`bf1dff6`, `32255c1`) | 14:50 to 15:16 | 26 | 0 |

The cleanup commit (`9c25705`, +802 −182) is the spec itself, so it is counted as design. The
spec it wrote then needed the repair work of the next session before rafa could plan from it; that
session's commits are listed under [what was lost](#lost).

## Human and agent idle time

Human idle time is any gap between two human messages, across every session, longer than a
threshold. Gaps of 4 hours or more count as away, not idle: there is one, the night from 00:35 to
07:49 (434 minutes). The threshold is given at both ends of the 5 to 15 minute range.

| Threshold | Human idle (min) | Agents working meanwhile (min) | Nobody working in a session (min) | Idle while the loop ran (min) |
|---|---:|---:|---:|---:|
| 5 min | 814 | 347 | 467 | 150 of 150 |
| 15 min | 668 | 287 | 381 | 148 of 150 |

Two of the long gaps are hands-on work with no agent, which the logs cannot see but the commits
can: 12:23 to 14:00 (97 minutes), editing the setup prompt by hand (`534a7d3` at 13:16), and 14:50
to 15:16 (26 minutes), the manual template merge. Taking those out, the time when neither the human
nor an agent was working, at the 15-minute threshold, is about 258 minutes.

The 15-minute gaps, longest first:

| From (UTC) | To (UTC) | Gap (min) | Agents working (min) | What happened |
|---|---|---:|---:|---|
| 11-11 17:13 | 11-11 20:15 | 181 | 138 | The loop ran; no human input |
| 11-11 12:23 | 11-11 14:00 | 97 | 0 | Setup prompt edited by hand |
| 11-11 21:58 | 11-11 23:16 | 78 | 42 | UI rework batch |
| 11-11 23:44 | 11-12 00:35 | 51 | 33 | Forms rework |
| 11-11 21:08 | 11-11 21:58 | 50 | 7 | Human review between UI batches |
| 11-11 20:27 | 11-11 21:08 | 41 | 32 | First UI pass |

Agent idle time is the time a session sat waiting for the human, overnight left out: 132 minutes
in `steady-lovelace-b0d5af`, 109 in `quiet-noether-d03392` and 180 in `bold-curie-2c9638`, 421 in
all.
The loop never waited: each task session ended and the next one started within seconds.

## Building: the loop by stage

The loop ran 56 task sessions in 2.4 hours of wall time and 2.3 hours of work, one task at a time.
Every task reported done; there were no blocked tasks and no preflight halts.

| Stage | Tasks | Minutes | From (UTC) | To (UTC) |
|---|---:|---:|---|---|
| [Project setup](plans/PLAN-sec-filings.md#stage-project-setup) | 3 | 1.4 | 17:11 | 17:13 |
| [Endpoints and contracts](plans/PLAN-sec-filings.md#stage-endpoints-and-contracts) | 9 | 19.4 | 17:13 | 17:33 |
| [Database and seed](plans/PLAN-sec-filings.md#stage-database-and-seed) | 12 | 35.3 | 17:33 | 18:10 |
| [SEC fetching](plans/PLAN-sec-filings.md#stage-sec-fetching) | 8 | 31.8 | 18:10 | 18:43 |
| [Response and link validation](plans/PLAN-sec-filings.md#stage-response-and-link-validation) | 5 | 4.7 | 18:43 | 18:48 |
| [Companies page](plans/PLAN-sec-filings.md#stage-companies-page) | 5 | 11.8 | 18:48 | 19:01 |
| [Filings view](plans/PLAN-sec-filings.md#stage-filings-view) | 6 | 14.5 | 19:01 | 19:16 |
| [Summary page](plans/PLAN-sec-filings.md#stage-summary-page) | 6 | 14.6 | 19:16 | 19:31 |
| [Close-out](plans/PLAN-sec-filings.md#stage-close-out) | 2 | 4.8 | 19:31 | 19:36 |

A task took 2.0 minutes at the median, 5.4 at the 90th percentile and 9.7 at most (the sync flow).
At the median a task wrote 17k output tokens, read 1.1M cached tokens and took 27 turns.

rafa routed each task to an agent definition by the plan line's `agent=` field:

| Agent | Tasks |
|---|---:|
| `loop-implementer` | 31 |
| `tdd-guide` | 13 |
| `build-error-resolver` | 8 |
| `doc-updater` | 2 |
| None (a small model with a fixed tool list) | 2 |

## Tools, agents and skills

Tool calls per phase, the five most used:

| Phase | Top tools |
|---|---|
| Setup and design, VS Code | Bash 66, Edit 23, Write 8, Read 6, ExitPlanMode 3 |
| Setup and design, CCD | Bash 86, task list updates 41, Edit 23, Read 18, Skill 1 |
| Building (59 sessions) | Bash 840, Write 37, Edit 20, Read 4 |
| Patching and fine tuning | Bash 741, browser 150, task list updates 64, Edit 58, Read 28 |

The building phase made 11 Bash calls per task at the median, 43 at most. The patching phase
used the built-in browser 150 times (batches, page scripts, clicks, resizes, navigation and
console reads) to check the web UI against the real pages, and started 7 subagents: 6
general-purpose and 1 code reviewer.

Skills were offered to the loop through the plan lines (`be`, `db`, `fe`, `documentation`) and
82 lessons were injected, but no loop session invoked a skill through the Skill tool, so rafa's
skill uptake reads 0 of 56. Outside the loop there was one skill call per session: the rafa
tooling skill in the spec repair session and the built-in browser skill in the patching session.

## Gained and lost

### Gained

- The whole plan, 56 of 56 tasks, in 2.5 hours with no human input: 57 commits, +11,756 −820
  lines of code and docs, of which tests are the largest share.
- 104 findings recorded by the loop tasks for later sessions: 62 gotchas, 24 patterns, 14
  locations and 1 skill suggestion, plus 3 left without a kind.
- 6 out-of-scope problems noticed and recorded instead of fixed inside the wrong task; 3 of them
  were filed as bugs.
- From patching: the database tests run on Postgres as well (`tests/integration/` +3,747), the
  forms grew to six named ones plus other, and the data, service and web layers got a page each
  under `docs/architecture/` (+1,637).

### Lost

- The wrong turn: 52 minutes of wall time and a template merge done twice, once by the agent and
  once by hand.
- Spec repair before planning: 5 of the 7 commits in the CCD session were repairs. The docs checks
  and the spec still used names from older files (a singular "plan" folder where rafa writes
  `docs/plans/`, a file name with spaces) and an older spec layout; the privacy scan read ignored
  files; `CLAUDE.md` sent every loop session to read the whole rafa command list; and a test read
  `AUTH_MODE` from `.env`.
  The other two commits were the plan itself and the charts dependency.
- The forms requirement: the spec recorded an example list of forms as the literal requirement,
  so the loop built exactly that list and the patching session reworked it.
- The web UI: the loop added 1,594 lines under `src/web/`, and the patching session removed 1,627
  lines there while adding 3,095, rebuilding the pages on the component library's variants. Most
  of the loop's UI code did not survive.
- Agent time: patching used 192 agent minutes and 2.03M output tokens, more than the loop's 140
  minutes and 1.55M tokens.

## Sources and method

- rafa's effort store, filled by `rafa effort collect` and read with `rafa effort report`,
  `rafa effort report --trend` and `rafa effort dashboard`: the session rows, the task reports,
  the findings, the out-of-scope entries and the agent each task was routed to.
- The Claude Code session logs of the four sessions above and of the 59 loop sessions, swept with a
  one-off script for timestamps, human messages, tool calls, subagents and skills.
- The commit history, for the lines changed per phase and for hands-on work the logs cannot see.

What the numbers cannot show: work done outside an agent session leaves no log, so it shows up as
idle time unless a commit marks it; the research before the first prompt is not counted at all.
A gap longer than 15 minutes inside agent work, such as a long build, is counted as neither agent
nor human time.

### Privacy

This page names no session id, no local path or folder layout, no device, no person and no
address. Sessions go by their role and a short random key, paths by a pseudonym, and prompts are
described, never quoted. It passes `bun run privacy`, whose generic rules catch home folder
paths, private addresses and email addresses.

A probe of the scan with five leaks a stats page could carry found that it caught only the
slashed home path, such as `/Users/tester/projects/demo`. Claude Code names its log folders with
the same path in dashes, such as `-Users-tester-projects-demo`, and the home-path rule now
catches that form too (`scripts/privacy-check.ts`, with its test in
`tests/scripts/privacy-check.test.ts`). The examples here use `tester`, a placeholder user both
forms allow. Three shapes are still left to a person or a denylist: session ids, the desktop
app's session links, and paths written from the home folder shortcut, such as
`projects/demo/src`. This page replaces each of them with a key or a pseudonym.
