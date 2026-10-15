# Security

Shuntdesk holds no funds, no wallets and no private keys: every balance is paper. The keys it does hold
(data providers, the language-model gateway, the dataset token) live as Cloudflare secrets on the server
and never reach the browser.

## Reporting

Please report a vulnerability privately with a direct message to [@shuntdesk on X](https://x.com/shuntdesk),
or through GitHub's **Report a vulnerability** button on this repository. Include what you found, how to
reproduce it, and what it affects. Please do not open a public issue for it.

## In scope

- the Worker in server/worker.js and its endpoints under /api/
- the site in site/, including its Content Security Policy (site/_headers)
- anything that would let someone change the crew desk, the record or the published dataset

## Out of scope

- a verdict you disagree with: it is a rule-based reading and can be wrong, open an issue instead
- the third-party services Shuntdesk reads from
- rate limits being reached by heavy use