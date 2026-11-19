-- Stubs so production migration preflights can succeed on a disposable DB.
CREATE TABLE IF NOT EXISTS public.cooperatives (
  cooperative_id uuid PRIMARY KEY
);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_id_fkey
  FOREIGN KEY (role_id) REFERENCES public.roles(role_id);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_cooperative_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_cooperative_id_fkey
  FOREIGN KEY (cooperative_id) REFERENCES public.cooperatives(cooperative_id);

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT roles.role_name
  FROM public.profiles
  JOIN public.roles ON roles.role_id = profiles.role_id
  WHERE profiles.user_id = auth.uid()
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO PUBLIC;

CREATE POLICY "anyone can view active products"
  ON public.products FOR SELECT TO public
  USING (
    status = 'active'
    OR seller_id = auth.uid()
    OR public.get_my_role() = ANY (ARRAY['coop_officer'::text, 'system_admin'::text])
  );
CREATE POLICY "sellers create own products"
  ON public.products FOR INSERT TO public
  WITH CHECK (seller_id = auth.uid());
CREATE POLICY "sellers/officers update products"
  ON public.products FOR UPDATE TO public
  USING (
    seller_id = auth.uid()
    OR public.get_my_role() = ANY (ARRAY['coop_officer'::text, 'system_admin'::text])
  );

CREATE POLICY "view inventory"
  ON public.inventory FOR SELECT TO public
  USING (true);
CREATE POLICY "sellers/officers manage inventory"
  ON public.inventory FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1
      FROM public.products
      WHERE products.product_id = inventory.product_id
        AND (
          products.seller_id = auth.uid()
          OR public.get_my_role() = ANY (ARRAY['coop_officer'::text, 'system_admin'::text])
        )
    )
  );

CREATE POLICY "admin views logs"
  ON public.activity_logs FOR SELECT TO public
  USING (public.get_my_role() = 'system_admin');
CREATE POLICY "system inserts logs"
  ON public.activity_logs FOR INSERT TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "view own or officer/admin view all" ON public.profiles;

CREATE POLICY "users insert own profile"
  ON public.profiles FOR INSERT TO public
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users update own profile"
  ON public.profiles FOR UPDATE TO public
  USING (user_id = auth.uid());

CREATE POLICY "view own or officer/admin view all"
  ON public.profiles FOR SELECT TO public
  USING ((user_id = auth.uid()) OR (get_my_role() = ANY (ARRAY['coop_officer'::text, 'system_admin'::text])));
