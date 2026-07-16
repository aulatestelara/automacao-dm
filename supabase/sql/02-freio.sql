-- =====================================================================
-- FASE 1 (parte 2 de 4): AS FUNCOES DO FREIO
--
-- ATENCAO, ESTE E O PASSO QUE NAO PODE FALTAR.
-- O freio conta quantas DMs sairam por minuto, por hora e por dia, e
-- segura o resto na fila. Se estas duas funcoes nao existirem, o sistema
-- "falha fechado": NENHUMA DM por comentario sai, tudo vai pra fila e a
-- fila nunca anda. E um erro silencioso, sem mensagem na tela.
--
-- Os tetos sao propositalmente conservadores, bem abaixo do limite do
-- Instagram (que gira em torno de 200 a 300 respostas privadas por dia).
-- =====================================================================


-- ---------------------------------------------------------------------
-- take_send_slot: "posso enviar agora?"
-- Tenta pegar uma ficha de envio. Devolve true (pode) ou false (segura).
--
-- Como funciona, em portugues:
--   1. Tranca a linha do contador (FOR UPDATE), pra dois envios ao mesmo
--      tempo nao contarem errado.
--   2. Se o disjuntor esta pausado, devolve false na hora.
--   3. Zera os contadores das janelas que ja viraram (minuto, hora, dia).
--   4. Se estourou qualquer teto, devolve false.
--   5. Senao, soma 1 em cada contador e devolve true.
-- ---------------------------------------------------------------------
create or replace function take_send_slot(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  b       ig_send_budget%rowtype;
  agora   timestamptz := now();
begin
  -- 1. pega a linha do contador e TRANCA ate o fim da transacao.
  --    Sem esse FOR UPDATE, dois envios simultaneos leriam o mesmo numero
  --    e os dois passariam, furando o teto.
  select * into b from ig_send_budget where id = p_key for update;

  -- se a linha nao existe, cria uma na hora com os tetos padrao
  if not found then
    insert into ig_send_budget (id) values (p_key)
      on conflict (id) do nothing;
    select * into b from ig_send_budget where id = p_key for update;
  end if;

  -- 2. o disjuntor esta pausando os envios? entao nem tenta.
  if b.paused_until is not null and b.paused_until > agora then
    return false;
  end if;

  -- 3. virou o minuto / a hora / o dia? entao zera aquela janela.
  if agora - b.min_start >= interval '1 minute' then
    b.min_count := 0;
    b.min_start := agora;
  end if;

  if agora - b.hour_start >= interval '1 hour' then
    b.hour_count := 0;
    b.hour_start := agora;
  end if;

  if agora - b.day_start >= interval '1 day' then
    b.day_count := 0;
    b.day_start := agora;
  end if;

  -- 4. estourou algum teto? guarda pra depois (a fila manda quando abrir).
  if b.min_count  >= b.cap_minute
  or b.hour_count >= b.cap_hour
  or b.day_count  >= b.cap_day then
    -- grava as janelas que zeraram, mesmo negando, pra nao perder o reset
    update ig_send_budget set
      min_count = b.min_count,   min_start = b.min_start,
      hour_count = b.hour_count, hour_start = b.hour_start,
      day_count = b.day_count,   day_start = b.day_start,
      updated_at = agora
    where id = p_key;
    return false;
  end if;

  -- 5. tem ficha: soma 1 em cada janela e libera o envio.
  update ig_send_budget set
    min_count  = b.min_count + 1,  min_start  = b.min_start,
    hour_count = b.hour_count + 1, hour_start = b.hour_start,
    day_count  = b.day_count + 1,  day_start  = b.day_start,
    updated_at = agora
  where id = p_key;

  return true;
end;
$$;


-- ---------------------------------------------------------------------
-- record_send_result: "como foi o envio?"
-- Alimenta o disjuntor. Chame depois de cada envio.
--
--   p_ok   = true se a mensagem saiu, false se deu erro
--   p_hard = true se o erro foi "duro" (bloqueio, permissao, rate limit
--            da Meta). Erro duro conta pro disjuntor; erro bobo nao.
--
-- Regra: 3 falhas duras seguidas pausam os envios por 3 horas.
-- Qualquer envio ok zera a contagem de falhas.
-- ---------------------------------------------------------------------
create or replace function record_send_result(
  p_key  text,
  p_ok   boolean,
  p_hard boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  streak int;
begin
  if p_ok then
    -- deu certo: zera o disjuntor e tira qualquer pausa
    update ig_send_budget
      set err_streak = 0, paused_until = null, updated_at = now()
      where id = p_key;
    return;
  end if;

  -- erro leve (ex: a pessoa bloqueou voce): nao mexe no disjuntor
  if not p_hard then
    update ig_send_budget set updated_at = now() where id = p_key;
    return;
  end if;

  -- erro duro: soma uma falha seguida
  update ig_send_budget
    set err_streak = err_streak + 1, updated_at = now()
    where id = p_key
    returning err_streak into streak;

  -- 3 falhas duras seguidas: pausa tudo por 3 horas pra esfriar
  if streak is not null and streak >= 3 then
    update ig_send_budget
      set paused_until = now() + interval '3 hours',
          err_streak = 0,
          updated_at = now()
      where id = p_key;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- Quem pode chamar essas funcoes: so as Edge Functions (service_role).
-- O painel e o publico nao precisam mexer no freio.
-- ---------------------------------------------------------------------
revoke all on function take_send_slot(text) from public, anon, authenticated;
revoke all on function record_send_result(text, boolean, boolean) from public, anon, authenticated;
grant execute on function take_send_slot(text) to service_role;
grant execute on function record_send_result(text, boolean, boolean) to service_role;


-- ---------------------------------------------------------------------
-- TESTE RAPIDO (opcional). Descomente e rode pra ver o freio funcionando:
--
--   select take_send_slot('private_reply');  -- deve devolver true
--   select * from ig_send_budget;            -- min_count subiu pra 1
--   select record_send_result('private_reply', true, false);
--
-- Pra devolver o contador ao zero depois do teste:
--   update ig_send_budget set min_count=0, hour_count=0, day_count=0;
-- ---------------------------------------------------------------------
