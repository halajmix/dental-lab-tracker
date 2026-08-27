# Local RLS tests

Role-based RLS/trigger tests that a client-side fetch-mock harness cannot cover.
Run against a throwaway Postgres (colima + docker):

```bash
docker run --rm -d --name pgtest -e POSTGRES_PASSWORD=pg postgres:15
docker exec -i pgtest psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/stub.sql
# apply the phase block under test (extracted from schema.sql), then:
docker exec -i pgtest psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/test56.sql
docker rm -f pgtest
```

stub.sql fabricates the auth schema (auth.uid() reads request.jwt.claim.sub),
the roles, and the pre-phase tables/policies/triggers a phase expects to exist.
Identity per scenario: set_config('request.jwt.claim.sub', <uuid>) + set role authenticated.
