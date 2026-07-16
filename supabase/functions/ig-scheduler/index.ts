// =====================================================================
// ig-scheduler: O CARTEIRO
//
// Roda sozinho a cada 1 minuto (o pg_cron chama). Faz duas coisas:
//   1. Esvazia a fila: o que o freio segurou, ele manda quando abre espaco.
//   2. Manda os passos com atraso que ja venceram.
//
// Protegida pelo SCHED_SECRET: quem chamar sem o header x-sched-key certo
// leva um 401. Pode ser publica (--no-verify-jwt) porque o segredo tranca.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IG_ACCESS_TOKEN = Deno.env.get('IG_ACCESS_TOKEN') ?? ''
const GRAPH_VERSION   = Deno.env.get('GRAPH_API_VERSION') ?? 'v21.0'
const SCHED_SECRET    = Deno.env.get('SCHED_SECRET') ?? ''
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

// Uma resposta a comentario so vale por cerca de 7 dias. Depois disso o
// Instagram recusa, entao nem tentamos: marcamos como expirado.
const DIAS_LIMITE = 7

type FlowButton = { title: string; next?: number | null; url?: string | null }
type FlowStep = {
  id: number
  message: string
  buttons?: FlowButton[]
  delay?: { seconds: number; next?: number | null }
  collect?: { field: string; next?: number | null }
}

