# Project Keystone

A working project tracker built on GitHub, demoed with a fictional research study: a 60-participant clinical validation of a wearable hydration sensor, run by the fictional Lanternfield Labs.

**Tracker website:** https://tezana.github.io/project-keystone/ (live demo: open tasks, mark them done, add notes, create tasks; changes stay in your browser)

## Status

<!-- STATUS:START -->
_The dashboard appears here after the first run of the "Load tasks" action._
<!-- STATUS:END -->

## How this tracker works

- **Every task is an Issue.** Open the **Issues** tab to see them.
- **Every phase is a Milestone.** Open **Issues > Milestones** to see each phase's progress bar and due date.
- **To finish a task,** open it and click **Close issue**. The dashboard above redraws itself within a minute or two.
- **To add a task,** click **New issue**, then pick its phase under **Milestone** on the right.
- **Labels** sort tasks by type: `admin`, `protocol`, `lab`, `analysis`. Two special ones:
  - `decision`: needs a choice from the study lead. These show up in "Decisions waiting on you."
  - `writeup`: material for the final report or a paper.

## First-time setup (one time only)

1. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **Load tasks** on the left, then **Run workflow** > **Run workflow**.
3. Wait about two minutes. The tasks, phases, labels, and the dashboard above will appear.

## What's in this repo

| Path | What it is |
| --- | --- |
| `tracker/tasks.json` | The starting plan: phases, tasks, and labels |
| `scripts/seed.py` | Loads the plan into Issues and Milestones (skips anything already there) |
| `scripts/dashboard.py` | Draws the progress panel from live Issues |
| `.github/workflows/` | The two automations that run those scripts |
| `docs/` | The tracker website (`index.html`) and the data it reads (`data.json`) |
