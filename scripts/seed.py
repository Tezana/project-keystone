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

# Issues, one per task. The person responsible is stored as a hidden marker
# in the issue body (<!-- keystone:owner=ID -->) so the website can show it.
def with_owner(body, owner):
    body = re.sub(r"\n?<!-- keystone:owner=[\w-]+ -->", "", body or "")
    return body + (f"\n<!-- keystone:owner={owner} -->" if owner else "")


existing = {i["title"]: i for i in get_all("/issues?state=all") if "pull_request" not in i}
created = updated = 0
for task in plan["tasks"]:
    owner = task.get("owner", "")
    if task["title"] in existing:
        issue = existing[task["title"]]
        # Assign an owner to older issues that don't have one yet
        if owner and "keystone:owner=" not in (issue.get("body") or ""):
            call("PATCH", f"/issues/{issue['number']}", {"body": with_owner(issue.get("body"), owner)})
            updated += 1
            print(f"issue #{issue['number']}: assigned to {owner}")
            time.sleep(1)
        continue
    issue = call("POST", "/issues", {
        "title": task["title"],
        "body": with_owner(task["body"], owner),
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

print(f"done: {created} new issues, {updated} owners assigned")
