alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select
  using ( id = auth.uid() );

create policy "profiles_insert_own"
  on public.profiles for insert
  with check ( id = auth.uid() );

create policy "profiles_update_own"
  on public.profiles for update
  using ( id = auth.uid() );

create or replace function public.get_my_organization_id()
returns uuid language sql security definer stable as $$
  select organization_id from public.profiles where id = auth.uid() limit 1;
$$;

alter table public.organizations enable row level security;

drop policy if exists "organizations_select_member" on public.organizations;
drop policy if exists "organizations_insert_member" on public.organizations;
drop policy if exists "organizations_update_member" on public.organizations;

create policy "organizations_select_member"
  on public.organizations for select
  using ( id = public.get_my_organization_id() );

create policy "organizations_insert_member"
  on public.organizations for insert
  with check ( true );

create policy "organizations_update_member"
  on public.organizations for update
  using ( id = public.get_my_organization_id() );

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'admin')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

select tablename, policyname, cmd
from pg_policies
where tablename in ('profiles', 'organizations')
order by tablename, policyname;
