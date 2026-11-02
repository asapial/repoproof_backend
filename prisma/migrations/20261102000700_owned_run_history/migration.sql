-- Narrow read-only projection for the authenticated application service.
-- Caller ownership always comes from the server's authoritative session.
CREATE FUNCTION public.repoproof_history_v1(p_owner text, p_before timestamptz, p_before_id text, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE result jsonb;
BEGIN
  IF p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9_-]{1,128}$' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 25
     OR (p_before IS NULL) <> (p_before_id IS NULL)
     OR (p_before IS NOT NULL AND (NOT isfinite(p_before) OR p_before_id !~ '^[A-Za-z0-9_-]{1,128}$')) THEN
    RAISE EXCEPTION 'invalid history parameters' USING ERRCODE = '22023';
  END IF;
  WITH owned AS MATERIALIZED (
    SELECT r.id, r.state, r."createdAt", r."startedAt", r."finishedAt", r."baseSha", r."repositoryId",
           i.number, left(i.title, 160) AS title
    FROM public."Run" r
    JOIN public."Repository" repo ON repo.id = r."repositoryId"
    JOIN public."IssueSnapshot" i ON i.id = r."issueSnapshotId" AND i."repositoryId" = repo.id
    WHERE r."userId" = p_owner AND repo."mvpAllowed" = true
      AND repo."fullName" = 'asapial/repoproof_backend' AND repo."fixtureKey" = 'discount-bug'
      AND r."fixtureKey" = 'discount-bug' AND i.number = 1
      AND r."baseSha" = '1066351c5b07bed024775a16af9151048a9316b2'
  ), selected AS (
    SELECT * FROM owned
    WHERE p_before IS NULL OR ("createdAt", id COLLATE "C") < (p_before AT TIME ZONE 'UTC', p_before_id COLLATE "C")
    ORDER BY "createdAt" DESC, id COLLATE "C" DESC LIMIT p_limit + 1
  ), visible AS (
    SELECT * FROM selected ORDER BY "createdAt" DESC, id COLLATE "C" DESC LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'summary', (SELECT jsonb_build_object(
      'total', count(*),
      'running', count(*) FILTER (WHERE state NOT IN ('AWAITING_APPROVAL','COMPLETED','FAILED','CANCELLED')),
      'awaitingApproval', count(*) FILTER (WHERE state = 'AWAITING_APPROVAL'),
      'completed', count(*) FILTER (WHERE state = 'COMPLETED'),
      'failed', count(*) FILTER (WHERE state = 'FAILED'),
      'cancelled', count(*) FILTER (WHERE state = 'CANCELLED'),
      'repositories', count(DISTINCT "repositoryId"), 'submittedIssues', count(DISTINCT ("repositoryId", number))) FROM owned),
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'repository', 'asapial/repoproof_backend', 'issueNumber', number, 'issueTitle', title,
      'baseSha', "baseSha", 'state', state,
      'createdAt', to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'startedAt', to_char("startedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'finishedAt', to_char("finishedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ORDER BY "createdAt" DESC, id COLLATE "C" DESC) FROM visible), '[]'::jsonb),
    'hasMore', (SELECT count(*) > p_limit FROM selected)) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.repoproof_history_v1(text, timestamptz, text, integer) FROM PUBLIC;
