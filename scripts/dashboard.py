"""Redraw the progress dashboard (dashboard/progress.svg) and the README status block.

Runs in GitHub Actions whenever an issue changes. For a local preview without
GitHub, run:  LOCAL_PREVIEW=1 python scripts/dashboard.py
"""
import datetime as dt
import html
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TODAY = dt.date.today()

# Neutral palette (deliberately not tied to any brand)
INK, MUTED, TRACK, BG = "#1F2937", "#475569", "#E2E8F0", "#F8FAFC"
FILL, DONE, LATE, BORDER = "#0F766E", "#334155", "#B45309", "#CBD5E1"


def load_from_github():
    from github_api import get_all
    milestones = get_all("/milestones?state=all")
    issues = [i for i in get_all("/issues?state=all") if "pull_request" not in i]
    issues.sort(key=lambda i: i["number"])  # oldest first = planned order
    # Tasks closed as "won't do" stay in GitHub but drop out of progress math
    all_issues = issues
    issues = [i for i in issues if i.get("state_reason") != "not_planned"]
    phases = []
    for m in milestones:
        mine = [i for i in issues if i.get("milestone") and i["milestone"]["number"] == m["number"]]
        phases.append({
            "title": m["title"],
            "due": (m.get("due_on") or "")[:10],
            "total": len(mine),
            "done": sum(1 for i in mine if i["state"] == "closed"),
            "open": [i for i in mine if i["state"] == "open"],
        })
    decisions = [i for i in issues if i["state"] == "open"
                 and any(l["name"] == "decision" for l in i["labels"])]
    tasks = [{
        "number": i["number"], "title": i["title"], "state": i["state"],
        "phase": i["milestone"]["title"] if i.get("milestone") else "",
        "labels": [l["name"] for l in i["labels"]],
        "url": i["html_url"], "body": i.get("body") or "",
        "closed": (i.get("closed_at") or "")[:10],
        "created": (i.get("created_at") or "")[:10],
        "reason": i.get("state_reason") or "",
    } for i in all_issues]
    return phases, decisions, tasks


def load_local_preview():
    plan = json.loads((ROOT / "tracker" / "tasks.json").read_text())
    phases, decisions, tasks, n = [], [], [], 0
    for p in plan["phases"]:
        mine = [t for t in plan["tasks"] if t["phase"] == p["key"]]
        open_items = []
        for t in mine:
            n += 1
            item = {"number": n, "title": t["title"], "html_url": "#",
                    "labels": [{"name": l} for l in t["labels"]]}
            tasks.append({"number": n, "title": t["title"],
                          "state": "closed" if t["done"] else "open",
                          "phase": p["title"], "labels": t["labels"], "url": "#",
                          "body": t["body"] + (f"\n\n<!-- keystone:due={t['due']} -->" if t.get("due") else "") + (f"\n<!-- keystone:owner={t['owner']} -->" if t.get("owner") else "")
                                  + (f"\n<!-- keystone:after={','.join(map(str, t['after']))} -->" if t.get("after") else ""),
                          "closed": p["due"] if t["done"] else "", "created": "", "reason": ""})
            if not t["done"]:
                open_items.append(item)
                if "decision" in t["labels"]:
                    decisions.append(item)
        phases.append({"title": p["title"], "due": p["due"], "total": len(mine),
                       "done": sum(t["done"] for t in mine), "open": open_items})
    return phases, decisions, tasks


ATTACH_RE = re.compile(r"^(report|memo|voucher|other)--(\d{4}-\d{2}-\d{2})--(.+)$")


def load_attachments():
    """Files in docs/attachments/task-N/, named KIND--YYYY-MM-DD--name.ext"""
    out = {}
    folder = ROOT / "docs" / "attachments"
    for d in sorted(folder.glob("task-*")) if folder.exists() else []:
        for f in sorted(d.iterdir()):
            m = ATTACH_RE.match(f.name)
            if not m or not f.is_file():
                continue
            out.setdefault(d.name[5:], []).append({
                "file": f"attachments/{d.name}/{f.name}", "kind": m.group(1),
                "added": m.group(2), "name": m.group(3), "size": f.stat().st_size})
    return out


def load_documents():
    """Program documents (tracker/documents.json), with file sizes added for the site."""
    path = ROOT / "tracker" / "documents.json"
    docs = json.loads(path.read_text()) if path.exists() else []
    for d in docs:
        for v in [d] + d.get("history", []):
            f = ROOT / "docs" / v.get("file", "")
            if v.get("file") and f.is_file():
                v["size"] = f.stat().st_size
    return docs


def nice_date(iso):
    if not iso:
        return "no date"
    d = dt.date.fromisoformat(iso)
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def status(p):
    if p["total"] and p["done"] == p["total"]:
        return "Complete"
    if p["due"] and dt.date.fromisoformat(p["due"]) < TODAY:
        return "Past due"
    return "In progress" if p["done"] else "Not started"


