-- Marketplace browse queries now filter out products whose seller has not
-- completed identity verification. That predicate reads users."verificationStatus",
-- which anon could not SELECT (anon only had id/name/approvalStatus/role), so
-- public marketplace/categories/product-detail requests failed with
-- "permission denied for column verificationStatus".
--
-- Grant anon SELECT on the single additional column. Row visibility remains
-- restricted by the existing agricoop_mkt_users_anon_public_seller RLS policy,
-- so anon can only read it for publicly visible approved sellers.

GRANT SELECT ("verificationStatus") ON TABLE agricoop_app.users TO anon;
