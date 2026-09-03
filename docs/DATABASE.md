# Database environments

Supabase project `ckrybfpctqqrijrvmnhb` (`pokemon-card-sim`, `eu-west-2`) is the
canonical database for this project. The app uses Drizzle over PostgreSQL, so
the same server-side game and ledger code runs locally and in production.

## Localhost modes

Normal development must use the confirmed Supabase project:

```dotenv
# .env.local at the repository root; ignored by Git
DATABASE_URL=postgresql://postgres.ckrybfpctqqrijrvmnhb:PASSWORD@POOLER:5432/postgres?sslmode=require
```

Get the exact direct or Session pooler URL from the Supabase dashboard's
**Connect** panel. Do not commit it. Then start and verify localhost:

```bash
npm run dev
curl http://localhost:3000/api/health/database
```

The health response must report `"mode":"supabase"` and project ref
`ckrybfpctqqrijrvmnhb`. `npm run dev` fails fast if `DATABASE_URL` is missing or
points at another project.

For destructive experiments, fixtures, or isolated UI tests, use the explicit
mock mode instead:

```bash
npm run dev:mock
curl http://localhost:3000/api/health/database
```

That response must report `"mode":"mock"`. Mock mode uses PGlite and must not be
presented as verification of Supabase state.

## Agent database rules

- Agents have authenticated Supabase tooling for the canonical project. Verify
  the live schema before preparing a database change.
- Apply every approved schema or data change to Supabase, then run a live query
  that proves it took effect. A local migration file by itself is incomplete.
- Keep the matching migration or schema change in the repository so a fresh
  mock database and the canonical database do not drift.
- Never print, commit, or expose `DATABASE_URL`, database passwords, service-role
  keys, or access tokens.
- Never reset the remote database from a local test command. `db:reset` refuses
  to run when `DATABASE_URL` is set.
- The public Supabase schema currently has RLS disabled. Do not enable it without
  designing and approving the complete policies first, because enabling RLS
  alone would block the server's current access path.

Supabase's current connection guidance recommends a direct connection for a
long-lived backend when IPv6 is available, or the Session pooler on IPv4-only
networks. Use SSL in either case.
