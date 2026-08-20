# Publishing checklist

This package is **not published yet**. Before running `npm publish` for real, work through
this list.

## Open decisions

1. **Package name / scope** — `package.json` currently uses the placeholder name
   `nestjs-typeorm-pagination`. Decide whether to publish it unscoped under that name
   (check it's actually available on the npm registry first) or under an npm org/user
   scope (e.g. `@your-org/nestjs-typeorm-pagination`). Scoped packages default to private
   and need `--access public` to publish publicly.
2. **Author name** — fill in the real author name/handle in `package.json`'s `"author"`
   field and in the copyright line of `LICENSE` (`Copyright (c) 2026 <package author>`).
   Both currently have a `<package author>` placeholder.
3. **Repository / homepage / bugs URLs** — not set in `package.json` because this repo has
   no git remote configured yet. Once the code is pushed somewhere (GitHub, GitLab, etc.),
   add:
   ```json
   "repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" },
   "homepage": "https://github.com/<owner>/<repo>#readme",
   "bugs": { "url": "https://github.com/<owner>/<repo>/issues" }
   ```

## Steps

1. Resolve the open decisions above.
2. Double-check `version` in `package.json` follows semver for the intended first release.
3. `npm run build` — confirm it succeeds and `dist/index.js` + `dist/index.d.ts` exist.
4. `npm test` — confirm the full mocked suite passes.
5. `npm pack --dry-run` — inspect the file list; it should contain only `dist/`,
   `package.json`, `README.md`, and `LICENSE` (npm includes the license and readme
   automatically). No `src/`, `*.spec.ts`, `smoke-test/`, `node_modules/`, or `coverage/`.
6. Create (or verify you have) an npm account, and enable two-factor authentication (2FA)
   on it.
7. `npm login` — authenticate the npm CLI with that account.
8. Publish:
   - Unscoped package: `npm publish`
   - Scoped package intended to be public: `npm publish --access public`
9. After publishing, verify the package page on npmjs.com renders correctly (README,
   license, repository link) and that `npm install <package-name>` works in a scratch
   project.

None of the above steps (account creation, `npm login`, `npm publish`) have been performed
as part of this checklist — they require a human with access to the relevant npm account.
