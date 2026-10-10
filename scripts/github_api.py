"""Tiny GitHub REST helper using only the Python standard library."""
import json
import os
import time
import urllib.error
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
REPO = os.environ["GITHUB_REPOSITORY"]  # "owner/name", set by GitHub Actions
TOKEN = os.environ["GITHUB_TOKEN"]


def call(method, path, body=None):
    url = path if path.startswith("http") else f"{API}/repos/{REPO}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            # Secondary rate limits: back off and retry.
            if err.code in (403, 429) and attempt < 3:
                time.sleep(20 * (attempt + 1))
                continue
            raise


def get_all(path):
    """Follow pagination for list endpoints."""
    items, page = [], 1
    sep = "&" if "?" in path else "?"
    while True:
        batch = call("GET", f"{path}{sep}per_page=100&page={page}")
        if not batch:
            return items
        items.extend(batch)
        if len(batch) < 100:
            return items
        page += 1
