# actual-up-api

## This script pulls data from the [Up API](https://up.com.au/) and translates it into a format compatible with [Actual](https://actualbudget.org/)

> Status: Archived — this repository is no longer actively maintained. Issues and pull requests may not be reviewed. Use at your own risk; the code remains available for reference.

## Why is this archived?

I stopped using this because Actual’s performance degrades severely at scale. With years of transaction history, the app lacks thread-aware processing and becomes unresponsive, making day-to-day use impractical.



To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```
