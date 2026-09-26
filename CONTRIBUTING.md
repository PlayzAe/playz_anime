# Contributing to PlayzAnime

Thanks for your interest. This guide covers setup, branch conventions, and code rules.

---

## Local development setup

Requires [Node.js](https://nodejs.org/) >= 20 and npm.

Install and run:

    npm install
    npm install --prefix server
    npm run dev                    # Terminal 1: Vite frontend at :5311
    npm --prefix server run dev    # Terminal 2: Node server at :5310

Copy .env.example to .env before starting the server.

---

## Branch conventions

| Branch name | Purpose |
|---|---|
| ix/<desc> | Bug fixes |
| eat/<desc> | New features |
| efactor/<desc> | Code structure |
| docs/<desc> | Documentation |
| ci/<desc> | CI/CD changes |

Branch off main. One concern per branch.

---

## Commit messages

Lowercase imperative mood:

    fix: hero pager auto-scrolls when cursor leaves section
    feat: add keyboard navigation to hero carousel
    refactor: split Home.tsx into sub-components
    docs: move internal docs to docs/ folder

---

## Code rules

- TypeScript everywhere - no ny unless unavoidable
- CSS stays vanilla - no Tailwind, no CSS-in-JS
- No new dependencies without good reason
- No ads. No trackers. No telemetry.

---

## Checks before pushing

    npm run typecheck
    npm run lint

---

## Pull requests

1. One PR per change.
2. Describe **why** the change is needed.
3. Reference issues: Closes #12.
4. Typecheck and lint must pass.

