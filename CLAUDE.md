# Agent House

Cloudflare Worker (`apps/api`, Hono) serving the API and a single-file React site (`apps/web`) at www.ejtech.co.uk.
Commands, deploys and rollback are in the README ("Deploying").

## Shipping rules

1. **Start from what's live.** Before starting any work, run `git fetch` and `npm run whats-live`. Then branch from up-to-date `main`.
2. **Every piece of work ends with a pull request to `main`.** Merging to `main` is the only way production changes: the Deploy workflow runs after CI passes on `main`. Never push to `main` directly.
3. **Done means live.** Never say done, shipped or live unless both are true:
   - the Deploy workflow for the merge passed
   - `https://www.ejtech.co.uk/api/version` reports the merged SHA

   Pushed is not done, and passing tests is not done.
4. **Check the crons after any deploy.** Confirm the cron schedules on the Worker match `wrangler.toml`:
   - run `npm run check-crons`, or read the "Crons" section of the deploy job summary
   - wrangler can put new code live while failing to attach its crons, and then no scheduled job runs
5. **Say which workspace your UI work touches.** The signed-in workspace still uses the old shell (`OsShell` pages), and only signed-out visitors see the new workspace (`apps/web/src/workspace`). Any UI work must state whether it affects signed-in, signed-out, or both.
6. **Final report.** Every piece of work ends with a report that gives:
   - the branch
   - the PR link
   - merged: yes or no
   - the deployed SHA
   - the live verification: `/api/version`, `npm run whats-live` and `npm run check-crons`