async function chamaGraph(caminho: string, corpo: unknown) {
  try {
    const r = await fetch(`${GRAPH}/${caminho}?access_token=${IG_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    const dados = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = dados?.error?.message ?? `HTTP ${r.status}`
      const duro = r.status === 429 || r.status === 403
      return { ok: false, erro: msg, duro }
    }
    // guarda o id da mensagem que o robo mandou
    if (dados?.message_id) {
      try { await db.from('ig_bot_sends').upsert({ mid: dados.message_id }) } catch { /* ok */ }
    }
    return { ok: true, mid: dados?.message_id }
  } catch (e) {
    return { ok: false, erro: String(e), duro: false }
  }
}

// Monta os botoes do passo, igual o webhook faz.
function montaBotoes(autoId: string, passo: FlowStep) {
  return (passo.buttons ?? [])
    .filter((b) => b.title?.trim())
    .filter((b) => (b.url && b.url.trim()) || (b.next !== null && b.next !== undefined))
    .map((b) => {
      const titulo = b.title.trim().slice(0, 20)
      if (b.url?.trim()) return { type: 'web_url', url: b.url.trim(), title: titulo }
      return { type: 'postback', title: titulo, payload: `STEP:${autoId}:${b.next}` }
    })
}

// Envia um passo, com os mesmos 3 formatos do webhook (anexado, pilula, texto).
async function enviaPasso(destino: Record<string, string>, autoId: string, passo: FlowStep) {
  const texto = passo.message?.trim() || '...'
  const botoes = montaBotoes(autoId, passo)

  if (botoes.length) {
    const r1 = await chamaGraph('me/messages', {
      recipient: destino,
      message: {
        attachment: {
          type: 'template',
          payload: { template_type: 'button', text: texto, buttons: botoes.slice(0, 3) },
        },
      },
    })
    if (r1.ok) return r1

    const pilulas = botoes.slice(0, 13).map((b: any) => ({
      content_type: 'text',
      title: b.title,
      payload: b.type === 'postback' ? b.payload : `URL:${b.url}`,
    }))
    const r2 = await chamaGraph('me/messages', {
      recipient: destino,
      message: { text: texto, quick_replies: pilulas },
    })
    if (r2.ok) return r2
  }

  const comLink: any = botoes.find((b: any) => b.type === 'web_url')
  return await chamaGraph('me/messages', {
    recipient: destino,
    message: { text: comLink ? `${texto}\n\n${comLink.url}` : texto },
  })
}

async function pegaFicha(chave: string): Promise<boolean> {
  const { data, error } = await db.rpc('take_send_slot', { p_key: chave })
  if (error) {
    console.error('[freio] take_send_slot falhou. Rodou o 02-freio.sql?', error.message)
    return false
  }
  return data === true
}

// =====================================================================
// PARTE 1: esvaziar a fila do freio
// =====================================================================
async function esvaziaFila() {
  const { data: itens } = await db.from('ig_send_queue')
    .select('*').eq('status', 'pendente')
    .order('created_at', { ascending: true }).limit(50)

  let enviados = 0, expirados = 0

  for (const item of itens ?? []) {
    const idade = Date.now() - new Date(item.created_at).getTime()

    // velho demais: o Instagram nao aceita mais responder esse comentario
    if (idade > DIAS_LIMITE * 24 * 60 * 60 * 1000) {
      await db.from('ig_send_queue').update({
        status: 'expirado',
        last_error: `passou de ${DIAS_LIMITE} dias, fora da janela do Instagram`,
      }).eq('id', item.id)
      expirados++
      continue
    }

    // tem ficha agora?
    if (!(await pegaFicha('private_reply'))) {
      // ainda nao. Para por aqui e tenta de novo no proximo minuto.
      break
    }

    const { data: auto } = await db.from('ig_automations')
      .select('*').eq('id', item.automation_id).maybeSingle()

    const passo: FlowStep | undefined = auto?.flow?.steps?.[0]
    if (!auto || !passo) {
      await db.from('ig_send_queue').update({
        status: 'erro', last_error: 'a automacao ou o passo 1 nao existe mais',
      }).eq('id', item.id)
      continue
    }

    const r = await enviaPasso({ comment_id: item.comment_id }, auto.id, passo)
    await db.rpc('record_send_result', {
      p_key: 'private_reply', p_ok: r.ok, p_hard: (r as any).duro ?? false,
    })

    await db.from('ig_deliveries').insert({
      ig_user_id: item.ig_user_id, automation_id: auto.id,
      canal: 'private_reply', tipo: 'flow',
      status: r.ok ? 'ok' : 'erro',
      motivo: r.ok ? 'enviado pela fila' : (r as any).erro,
    })

    if (r.ok) {
      await db.from('ig_send_queue').update({
        status: 'enviado', sent_at: new Date().toISOString(),
      }).eq('id', item.id)
      await db.from('ig_leads').update({
        link_sent: true, last_dm_at: new Date().toISOString(),
      }).eq('ig_user_id', item.ig_user_id)
      enviados++
    } else {
      const tentativas = (item.tentativas ?? 0) + 1
      await db.from('ig_send_queue').update({
        // depois de 3 tentativas, desiste (senao fica batendo pra sempre)
        status: tentativas >= 3 ? 'erro' : 'pendente',
        tentativas,
        last_error: (r as any).erro,
      }).eq('id', item.id)
    }
  }

  return { enviados, expirados }
}

// =====================================================================
// PARTE 2: mandar os passos com atraso que venceram
// =====================================================================
async function mandaAtrasados() {
  const { data: itens } = await db.from('ig_scheduled')
    .select('*').eq('sent', false)
    .lte('send_at', new Date().toISOString()).limit(50)

  let enviados = 0

  for (const item of itens ?? []) {
    const { data: auto } = await db.from('ig_automations')
      .select('*').eq('id', item.automation_id).maybeSingle()

    const passo: FlowStep | undefined =
      auto?.flow?.steps?.find((s: FlowStep) => String(s.id) === String(item.step_id))

    if (!auto || !passo) {
      await db.from('ig_scheduled').update({ sent: true }).eq('id', item.id)
      continue
    }

    const r = await enviaPasso({ id: item.ig_user_id }, auto.id, passo)

    await db.from('ig_deliveries').insert({
      ig_user_id: item.ig_user_id, automation_id: auto.id,
      canal: 'dm', tipo: 'flow',
      status: r.ok ? 'ok' : 'erro',
      motivo: r.ok ? 'passo com atraso' : (r as any).erro,
    })

    // marca como enviado mesmo se deu erro: fora da janela de 24h nao
    // adianta insistir, so geraria erro repetido pra sempre.
    await db.from('ig_scheduled').update({ sent: true }).eq('id', item.id)

    if (r.ok) {
      enviados++
      // encadeia: se o passo que acabou de sair tambem tem atraso, agenda
      if (passo.delay?.seconds && passo.delay.next !== null && passo.delay.next !== undefined
          && String(passo.delay.next) !== String(passo.id)) {
        await db.from('ig_scheduled').insert({
          ig_user_id: item.ig_user_id,
          automation_id: auto.id,
          step_id: String(passo.delay.next),
          send_at: new Date(Date.now() + passo.delay.seconds * 1000).toISOString(),
        })
      }
      // se o passo pede um dado, marca o que esperamos
      if (passo.collect?.field) {
        await db.from('ig_leads').update({
          expecting: {
            field: passo.collect.field,
            next: passo.collect.next ?? null,
            automation_id: auto.id,
            since: new Date().toISOString(),
          },
        }).eq('ig_user_id', item.ig_user_id)
      }
    }
  }

  return enviados
}

// =====================================================================
Deno.serve(async (req) => {
  // A tranca: sem o segredo certo, nao passa.
  const chave = req.headers.get('x-sched-key')
  if (!SCHED_SECRET || chave !== SCHED_SECRET) {
    return new Response(JSON.stringify({ erro: 'nao autorizado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const fila = await esvaziaFila()
    const atrasados = await mandaAtrasados()
    const resumo = { fila_enviados: fila.enviados, fila_expirados: fila.expirados, atrasados }
    console.log('[scheduler]', JSON.stringify(resumo))
    return new Response(JSON.stringify(resumo), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[scheduler] erro:', e)
    return new Response(JSON.stringify({ erro: String(e) }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
})
