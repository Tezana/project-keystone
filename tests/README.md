# Website tests

258 browser checks across 9 suites: tasks, dashboard and menu, team, attachments,
documents, budget, progress report, task links and messages, and calendar. Each
suite tries the demo mode and owner mode (against a stand-in for GitHub).

## Run them

```
tests/run.sh            # every suite
tests/run.sh budget     # one suite (matches the file name)
```

Needs Python 3 and Node 18+. The first run installs Playwright into `tests/node_modules`;
if your computer has no Chromium yet, run `npx playwright install chromium` once inside `tests/`.

## How they work

- `run.sh` builds test data from `tracker/*.json` (the plan), serves `docs/` on port 8766,
  runs each suite, then puts the real `README.md`, `dashboard/progress.svg`, and
  `docs/data.json` back exactly as they were.
- The browser clock is frozen at **October 10, 2026** (`TEST_DATE`), so dates and counts
  never drift.
- `fixtures/` holds a copy of the GitHub issues and milestones for owner-mode tests.
- Screenshots and the sample PDF land in `tests/output/` (not committed).

## When a test fails

The checks expect the demo data (55 tasks, 8 people, 6 documents, $26,192 spent, and so on).
If you change the plan files on purpose, update the expected numbers in the failing suite.
