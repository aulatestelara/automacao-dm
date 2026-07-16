-- =====================================================================
-- FASE 1 (parte 1 de 4): AS TABELAS
-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem medo (tudo usa "if not exists").
-- =====================================================================

-- Precisamos disso pra gerar os ids automaticos (uuid).
create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
-- ig_automations: cada automacao que voce cria no painel.
-- A conversa inteira (mensagem 1, botoes, proximos passos) mora no campo
-- "flow". Nao existe coluna separada de mensagem ou de link: tudo no flow.
-- ---------------------------------------------------------------------
create table if not exists ig_automations (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null default 'Nova automacao',
  -- palavras que ativam, separadas por virgula. Ex: "quero,eu quero,link"
  keyword               text default '',
  -- quando true, qualquer comentario ativa (ignora as palavras acima)
  match_any             boolean not null default false,
  active                boolean not null default true,
  -- posts em que a automacao vale. Vazio = vale pra todos os posts.
  media_ids             text[] not null default '{}',
  -- texto publico que responde quem comentou
  public_reply          text default '',
  -- variacoes A/B da resposta publica (o sistema sorteia entre elas)
  public_reply_variants text[] not null default '{}',
  -- a conversa inteira. Formato explicado no LEIA-ME (secao "o flow").
  flow                  jsonb not null default '{"steps":[]}'::jsonb,
  -- arquivos anexados (ids da tabela ig_assets)
  asset_ids             text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- so as automacoes ligadas interessam na hora de casar um comentario
create index if not exists ig_automations_active_idx
  on ig_automations (active) where active;


-- ---------------------------------------------------------------------
-- ig_leads: as pessoas que interagiram. Uma linha por pessoa.
-- ---------------------------------------------------------------------
create table if not exists ig_leads (
  ig_user_id    text primary key,
  username      text,
  -- de onde ela veio: comment, dm ou story_reply
  last_source   text,
  last_keyword  text,
  automation_id uuid references ig_automations(id) on delete set null,
  -- em que passo da conversa a pessoa esta (o id do passo, como texto)
  flow_step     text,
  link_sent     boolean not null default false,
  -- quando um passo pede um dado, guarda o que estamos esperando aqui.
  -- Ex: {"field":"email","next":3,"automation_id":"...","since":"..."}
  expecting     jsonb,
  -- dados capturados pela conversa (opcional)
  email         text,
  telefone      text,
  tags          text[] not null default '{}',
  -- ultima vez que a DM ok saiu pra essa pessoa (a regra do 1 por dia usa isso)
  last_dm_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists ig_leads_created_idx on ig_leads (created_at desc);


-- ---------------------------------------------------------------------
-- ig_deliveries: o log. Uma linha por tentativa de envio.
-- E aqui que voce descobre se algo nao saiu, e por que.
-- ---------------------------------------------------------------------
create table if not exists ig_deliveries (
  id            bigint generated always as identity primary key,
  ig_user_id    text,
  automation_id uuid,
  -- private_reply (resposta a comentario) ou dm
  canal         text,
  -- flow, link ou text
  tipo          text,
  -- ok, erro ou na_fila
  status        text not null default 'ok',
  motivo        text,
  ts            timestamptz not null default now()
);

create index if not exists ig_deliveries_ts_idx on ig_deliveries (ts desc);


-- ---------------------------------------------------------------------
-- ig_send_queue: a fila. Quando o freio nao deixa enviar na hora,
-- o envio para aqui e o robo ig-scheduler manda depois.
-- ---------------------------------------------------------------------
create table if not exists ig_send_queue (
  id            bigint generated always as identity primary key,
  -- unique: o mesmo comentario nunca entra duas vezes na fila
  comment_id    text unique not null,
  automation_id uuid,
  ig_user_id    text,
  username      text,
  -- pendente, enviado, erro ou expirado
  status        text not null default 'pendente',
  tentativas    int not null default 0,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  last_error    text
);

create index if not exists ig_send_queue_pendente_idx
  on ig_send_queue (created_at) where status = 'pendente';


-- ---------------------------------------------------------------------
-- ig_send_budget: O CONTADOR DO FREIO. Uma linha so.
-- As funcoes take_send_slot e record_send_result contam aqui dentro.
-- SEM ESSA TABELA O FREIO NAO TEM ONDE CONTAR E NENHUMA DM SAI.
-- ---------------------------------------------------------------------
create table if not exists ig_send_budget (
  id            text primary key,
  -- quantos envios ja sairam em cada janela
  min_count     int not null default 0,
  hour_count    int not null default 0,
  day_count     int not null default 0,
  -- quando cada janela comecou (serve pra zerar quando vira o minuto/hora/dia)
  min_start     timestamptz not null default now(),
  hour_start    timestamptz not null default now(),
  day_start     timestamptz not null default now(),
  -- quantas falhas duras (bloqueio) vieram seguidas
  err_streak    int not null default 0,
  -- os tetos. Bem abaixo do limite do Instagram, de proposito.
  cap_minute    int not null default 6,
  cap_hour      int not null default 60,
  cap_day       int not null default 180,
  -- quando o disjuntor esta pausando os envios
  paused_until  timestamptz,
  updated_at    timestamptz not null default now()
);

-- A linha inicial (seed) do freio. Sem ela, nada envia.
insert into ig_send_budget (id) values ('private_reply')
  on conflict (id) do nothing;
insert into ig_send_budget (id) values ('dm')
  on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- ig_scheduled: os passos com atraso ("depois de 10 min, manda isso").
-- ---------------------------------------------------------------------
create table if not exists ig_scheduled (
  id            bigint generated always as identity primary key,
  ig_user_id    text not null,
  automation_id uuid,
  step_id       text not null,
  send_at       timestamptz not null,
  sent          boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists ig_scheduled_due_idx
  on ig_scheduled (send_at) where not sent;


-- ---------------------------------------------------------------------
-- ig_assets: a biblioteca de arquivos (PDF, audio, foto, video).
-- ---------------------------------------------------------------------
create table if not exists ig_assets (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  -- image, audio, video ou file
  tipo          text not null,
  public_url    text not null,
  -- cache do id que o Instagram devolve depois do primeiro envio
  attachment_id text,
  size_bytes    bigint,
  created_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- ig_token_status: a saude do token do Instagram (vence em ~60 dias).
-- ---------------------------------------------------------------------
create table if not exists ig_token_status (
  id                text primary key,
  expires_at        timestamptz,
  last_ok           boolean,
  last_error        text,
  last_refreshed_at timestamptz,
  updated_at        timestamptz not null default now()
);

insert into ig_token_status (id) values ('main')
  on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- ig_bot_sends: os ids das mensagens que o PROPRIO sistema enviou.
-- Serve pra nao confundir um envio automatico com uma resposta sua
-- escrita na mao (o Instagram devolve as duas coisas como "echo").
-- ---------------------------------------------------------------------
create table if not exists ig_bot_sends (
  mid        text primary key,
  created_at timestamptz not null default now()
);

create index if not exists ig_bot_sends_created_idx on ig_bot_sends (created_at);
