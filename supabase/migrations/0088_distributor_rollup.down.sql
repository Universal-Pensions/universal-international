-- 0088_distributor_rollup.down.sql
-- Drops the per-distributor rollup. ViewDistributors must be reverted in the
-- same change (it renders `useDistributorRollup`); without the frontend revert
-- every row's Branches/Agents/Subscribers/AUM silently renders 0, because the
-- hook's error path yields an empty map and each row falls back to `?? 0`.

DROP FUNCTION IF EXISTS public.get_distributor_rollup();
