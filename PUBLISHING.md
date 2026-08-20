# Publishing checklist

This package is **not published yet**. Before running `npm publish` for real, work through
this list.

## Open decisions

1. ~~**Package name / scope**~~ — done: the original candidate `nestjs-typeorm-pagination`
   was technically free on npm (`npm view` returns E404), but a near-identical existing
   package, `nestjs-typeorm-paginate` (unrelated, narrower in scope — just builds a
   pagination object, no dynamic filtering/search/FindOperator support), made that name too
   confusable. Settled on the unscoped name `nestjs-pagination-toolkit` instead — distinct
   from the existing package, still leads with "pagination" for discoverability, and "toolkit"
   is intentional: more features (beyond pagination/filtering/sorting/search) are planned.
   Published unscoped (no npm org/user scope), so no `--access public` flag is needed at
   publish time (step 8 below reflects this).
2. ~~**Author name**~~ — done: `package.json`'s `"author"` and `LICENSE`'s copyright line
   are both set to "Shubham Sharma".
3. ~~**Repository / homepage / bugs URLs**~~ — done: the repo is public at
   [github.com/shubhamskatel/nestjs-pagination-toolkit](https://github.com/shubhamskatel/nestjs-pagination-toolkit)
   (renamed to match the package), and `package.json`'s `repository`/`homepage`/`bugs`
   fields point there. CI (`.github/workflows/ci.yml`) is confirmed green on `main`.

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
8. Publish: `npm publish` (unscoped package, no `--access` flag needed).
9. After publishing, verify the package page on npmjs.com renders correctly (README,
   license, repository link) and that `npm install <package-name>` works in a scratch
   project.

None of the above steps (account creation, `npm login`, `npm publish`) have been performed
as part of this checklist — they require a human with access to the relevant npm account.
