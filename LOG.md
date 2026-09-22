

## 2026-09-17 — Deployed to Cloudflare Workers

Netlify had suspended the account that previously hosted this family of projects
(`503 {"error":"usage_exceeded"}` on every site, upgrade refused by the dashboard),
so everything moved to **Cloudflare Workers Static Assets** — asset-only, no Worker
script.

- Worker: **`orgsignal`**
- URL: <https://orgsignal.eric-c-gladstone.workers.dev>
- Config: `wrangler.toml`, `directory = "./_deploy"`, `not_found_handling = "404-page"`

**Deployment is an allowlist, not the project root.** The root also holds `LOG.md`,
`README.md`, `TESTING.md`, `test.js` and a superseded single-file monolith, none of
which may be served. `./stage.sh` rebuilds `_deploy/` from the allowlist, copies the
root `_headers` in, strips macOS `Icon`/`.DS_Store` artifacts, and **exits 1 if the
result has no security headers** — so a re-stage cannot silently ship a bare site.
Confirmed after deploy that `/LOG.md`, `/test.js` and `/README.md` all 404.

Model IDs were already on `claude-sonnet-5` from the 16 September sweep; token
budgets were raised at the same time because Sonnet 5's thinking tokens come out of
`max_tokens`. No CSP ships yet — this app calls third parties that would need to be
allowlisted first, and a wrong CSP fails silently.

The two demo files (`orgsignal_demo_hr.csv`, `orgsignal_demo_slack_export.zip`) are
in the allowlist deliberately — synthetic data, 43 fake people, no real names or
emails, and a visitor needs them to try the tool. Org Signal had the tightest token
ceilings in the set (350–2400); they are now 4000–12000.

Verified after deploy: the site serves 200, the served bytes hash-match the local
build, all four security headers are present, and `_headers` itself is not served.

---

