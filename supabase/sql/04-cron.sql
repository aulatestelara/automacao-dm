-- =====================================================================
-- FASE 1 (parte 4 de 4): OS ROBOS AGENDADOS (pg_cron)
--
-- Dois robos rodam sozinhos dentro do banco:
--   ig-scheduler     a cada 1 minuto  (esvazia a fila e manda os atrasos)
--   ig-token-refresh 1x por semana    (renova o token do Instagram)
--
-- ANTES DE RODAR: troque os 3 placeholders abaixo.
-- =====================================================================

-- O pg_cron agenda. O pg_net e o que permite ao banco chamar uma URL
-- (sem ele, o agendamento nao consegue falar com a Edge Function).
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- =====================================================================
-- TROQUE ESTES VALORES:
--
--   SEU_PROJETO_AQUI  = a referencia do seu projeto Supabase.
--                       Esta na URL: https://XXXXXXXX.supabase.co
--                       (a parte XXXXXXXX)
--
--   SEU_SCHED_SECRET_AQUI = a senha que voce inventou pro SCHED_SECRET.
--                       Precisa ser IGUAL a que voce colocou nos segredos
--                       das Edge Functions. Gere uma boa assim, no terminal:
--                         openssl rand -hex 16
-- =====================================================================


-- ---------------------------------------------------------------------
-- ROBO 1: ig-scheduler, a cada 1 minuto.
-- E o carteiro: pega o que ficou na fila do freio e manda quando abre
-- espaco, e envia os passos com atraso que ja venceram.
-- ---------------------------------------------------------------------
select cron.schedule(
  'ig-scheduler',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://SEU_PROJETO_AQUI.supabase.co/functions/v1/ig-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sched-key',  'SEU_SCHED_SECRET_AQUI'
    ),
    body    := '{}'::jsonb
  );
  $$
);


-- ---------------------------------------------------------------------
-- ROBO 2: ig-token-refresh, toda segunda as 6h (horario UTC).
-- O token do Instagram vence em cerca de 60 dias. Este robo estende o
-- prazo antes de vencer, entao voce nunca precisa lembrar disso.
-- ---------------------------------------------------------------------
select cron.schedule(
  'ig-token-refresh',
  '0 6 * * 1',
  $$
  select net.http_post(
    url     := 'https://SEU_PROJETO_AQUI.supabase.co/functions/v1/ig-token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sched-key',  'SEU_SCHED_SECRET_AQUI'
    ),
    body    := '{}'::jsonb
  );
  $$
);


-- ---------------------------------------------------------------------
-- CONFERINDO SE OS ROBOS ESTAO DE PE
--
-- 1. Ver os agendamentos criados:
--      select jobid, jobname, schedule, active from cron.job;
--
-- 2. Ver se as ultimas rodadas deram certo (status "succeeded"):
--      select jobid, status, start_time, return_message
--      from cron.job_run_details order by start_time desc limit 10;
--
-- 3. Ver a RESPOSTA que a Edge Function devolveu (o mais util de todos).
--    Espere passar 1 minuto depois de agendar e rode:
--      select id, status_code, content, created
--      from net._http_response order by created desc limit 5;
--
--    Voce quer ver status_code = 200. Se vier 401, o x-sched-key nao bate
--    com o SCHED_SECRET dos segredos. Se vier 404, a funcao nao foi
--    publicada ainda ou o nome do projeto na URL esta errado.
--
-- PRA APAGAR UM AGENDAMENTO (se precisar refazer):
--      select cron.unschedule('ig-scheduler');
--      select cron.unschedule('ig-token-refresh');
-- ---------------------------------------------------------------------
