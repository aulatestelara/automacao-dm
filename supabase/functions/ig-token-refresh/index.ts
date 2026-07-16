// =====================================================================
// ig-token-refresh: RENOVA O TOKEN
//
// O token do Instagram vence em cerca de 60 dias. Se vencer, o sistema
// inteiro para de funcionar de repente, sem aviso.
//
// Este robo roda 1x por semana (o pg_cron chama) e estende o prazo por
// mais 60 dias. Voce nunca precisa lembrar disso.
//
// DETALHE TECNICO: este endpoint e o unico SEM a versao no caminho.
// As outras chamadas usam /v21.0/..., esta usa a raiz mesmo.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IG_ACCESS_TOKEN = Deno.env.get('IG_ACCESS_TOKEN') ?? ''
const SCHED_SECRET    = Deno.env.get('SCHED_SECRET') ?? ''

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

async function anota(dados: Record<string, unknown>) {
  try {
    await db.from('ig_token_status').upsert({
      id: 'main', ...dados, updated_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[token] nao consegui anotar o status:', e)
  }
}

Deno.serve(async (req) => {
  const chave = req.headers.get('x-sched-key')
  if (!SCHED_SECRET || chave !== SCHED_SECRET) {
    return new Response(JSON.stringify({ erro: 'nao autorizado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!IG_ACCESS_TOKEN) {
    await anota({ last_ok: false, last_error: 'IG_ACCESS_TOKEN nao esta configurado' })
    return new Response(JSON.stringify({ erro: 'sem token configurado' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // Sem a versao no caminho, de proposito. E assim que este endpoint e.
    const url = new URL('https://graph.instagram.com/refresh_access_token')
    url.searchParams.set('grant_type', 'ig_refresh_token')
    url.searchParams.set('access_token', IG_ACCESS_TOKEN)

    const r = await fetch(url.toString())
    const dados = await r.json().catch(() => ({}))

    if (!r.ok || !dados?.access_token) {
      const msg = dados?.error?.message ?? `HTTP ${r.status}`
      console.error('[token] a renovacao falhou:', msg)
      await anota({ last_ok: false, last_error: msg })
      return new Response(JSON.stringify({ ok: false, erro: msg }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // expires_in vem em segundos (cerca de 60 dias)
    const venceEm = new Date(Date.now() + (dados.expires_in ?? 0) * 1000)
    const dias = Math.round((dados.expires_in ?? 0) / 86400)

    await anota({
      last_ok: true,
      last_error: null,
      expires_at: venceEm.toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })

    console.log(`[token] renovado, vence em ${dias} dias (${venceEm.toISOString()})`)

    // IMPORTANTE: o Instagram devolve um token NOVO aqui. Na pratica ele
    // costuma ser o mesmo texto, mas se um dia mudar, voce precisa colar
    // o novo valor no segredo IG_ACCESS_TOKEN. Por isso este aviso no log:
    if (dados.access_token !== IG_ACCESS_TOKEN) {
      console.warn('[token] ATENCAO: veio um token DIFERENTE. Atualize o segredo ' +
                   'IG_ACCESS_TOKEN nas Edge Functions com o novo valor.')
    }

    return new Response(JSON.stringify({ ok: true, expira_em: venceEm.toISOString(), dias }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[token] erro:', e)
    await anota({ last_ok: false, last_error: String(e) })
    return new Response(JSON.stringify({ ok: false, erro: String(e) }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
