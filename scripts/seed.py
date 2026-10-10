"""Load labels, milestones (phases), and issues (tasks) from tracker/tasks.json.

Safe to run more than once: anything that already exists (matched by name or
title) is skipped, so it never creates duplicates.
"""
import json
import re
import time
from pathlib import Path

from github_api import call, get_all

ROOT = Path(__file__).resolve().parent.parent
plan = json.loads((ROOT / "tracker" / "tasks.json").read_text())

# Labels
existing_labels = {l["name"] for l in get_all("/labels")}
for label in plan["labels"]:
    if label["name"] not in existing_labels:
        call("POST", "/labels", label)
        print(f"label created: {label['name']}")

# Milestones, one per phase
milestones = {m["title"]: m for m in get_all("/milestones?state=all")}
phase_number = {}
for phase in plan["phases"]:
    m = milestones.get(phase["title"])
    if m is None:
        m = call("POST", "/milestones", {
            "title": phase["title"],
            "description": phase["description"],
            "due_on": f"{phase['due']}T23:59:59Z",
        })
        print(f"milestone created: {phase['title']}")
    phase_number[phase["key"]] = m["number"]

# Issues, one per task. Hidden markers at the bottom of each issue body hold
# the due date (<!-- keystone:due=2026-10-16 -->), who owns the task (<!-- keystone:owner=ID -->) and which tasks must finish
# first (<!-- keystone:after=8,17 -->), so the website can show them.
MARK = re.compile(r"\n*<!-- keystone:(due|owner|after)=[\w,-]+ -->")


def markers(task):
    out = ""
    if task.get("due"):
        out += f"\n\n<!-- keystone:due={task['due']} -->"
    if task.get("owner"):
        out += f"\n<!-- keystone:owner={task['owner']} -->"
    if task.get("after"):
        out += f"\n<!-- keystone:after={','.join(str(n) for n in task['after'])} -->"
    return out


def with_markers(body, task):
    return MARK.sub("", body or "").rstrip() + markers(task)


existing = {i["title"]: i for i in get_all("/issues?state=all") if "pull_request" not in i}
created = updated = 0
for task in plan["tasks"]:
    if task["title"] in existing:
        issue = existing[task["title"]]
        body = issue.get("body") or ""
        # Add any marker the issue is missing; never overwrite one changed on the website
        add = dict(task)
        if "keystone:owner=" in body:
            add.pop("owner", None)
        if "keystone:after=" in body:
            add.pop("after", None)
        if "keystone:due=" in body:
            add.pop("due", None)
        extra = markers(add)
        if extra:
            call("PATCH", f"/issues/{issue['number']}", {"body": body.rstrip() + extra})
            updated += 1
            print(f"issue #{issue['number']}: added{extra.replace(chr(10), ' ')}")
            time.sleep(1)
        continue
    issue = call("POST", "/issues", {
        "title": task["title"],
        "body": with_markers(task["body"], task),
        "labels": task["labels"],
        "milestone": phase_number[task["phase"]],
    })
    if task["done"]:
        call("PATCH", f"/issues/{issue['number']}", {"state": "closed", "state_reason": "completed"})
    created += 1
    print(f"issue #{issue['number']}: {task['title']}")
    time.sleep(1)  # stay well under GitHub's content-creation rate limits

# Close the Foundation milestone once its tasks are all done
for phase in plan["phases"]:
    tasks = [t for t in plan["tasks"] if t["phase"] == phase["key"]]
    if tasks and all(t["done"] for t in tasks):
        call("PATCH", f"/milestones/{phase_number[phase['key']]}", {"state": "closed"})

print(f"done: {created} new issues, {updated} issues updated")
