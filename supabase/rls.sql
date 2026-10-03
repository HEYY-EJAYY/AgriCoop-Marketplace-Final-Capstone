-- AgriCoop RLS baseline for the eventual Supabase/Postgres cutover.
-- Assumes local profiles have auth_user_id UUID references to auth.users(id).

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.current_cooperative_id()
returns bigint language sql stable security definer set search_path = public as $$
  select cooperative_id from public.users where auth_user_id = auth.uid() limit 1;
$$;

alter table public.users enable row level security;
alter table public.cooperatives enable row level security;
alter table public.products enable row level security;
alter table public.quotations enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.transactions enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

create policy users_self_or_admin on public.users for select using (auth_user_id = auth.uid() or public.current_app_role() in ('admin','superadmin'));
create policy users_admin_update on public.users for update using (public.current_app_role() in ('admin','superadmin'));
create policy active_cooperatives_public_read on public.cooperatives for select using (status = 'active' or public.current_app_role() in ('admin','superadmin'));

create policy marketplace_products_read on public.products for select using (status = 'published' and verification_status = 'approved' and visibility = 'visible');
create policy sellers_manage_own_products on public.products for all using (seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin')) with check (seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin'));
create policy admins_review_products on public.products for update using (public.current_app_role() in ('admin','superadmin'));

create policy quotation_participants_read on public.quotations for select using (buyer_id in (select id from public.users where auth_user_id = auth.uid()) or seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin'));
create policy buyers_create_quotations on public.quotations for insert with check (buyer_id in (select id from public.users where auth_user_id = auth.uid()));
create policy sellers_respond_quotations on public.quotations for update using (seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin'));

create policy order_participants_read on public.orders for select using (buyer_id in (select id from public.users where auth_user_id = auth.uid()) or seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin'));
create policy buyers_create_orders on public.orders for insert with check (buyer_id in (select id from public.users where auth_user_id = auth.uid()));
create policy sellers_update_orders on public.orders for update using (seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin'));
create policy order_items_participant_read on public.order_items for select using (order_id in (select id from public.orders));
create policy transaction_participant_read on public.transactions for select using (buyer_id in (select id from public.users where auth_user_id = auth.uid()) or seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin'));

create policy conversation_participants_read on public.conversations for select using (buyer_id in (select id from public.users where auth_user_id = auth.uid()) or seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin'));
create policy conversation_participants_insert on public.conversations for insert with check (buyer_id in (select id from public.users where auth_user_id = auth.uid()) or seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin'));
create policy conversation_messages_participant_read on public.conversation_messages for select using (conversation_id in (select id from public.conversations));
create policy conversation_messages_participant_insert on public.conversation_messages for insert with check (sender_id in (select id from public.users where auth_user_id = auth.uid()) and conversation_id in (select id from public.conversations where buyer_id in (select id from public.users where auth_user_id = auth.uid()) or seller_id in (select id from public.users where auth_user_id = auth.uid()) or public.current_app_role() in ('admin','superadmin')));
