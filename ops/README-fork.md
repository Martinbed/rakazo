# This fork

`github.com/Martinbed/rakazo` is a fork of `github.com/elie222/rakazo`. It
carries upstream's code plus a small set of changes of our own, and it is what
the deployment on `hp-server` runs.

## What we changed, and why

| commit | change |
|---|---|
| `Rank a bot's active runs by state, not recency` | the sidebar took a bot's status from its *newest* active run, so a queued run behind a running one made a working bot read "Waiting in line…" |
| `A bot's own thread shows its own delegated work` | a bot's own thread excluded `bot_message` runs -- a peer-run rule applied to a thread that has no peers -- which hid the run and with it the Stop control |
| `Default an OpenAI-compatible connection to a 1M context window` | 32,768 left an agent with `contextWindow - outputReserve` tokens of history, which is not enough to keep anything between turns |
| `Retry on a dispatcher version mismatch` | an injected fetch that wraps the global one cannot accept this package's `Agent`; the request is now retried on the package's fetch |
| `FORK LOCAL: lowercase the image repository reference` | `github.repository` is `Martinbed/rakazo` and Docker rejects an uppercase path. Re-apply after syncing upstream. |

## Layout

- `origin` = this fork, `upstream` = elie222/rakazo
- `main` = upstream/main + our commits, rebased on top
- The image is built by the fork's own `publish-server-image.yml` and lands
  in `ghcr.io/martinbed/rakazo/{app,computer}:edge`

## Taking upstream's updates

    ops/sync-upstream.sh              # rebase, typecheck, test, build
    ops/sync-upstream.sh --deploy     # and roll the deployment onto it

Our commits are small and independent, so a rebase usually lands clean. When
it does not, the conflict is confined to one change, and the fix is to
re-apply that change by hand against upstream's current code.

Upstream moves quickly -- roughly 30 commits a day -- so this is a routine
step rather than an occasional one. Pinning is deliberately not used: the
fork exists to take upstream's updates, and the deployment runs a tagged
image so a rebuild is always reproducible.

## Before changing anything here

`apps/api` and `packages/db` have unit tests that run in the image:

    docker exec -u 0 -w /app <api-container> pnpm --filter @rakazo/api test

One test fails inside the live container and passes in a fresh one: the
voice test rejects a public server address, and the deployment's `.env`
gives the server one. It is not a code failure.
