// The database's half of a public document (src/public-document.ts): what anyone with no login is given of one,
// through a function that sees everything and gives as little as it can. Kept apart, with no imports, so the schema's
// steps (src/migrate.ts) can be read without the code that reads them.

/** Step 9 (src/migrate.ts): a public document, read by anyone with no login. */
export const PUBLIC_DOCUMENT = `
-- A public document as anyone reads it: the document, when it is public, not archived, private to nobody and of a type
-- read whole (the server names those, as its packs' screens say: a project's note is never given here), and of the
-- items its note brings in by a line holding only their id, those it holds (part_of it), with their notes, and those
-- public in their own right, with only what is public of them: a title and a state. Nothing private, to anyone or
-- marked so in a workspace of one: a section is shown once it is shared with the workspace.
create or replace function pelago_public_document(target text, readable text[]) returns jsonb
language sql stable security definer set search_path = public as $fn$
  with d as (
    select e.* from entity e
    where e.id = target and e.visibility = 'public' and e.archived_at is null and e.private_to is null and e.type = any(readable)
  ),
  named as (
    select distinct m[1] as id from d, regexp_matches(d.body, '^[ \\t]*(e_[a-z0-9]{8})[ \\t]*$', 'gn') as m
  ),
  brought as (
    select i.*, exists (select 1 from relation r where r.type = 'part_of' and r.valid_to is null and r.from_id = i.id and r.to_id = d.id) as held
    from entity i join named n on n.id = i.id, d
    where i.archived_at is null and i.workspace = d.workspace and i.private_to is null and i.visibility <> 'private'
  ),
  items as (
    select b.id, b.type, b.title, b.status, case when b.held then b.body else '' end as body, b.updated_at,
           exists (select 1 from picture p where p.entity_id = b.id) as picture
    from brought b where b.held or pelago_is_public(b.id)
  )
  select jsonb_build_object(
    'id', d.id, 'type', d.type, 'title', d.title, 'body', d.body, 'status', d.status, 'props', d.props, 'updated_at', d.updated_at,
    'items', coalesce((select jsonb_agg(to_jsonb(items)) from items), '[]'::jsonb))
  from d
$fn$;
-- The figure of one item a public document shows, and of nothing else.
create or replace function pelago_public_document_picture(target text, readable text[], section text)
returns table (content_type text, bytes bytea)
language sql stable security definer set search_path = public as $fn$
  select p.content_type, p.bytes from picture p
  where p.entity_id = section
    and exists (select 1 from jsonb_array_elements(pelago_public_document(target, readable) -> 'items') i where i ->> 'id' = section)
$fn$;
grant execute on function pelago_public_document(text, text[]), pelago_public_document_picture(text, text[], text) to pelago_public;
`;

/** Step 10 (src/migrate.ts): what a public document said when it was last published, read in place of the map. */
export const PUBLISHED = `
-- A document as it was published: what a reader is given of it (its text, its sections, its pictures' data), frozen
-- by the person who published it. The draft is edited on the map; nothing public changes until it is published again.
create table if not exists published (
  entity_id    text primary key references entity(id),
  workspace    text not null default 'default',
  given        jsonb not null,
  published_by text not null,
  published_at timestamptz not null default now()
);
grant select, insert, update, delete on published to pelago_member;
alter table published enable row level security;
drop policy if exists member_published on published;
create policy member_published on published for all to pelago_member
  using (entity_id in (select id from entity))
  with check (entity_id in (select id from entity));

-- A published document as anyone reads it: its revision, while the document is public, not archived, private to
-- nobody and of a type read whole. Nothing of the map as it is now but those four facts.
create or replace function pelago_published(target text, readable text[]) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select p.given || jsonb_build_object('published_at', p.published_at)
  from published p join entity e on e.id = p.entity_id
  where p.entity_id = target and e.visibility = 'public' and e.archived_at is null and e.private_to is null and e.type = any(readable)
$fn$;
-- The figure of one section a published document holds, and of nothing else.
create or replace function pelago_published_picture(target text, readable text[], section text)
returns table (content_type text, bytes bytea)
language sql stable security definer set search_path = public as $fn$
  select p.content_type, p.bytes from picture p
  where p.entity_id = section and pelago_published(target, readable) -> 'sections' ? section
$fn$;
grant execute on function pelago_published(text, text[]), pelago_published_picture(text, text[], text) to pelago_public;
`;

/** Step 11 (src/migrate.ts): a published document's address word and its place in the site's header. */
export const PUBLISHED_PATH = `
-- Kept with the revision, as everything public is: a new path or place takes effect when it is published again.
alter table published add column if not exists path text;
alter table published add column if not exists menu double precision;
create unique index if not exists published_path on published (path) where path is not null;

-- The published document at an address word, as anyone reads it: the same four facts as pelago_published hold.
create or replace function pelago_published_at(at_path text, readable text[]) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select p.given || jsonb_build_object('id', p.entity_id, 'path', p.path, 'published_at', p.published_at)
  from published p join entity e on e.id = p.entity_id
  where p.path = at_path and e.visibility = 'public' and e.archived_at is null and e.private_to is null and e.type = any(readable)
$fn$;
-- The site's published pages, for its header and its sitemap: each one's id, title as published, path and place.
create or replace function pelago_site_pages(readable text[]) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.entity_id, 'title', p.given ->> 'title', 'path', p.path, 'menu', p.menu, 'published_at', p.published_at)
    order by p.menu nulls last, p.given ->> 'title'), '[]'::jsonb)
  from published p join entity e on e.id = p.entity_id
  where e.visibility = 'public' and e.archived_at is null and e.private_to is null and e.type = any(readable)
$fn$;
grant execute on function pelago_published_at(text, text[]), pelago_site_pages(text[]) to pelago_public;
`;
