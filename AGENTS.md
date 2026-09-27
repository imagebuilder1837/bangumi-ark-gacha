## Repository rules

- Commit messages use Conventional Commits.
- Userscript header metadata is maintained by humans. Agents must not modify it without explicit human permission.
- Issue tracker writes are disabled by default. Agents may write to issues only when explicitly requested by a human or when invoking a relevant skill.
- For behavior changes, consult `docs/module-guide.md` and read the relevant maintained source. Do not load the whole generated `src/index.user.js` by default; inspect targeted parts only for build debugging, review, or artifact acceptance.
- Before every commit, run `npm run check` on the final change state; fix failures and rerun before committing.

## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
