# Contributing

Thanks for looking. A few things keep the project the way it is:

- **No build step and no runtime dependency.** The site is plain ES modules served as they are. Please
  keep it that way.
- **No invented data.** Every figure on the site comes from a real read. When a read fails, the page says
  so (NO READ, "not answering") instead of filling a gap.
- **Rules decide, models explain.** Language models may explain or give a labelled second opinion; they
  never change a score or open a trade.
- **Run the tests.** `npm test` checks the syntax of every script and runs the unit tests, with no
  network and nothing to install.

## Local setup

```sh
npm run dev     # http://localhost:8791
npm test
```

Keys are optional; see the README. Never commit `.env.local` or `.dev.vars`.

## Pull requests

Keep a change to one thing, say what it changes for a visitor, and include a screenshot when it changes
how a page looks.