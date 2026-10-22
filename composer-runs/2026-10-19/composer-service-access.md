# Composer service access

Nonsecret service base: `https://the-composer-svc.fly.dev`

- Published IDL: `GET /idl/{program_id}`
- Learned transaction schema: `GET /learn/{program_id}?limit={bounded_count}`

The service requires no credential for these reads. In this environment, direct sandboxed network calls fail; use approved network access. A cold request may take longer than 30 seconds, so use an explicit 60–180 second timeout. Save and hash the returned JSON, and independently validate discriminators, positional accounts, signer flags, and token-account relationships against a successful current receipt. Learned names can originate from another program sharing a discriminator, and a Composer quote or schema inference is not itself a finding.

Working examples from this run:

- `pancake-current-idl.json`
- `pancake-composer-learn.json`

