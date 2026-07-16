-- =====================================================================
-- FASE 1 (parte 3 de 4): RLS (as regras de acesso)
--
-- RLS = Row Level Security. E o cadeado do banco.
-- Sem ele, qualquer pessoa com a chave anonima (que fica publica no HTML)
-- conseguiria ler os seus leads. Com ele, so quem esta logado no painel le.
--
-- As Edge Functions usam a chave de service_role, que passa por cima do
-- RLS. Por isso elas continuam conseguindo escrever normalmente.
-- =====================================================================

-- Liga o cadeado em todas as tabelas.
alter table ig_automations  enable row level security;
alter table ig_leads        enable row level security;
alter table ig_deliveries   enable row level security;
alter table ig_send_queue   enable row level security;
alter table ig_send_budget  enable row level security;
alter table ig_scheduled    enable row level security;
alter table ig_assets       enable row level security;
alter table ig_token_status enable row level security;
alter table ig_bot_sends    enable row level security;


-- ---------------------------------------------------------------------
-- Quem esta logado no painel pode ler e escrever.
-- Quem NAO esta logado (anon) nao ve nada.
-- ---------------------------------------------------------------------

drop policy if exists "painel_automations" on ig_automations;
create policy "painel_automations" on ig_automations
  for all to authenticated using (true) with check (true);

drop policy if exists "painel_leads" on ig_leads;
create policy "painel_leads" on ig_leads
  for all to authenticated using (true) with check (true);

drop policy if exists "painel_deliveries" on ig_deliveries;
create policy "painel_deliveries" on ig_deliveries
  for all to authenticated using (true) with check (true);

drop policy if exists "painel_queue" on ig_send_queue;
create policy "painel_queue" on ig_send_queue
  for all to authenticated using (true) with check (true);

drop policy if exists "painel_scheduled" on ig_scheduled;
create policy "painel_scheduled" on ig_scheduled
  for all to authenticated using (true) with check (true);

drop policy if exists "painel_assets" on ig_assets;
create policy "painel_assets" on ig_assets
  for all to authenticated using (true) with check (true);

drop policy if exists "painel_token" on ig_token_status;
create policy "painel_token" on ig_token_status
  for select to authenticated using (true);

-- O contador do freio: o painel so LE (pra mostrar a saude).
-- Quem escreve nele sao as funcoes do freio.
drop policy if exists "painel_budget_leitura" on ig_send_budget;
create policy "painel_budget_leitura" on ig_send_budget
  for select to authenticated using (true);

-- ig_bot_sends e coisa interna do robo: o painel nem precisa ver.
-- (RLS ligado e nenhuma policy = so o service_role acessa.)


-- ---------------------------------------------------------------------
-- CONFERINDO: rode isto pra ver se ficou tudo trancado.
-- A coluna rowsecurity precisa vir "true" em todas as linhas.
--
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename like 'ig_%';
-- ---------------------------------------------------------------------
