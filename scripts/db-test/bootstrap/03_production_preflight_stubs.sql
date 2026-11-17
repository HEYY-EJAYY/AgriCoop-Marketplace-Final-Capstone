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
  SELECT NULL::text
$$;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO PUBLIC;

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