def draw_svg(phases, project):
    total = sum(p["total"] for p in phases)
    done = sum(p["done"] for p in phases)
    pct = round(100 * done / total) if total else 0
    W, x0, label_w, bar_x, bar_w = 840, 32, 300, 340, 330
    row_h, top = 52, 150
    H = top + row_h * len(phases) + 28
    e = html.escape
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'role="img" aria-label="{e(project)} progress: {pct} percent complete" '
        f'font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif">',
        f'<rect width="{W}" height="{H}" rx="14" fill="{BG}" stroke="{BORDER}"/>',
        f'<text x="{x0}" y="46" font-size="22" font-weight="700" fill="{INK}">{e(project)}</text>',
        f'<text x="{x0}" y="70" font-size="14" fill="{MUTED}">{done} of {total} tasks done · updated {nice_date(TODAY.isoformat())}</text>',
        f'<text x="{W - x0}" y="58" font-size="34" font-weight="700" fill="{FILL}" text-anchor="end">{pct}%</text>',
        f'<rect x="{x0}" y="90" width="{W - 2 * x0}" height="14" rx="7" fill="{TRACK}"/>',
        f'<rect x="{x0}" y="90" width="{(W - 2 * x0) * pct / 100:.1f}" height="14" rx="7" fill="{FILL}"/>',
        f'<line x1="{x0}" x2="{W - x0}" y1="128" y2="128" stroke="{BORDER}"/>',
    ]
    for i, p in enumerate(phases):
        y = top + i * row_h
        frac = p["done"] / p["total"] if p["total"] else 0
        st = status(p)
        color = DONE if st == "Complete" else LATE if st == "Past due" else FILL if st == "In progress" else MUTED
        out += [
            f'<text x="{x0}" y="{y + 6}" font-size="15" font-weight="600" fill="{INK}">{e(p["title"])}</text>',
            f'<text x="{x0}" y="{y + 26}" font-size="12.5" fill="{MUTED}">Due {nice_date(p["due"])}</text>',
            f'<rect x="{bar_x}" y="{y - 6}" width="{bar_w}" height="12" rx="6" fill="{TRACK}"/>',
            f'<rect x="{bar_x}" y="{y - 6}" width="{bar_w * frac:.1f}" height="12" rx="6" fill="{color}"/>',
            f'<text x="{bar_x}" y="{y + 26}" font-size="12.5" fill="{MUTED}">{p["done"]} of {p["total"]}</text>',
            f'<text x="{W - x0}" y="{y + 5}" font-size="13" font-weight="600" fill="{color}" text-anchor="end">{st}</text>',
        ]
    out.append("</svg>")
    return "\n".join(out) + "\n"


def readme_block(phases, decisions):
    lines = ["![Progress](dashboard/progress.svg)", "",
             "| Phase | Due | Done | Status |", "| --- | --- | --- | --- |"]
    for p in phases:
        lines.append(f"| {p['title']} | {nice_date(p['due'])} | {p['done']} / {p['total']} | {status(p)} |")
    # "Up next" = the open phase with the soonest due date
    open_phases = [p for p in phases if p["open"]]
    current = min(open_phases, key=lambda p: p["due"] or "9999") if open_phases else None
    if current:
        lines += ["", f"**Up next ({current['title']}):**", ""]
        for it in current["open"][:5]:
            lines.append(f"- [ ] [#{it['number']} {it['title']}]({it['html_url']})")
    if decisions:
        lines += ["", "**Decisions waiting on you:**", ""]
        for it in decisions[:8]:
            lines.append(f"- [#{it['number']} {it['title']}]({it['html_url']})")
    lines += ["", f"_Updated automatically {nice_date(TODAY.isoformat())}._"]
    return "\n".join(lines)


def main():
    plan = json.loads((ROOT / "tracker" / "tasks.json").read_text())
    if os.environ.get("LOCAL_PREVIEW"):
        phases, decisions, tasks = load_local_preview()
    else:
        phases, decisions, tasks = load_from_github()
    # Phase order: by the "Phase N" number in the title
    phases.sort(key=lambda p: int(m.group(1)) if (m := re.search(r"Phase (\d+)", p["title"])) else 99)
    (ROOT / "dashboard").mkdir(exist_ok=True)
    (ROOT / "dashboard" / "progress.svg").write_text(draw_svg(phases, plan["project"]))
    readme = ROOT / "README.md"
    text = readme.read_text()
    block = f"<!-- STATUS:START -->\n{readme_block(phases, decisions)}\n<!-- STATUS:END -->"
    text = re.sub(r"<!-- STATUS:START -->.*?<!-- STATUS:END -->", lambda _: block, text, flags=re.S)
    readme.write_text(text)
    # Data for the website (docs/index.html reads this file)
    site = {
        "project": plan["project"], "company": plan["company"], "summary": plan.get("summary", ""),
        "repo": os.environ.get("GITHUB_REPOSITORY", ""),
        "updated": TODAY.isoformat(),
        "phases": [{"title": p["title"], "due": p["due"], "done": p["done"],
                    "total": p["total"], "status": status(p)} for p in phases],
        "labels": {l["name"]: "#" + l["color"] for l in plan["labels"]},
        "team": json.loads(team.read_text()) if (team := ROOT / "tracker" / "team.json").exists() else [],
        "attachments": load_attachments(),
        "documents": load_documents(),
        "calendar": json.loads(c.read_text()) if (c := ROOT / "tracker" / "calendar.json").exists() else None,
        "messages": json.loads(mm.read_text()) if (mm := ROOT / "tracker" / "messages.json").exists() else [],
        "budget": json.loads(b.read_text()) if (b := ROOT / "tracker" / "budget.json").exists() else None,
        "tasks": tasks,
    }
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "data.json").write_text(json.dumps(site, indent=1) + "\n")
    print("dashboard updated")


if __name__ == "__main__":
    main()
