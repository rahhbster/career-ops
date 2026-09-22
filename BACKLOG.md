# Backlog

## Next

Pushing the red-teamed local work to the fork (`fork` = rahhbster/career-ops) as three PRs, merged one at a time into `fork/main`:

1. **PR 1: `security/untrusted-content-directive`.** Commit 749a00c plus the hardening commit and this file. Merge it first, because PR 2's `jd-cdm-schema.mjs` header points at the AGENTS.md section it adds.
2. **PR 2: `feat/jd-posting-sidecar`.** The JD sidecar feature is rebuilt from the 22 unpublished local commits (now kept in `backup/main-pre-rewrite`). The rebuild uses the noreply author, with a made-up Acme example in place of the real posting fixture, and fixes every red-team finding:
   - list the allowed values in the docs and stop implying `"annual"`
   - add a path-traversal test
   - add a `CAREER_OPS_JDS` override so tests never write the real `jds/`
   - make writes atomic and refuse symlinks
   - replace the stale `{num}-*.json` file instead of leaving two
   - pass the payload via a temp file instead of a heredoc
   - tighten date, salary and URL validation
   - reject unknown nested keys
   - fix the slug's trailing hyphen
3. **PR 3: `fix/tracker-subprocess-data-root`.** Carry the merge-tracker `CAREER_OPS_PDF_INDEX` fix and its regression test. Also fix the root cause: `sync-pdf-flags.mjs` and `verify-pipeline.mjs` must resolve their data and reports directories from the tracker path, not from their own script directory.

After all three are merged, reset local `main` to `fork/main`. That step needs the user's OK, because it discards the old local `main`; `backup/main-pre-rewrite` keeps a copy.

## Open decisions

- **Sync the fork with upstream.** `fork/main` is 2,020 commits behind `origin/main` (career-ops-hq). Do this as a separate step after the three PRs land. What would change the plan: an upstream change that conflicts with the sidecar or directive work, which would argue for syncing first.
- **Upstream PRs.** The directive hardening, JD sidecar and tracker env fix are generic code and could go upstream as PRs from the fork. Never include this file, personal fixtures or anything from career-ops-private. Ask the user before opening any upstream PR.
- **Old commit 749a00c.** It keeps its original author identity on the fork. The user chose not to force-push it.

## Ruled out

- **Pushing the 22 local commits as they were.** They carried a personal author identity, and fixtures copied from a real application (company, posting URL and ID, salary range) in 7 files. Squashed and sanitized instead.
- **Trusting the built-in personal-data leak check (test-all.mjs section 6).** It only matches upstream-author strings, so it passes on this fork's owner's data.
