# Development Guidelines

Lightweight conventions for working in this repo. These are **guidelines, not enforced** — there is intentionally no `commitlint`/Husky hook. Follow them by habit to keep history readable and changelog-friendly; don't let them get in the way.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). Format:

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

- Keep the **description** short, imperative, and lowercase ("add", not "added"/"Adds"), no trailing period.
- Aim for a subject line ≤ ~72 characters.
- Use the **body** to explain the *why* (and any non-obvious *what*), wrapped at ~72 columns.
- **scope** is optional but encouraged — the area of the codebase touched.

### Types

| Type       | Use for                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `feat`     | A new feature or capability                                             |
| `fix`      | A bug fix                                                               |
| `docs`     | Documentation only (README, specs, comments-as-docs)                    |
| `refactor` | Code change that neither fixes a bug nor adds a feature                 |
| `perf`     | A change that improves performance                                      |
| `test`     | Adding or updating tests                                                |
| `build`    | Build system, images, packaging, or dependency changes                 |
| `ci`       | CI/CD pipeline or automation changes                                    |
| `chore`    | Maintenance that doesn't touch app behavior (tooling, housekeeping)     |
| `style`    | Formatting/whitespace only (no logic change)                            |
| `revert`   | Reverting a previous commit                                             |

### Scopes

Pick from a small, consistent set and adapt it to this project — inconsistent scopes are what make the convention lose value over time. Common examples:

- `api`, `ui`, `db`, `auth`, `config`, `deps`, `docs`

Define the project's scopes once and reuse them. Scope is optional — omit it when a change is broad or doesn't map cleanly to one area (e.g. `docs: fix typos across READMEs`).

### Breaking changes

Signal a breaking change by either:

- Adding `!` after the type/scope: `feat(auth)!: require app login`, **and/or**
- A footer: `BREAKING CHANGE: <what changed and how to migrate>`

### Examples

```text
docs: add project spec

feat(api): add endpoint to list courses

fix(ui): stop PDF viewer from rendering raw bytes

chore(deps): bump dependencies to latest patch releases

refactor(db): dedupe migration helpers

feat(auth)!: switch to app-managed login

BREAKING CHANGE: SSO header trust is now opt-in; set TRUST_PROXY_HEADERS.
```

## Notes

- These conventions are **not** enforced by hooks or CI here. If a future project wants enforcement, `commitlint` + a Husky `commit-msg` hook can be added there without changing this guidance.
- Keep commits focused: one logical change per commit makes history (and reverts) easier.
