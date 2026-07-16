// =====================================================================
// instagram-webhook: O CEREBRO DO SISTEMA
//
// E aqui que tudo acontece. O Instagram avisa esta funcao toda vez que
// alguem comenta num post seu ou te manda uma mensagem no direct, e ela
// decide o que responder.
//
// O caminho completo, em portugues:
//   1. Alguem comenta "quero" no seu post.
//   2. O Instagram chama esta funcao.
//   3. A funcao acha a automacao que tem a palavra "quero".
//   4. Pede uma ficha ao freio (pra nao passar do teto de envio).
//   5. Manda a DM com o botao e responde no comentario.
//   6. A pessoa toca no botao, o Instagram chama esta funcao de novo,
//      e a conversa segue pro proximo passo.
//
// IMPORTANTE: esta funcao precisa ser PUBLICA (deploy com --no-verify-jwt),
// senao o Instagram nao consegue chamar ela.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---------------------------------------------------------------------
// Os segredos. Todos vem das variaveis de ambiente, nenhum fica no codigo.
// ---------------------------------------------------------------------
const IG_ACCESS_TOKEN = Deno.env.get('IG_ACCESS_TOKEN') ?? ''
const IG_ACCOUNT_ID   = Deno.env.get('IG_ACCOUNT_ID') ?? ''
const APP_SECRET      = Deno.env.get('APP_SECRET') ?? ''
const VERIFY_TOKEN    = Deno.env.get('VERIFY_TOKEN') ?? ''
const GRAPH_VERSION   = Deno.env.get('GRAPH_API_VERSION') ?? 'v21.0'

// Enquanto isso for diferente de "true", assinatura invalida so gera um
// aviso no log e o evento e processado assim mesmo (modo teste).
// Depois que tudo funcionar, ligue pra "true" (ver o LEIA-ME, passo 10).
const APP_SECRET_ENFORCE = (Deno.env.get('APP_SECRET_ENFORCE') ?? 'false') === 'true'

// Contas de teste: ids numericos separados por virgula.
// Elas ignoram a regra do "1 por dia", pra voce testar a vontade.
const TEST_IG_ACCOUNTS = (Deno.env.get('TEST_IG_ACCOUNTS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean)

const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`

// O banco. Usa a chave de service_role, que passa por cima do RLS.
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

// ---------------------------------------------------------------------
// Os tipos da conversa (o formato do campo "flow"). Ver o LEIA-ME.
// ---------------------------------------------------------------------
type FlowButton = {
  title: string
  next?: number | null   // vai pra outro passo
  url?: string | null    // ou abre um link (nunca os dois)
}
type FlowStep = {
  id: number
  message: string
  buttons?: FlowButton[]
  assets?: string[]
  collect?: { field: string; next?: number | null }
  delay?: { seconds: number; next?: number | null }
}
type Flow = { steps: FlowStep[] }
type Automation = {
  id: string
  nome: string
  keyword: string
  match_any: boolean
  active: boolean
  media_ids: string[]
  public_reply: string
  public_reply_variants: string[]
  flow: Flow
  asset_ids: string[]
}

// ---------------------------------------------------------------------
// Memoria curta: nao processar o mesmo evento duas vezes.
// O Instagram reenvia o evento se demorarmos pra responder, e uma resposta
// privada a comentario so pode ser enviada UMA vez. Sem isso, a pessoa
// recebe a mesma mensagem repetida.
// ---------------------------------------------------------------------
const vistos = new Set<string>()
function jaProcessou(chave: string): boolean {
  if (vistos.has(chave)) return true
  vistos.add(chave)
  // nao deixa a memoria crescer pra sempre
  if (vistos.size > 2000) {
    for (const k of Array.from(vistos).slice(0, 1000)) vistos.delete(k)
  }
  return false
}

// =====================================================================
// PEDACINHOS UTEIS
// =====================================================================

// Sorteia entre a mensagem principal e as variacoes (o A/B).
function sorteiaVariacao(principal: string, variacoes: string[] = []): string {
  const opcoes = [principal, ...(variacoes ?? [])].filter((t) => t && t.trim())
  if (!opcoes.length) return ''
  return opcoes[Math.floor(Math.random() * opcoes.length)]
}

// Tira acento e deixa minusculo, pra "Quero" casar com "quero".
function normaliza(texto: string): string {
  return (texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
}

// Grava no log de entregas. Nunca deixa o log derrubar o envio.
async function logEntrega(dados: Record<string, unknown>) {
  try {
    await db.from('ig_deliveries').insert(dados)
  } catch (e) {
    console.error('[log] falhou:', e)
  }
}

// Guarda o id de uma mensagem que NOS enviamos, pra depois nao confundir
// com uma resposta que voce escreveu na mao.
async function guardaMidDoRobo(mid?: string) {
  if (!mid) return
  try {
    await db.from('ig_bot_sends').upsert({ mid })
  } catch { /* best-effort */ }
}

// =====================================================================
// A ASSINATURA (a trava de seguranca do webhook)
// Confere se a requisicao veio mesmo do Meta, e nao de um curioso.
// =====================================================================
async function assinaturaValida(corpo: string, cabecalho: string | null): Promise<boolean> {
  if (!APP_SECRET || !cabecalho) return false
  try {
    const esperado = cabecalho.replace('sha256=', '')
    const chave = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(APP_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const assinado = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo))
    const calculado = Array.from(new Uint8Array(assinado))
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    return calculado === esperado
  } catch (e) {
    console.error('[assinatura] erro ao calcular:', e)
    return false
  }
}

// =====================================================================
// FALAR COM O INSTAGRAM
// =====================================================================
type Resultado = { ok: boolean; mid?: string; erro?: string; duro?: boolean }

async function chamaGraph(caminho: string, corpo: unknown): Promise<Resultado> {
  try {
    const r = await fetch(`${GRAPH}/${caminho}?access_token=${IG_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    const dados = await r.json().catch(() => ({}))

    if (!r.ok) {
      const msg = dados?.error?.message ?? `HTTP ${r.status}`
      const codigo = dados?.error?.code
      // Erro "duro" = bloqueio, permissao ou limite da Meta. Esses contam
      // pro disjuntor do freio. Erro bobo (ex: a pessoa te bloqueou) nao.
      const duro = r.status === 429 || r.status === 403 ||
                   codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613
      console.error('[graph] erro:', msg)
      return { ok: false, erro: msg, duro }
    }

    const mid = dados?.message_id
    await guardaMidDoRobo(mid)
    return { ok: true, mid }
  } catch (e) {
    return { ok: false, erro: String(e), duro: false }
  }
}

// O freio: "posso enviar?"
async function pegaFicha(chave: string): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('take_send_slot', { p_key: chave })
    if (error) {
      // Se a funcao nao existe, avisa alto e claro: e o erro mais comum.
      console.error('[freio] take_send_slot falhou. A funcao do freio foi criada? ' +
                    'Rode o arquivo 02-freio.sql. Erro:', error.message)
      return false
    }
    return data === true
  } catch (e) {
    console.error('[freio] erro:', e)
    return false
  }
}

async function anotaResultado(chave: string, ok: boolean, duro = false) {
  try {
    await db.rpc('record_send_result', { p_key: chave, p_ok: ok, p_hard: duro })
  } catch (e) {
    console.error('[freio] record_send_result falhou:', e)
  }
}

// =====================================================================
// MONTAR OS BOTOES (o pulo do gato)
//
// O botao ANEXADO (colado no balao, estilo ManyChat) e o "button template".
// Cada botao vira:
//   - web_url   se tem link (abre o site)
//   - postback  se avanca a conversa (payload STEP:automacao:proximoPasso)
// Botao sem destino nenhum e DESCARTADO: nao adianta mandar pilula morta.
// =====================================================================
function montaBotoes(auto: Automation, passo: FlowStep) {
  const botoes = (passo.buttons ?? [])
    .filter((b) => b.title && b.title.trim())
    // so entra quem tem destino: ou link, ou proximo passo
    .filter((b) => (b.url && b.url.trim()) || (b.next !== null && b.next !== undefined))
    .map((b) => {
      const titulo = b.title.trim().slice(0, 20) // o IG corta em 20 letras
      if (b.url && b.url.trim()) {
        return { type: 'web_url', url: b.url.trim(), title: titulo }
      }
      return {
        type: 'postback',
        title: titulo,
        payload: `STEP:${auto.id}:${b.next}`,
      }
    })
  return botoes
}

// =====================================================================
// sendStep: envia UM passo da conversa (a mensagem + os botoes dela).
//
// Tenta em 3 formatos, do melhor pro mais simples, pra a mensagem nunca
// deixar de chegar:
//   1. button template  (botao colado no balao, o bonito)
//   2. quick_reply      (pilula acima do teclado)
//   3. texto puro       (com o link escrito no texto, se houver)
//
// "destino" e pra quem vai: {comment_id} responde um comentario,
// {id} manda pela DM (so funciona dentro da janela de 24h).
// =====================================================================
async function enviaPasso(
  destino: Record<string, string>,
  auto: Automation,
  passo: FlowStep,
): Promise<Resultado> {
  const texto = passo.message?.trim() || '...'
  const botoes = montaBotoes(auto, passo)

  // --- Formato 1: botao ANEXADO (o limite de 3 vale so aqui) ---
  if (botoes.length) {
    const anexados = botoes.slice(0, 3)
    const r1 = await chamaGraph('me/messages', {
      recipient: destino,
      message: {
        attachment: {
          type: 'template',
          payload: { template_type: 'button', text: texto, buttons: anexados },
        },
      },
    })
    if (r1.ok) return r1
    console.warn('[passo] button template recusado, tentando pilula. Motivo:', r1.erro)

    // --- Formato 2: pilula (quick_reply). Aqui cabem ate 13. ---
    const pilulas = botoes.slice(0, 13).map((b: any) => ({
      content_type: 'text',
      title: b.title,
      // pilula nao abre link sozinha, entao o link vai no payload como aviso
      payload: b.type === 'postback' ? b.payload : `URL:${b.url}`,
    }))
    const r2 = await chamaGraph('me/messages', {
      recipient: destino,
      message: { text: texto, quick_replies: pilulas },
    })
    if (r2.ok) return r2
    console.warn('[passo] pilula tambem recusada, caindo pro texto puro.')
  }

  // --- Formato 3: texto puro (o ultimo recurso) ---
  const comLink = botoes.find((b: any) => b.type === 'web_url')
  const textoFinal = comLink ? `${texto}\n\n${(comLink as any).url}` : texto
  return await chamaGraph('me/messages', {
    recipient: destino,
    message: { text: textoFinal },
  })
}

// Se o passo pede um dado (email, telefone), marca no lead que estamos
// esperando. A proxima mensagem de texto da pessoa vira o dado.
async function marcaEsperando(igUserId: string, auto: Automation, passo: FlowStep) {
  if (!passo.collect?.field) return
  try {
    await db.from('ig_leads').update({
      expecting: {
        field: passo.collect.field,
        next: passo.collect.next ?? null,
        automation_id: auto.id,
        since: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }).eq('ig_user_id', igUserId)
  } catch (e) {
    console.error('[coleta] nao consegui marcar o que esperar:', e)
  }
}

// Se o passo tem atraso, agenda o proximo pro robo ig-scheduler mandar.
async function agendaAtraso(igUserId: string, auto: Automation, passo: FlowStep) {
  if (!passo.delay?.seconds || passo.delay.next === null || passo.delay.next === undefined) return
  try {
    await db.from('ig_scheduled').insert({
      ig_user_id: igUserId,
      automation_id: auto.id,
      step_id: String(passo.delay.next),
      send_at: new Date(Date.now() + passo.delay.seconds * 1000).toISOString(),
    })
  } catch (e) {
    console.error('[atraso] nao consegui agendar:', e)
  }
}

// =====================================================================
// ACHAR A AUTOMACAO CERTA
// =====================================================================
function casaPalavra(auto: Automation, texto: string): boolean {
  // "qualquer palavra ativa" ligado: nem olha as palavras
  if (auto.match_any) return true
  const t = normaliza(texto)
  const palavras = (auto.keyword ?? '').split(',').map((k) => normaliza(k)).filter(Boolean)
  if (!palavras.length) return false
  return palavras.some((p) => t.includes(p))
}

function casaPost(auto: Automation, mediaId: string): boolean {
  // lista vazia = vale pra todos os posts
  if (!auto.media_ids?.length) return true
  return auto.media_ids.includes(mediaId)
}

async function carregaAutomacoes(): Promise<Automation[]> {
  const { data, error } = await db.from('ig_automations').select('*').eq('active', true)
  if (error) {
    console.error('[banco] nao consegui ler as automacoes:', error.message)
    return []
  }
  return (data ?? []) as Automation[]
}

// O primeiro passo do array e SEMPRE a Mensagem 1, nao importa o numero
// do id dele. Nao procure por id === 0.
function primeiroPasso(auto: Automation): FlowStep | null {
  return auto.flow?.steps?.[0] ?? null
}
function achaPasso(auto: Automation, id: string | number): FlowStep | null {
  return auto.flow?.steps?.find((s) => String(s.id) === String(id)) ?? null
}

// =====================================================================
// A REGRA DO "1 POR DIA"
// Uma DM por pessoa a cada 24h, quando o gatilho e comentario.
// As contas de teste (TEST_IG_ACCOUNTS) ignoram, pra voce poder testar.
// =====================================================================
async function recebeuNasUltimas24h(igUserId: string): Promise<boolean> {
  if (TEST_IG_ACCOUNTS.includes(igUserId)) {
    console.log('[regra 1/dia] conta de teste, liberado:', igUserId)
    return false
  }
  try {
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data } = await db
      .from('ig_deliveries')
      .select('id')
      .eq('ig_user_id', igUserId)
      .eq('status', 'ok')
      .gte('ts', ontem)
      .limit(1)
    return (data?.length ?? 0) > 0
  } catch {
    // na duvida, deixa passar (melhor entregar do que sumir com o lead)
    return false
  }
}

// =====================================================================
// SALVAR O LEAD
// =====================================================================
async function salvaLead(dados: Record<string, unknown>) {
  try {
    await db.from('ig_leads').upsert(
      { ...dados, updated_at: new Date().toISOString() },
      { onConflict: 'ig_user_id' },
    )
  } catch (e) {
    console.error('[lead] nao consegui salvar:', e)
  }
}

// =====================================================================
// ENTREGAR A AUTOMACAO
//
// Toda automacao tem flow, entao entregar e sempre a mesma coisa: mandar
// o PRIMEIRO passo com os botoes dele. Nao existe caminho separado de
// "mensagem com link": no modo "Um link" o primeiro passo ja tem um botao
// de link; no modo "Continua a conversa" o botao aponta pro proximo passo.
// =====================================================================
async function entregaAutomacao(
  destino: Record<string, string>,
  auto: Automation,
  igUserId: string,
  canal: 'private_reply' | 'dm',
  extra?: { commentId?: string; username?: string },
): Promise<'enviado' | 'na_fila' | 'erro'> {
  const passo = primeiroPasso(auto)
  if (!passo) {
    console.warn('[entrega] automacao sem nenhum passo:', auto.nome)
    return 'erro'
  }

  // Resposta a comentario passa pelo FREIO. DM (janela ja aberta) tem
  // limite bem maior, entao vai direto.
  if (canal === 'private_reply') {
    const temFicha = await pegaFicha('private_reply')
    if (!temFicha) {
      // Sem ficha agora: guarda na fila. O ig-scheduler manda depois.
      console.log('[freio] sem ficha, indo pra fila:', extra?.commentId)
      if (extra?.commentId) {
        await db.from('ig_send_queue').upsert({
          comment_id: extra.commentId,
          automation_id: auto.id,
          ig_user_id: igUserId,
          username: extra.username ?? null,
          status: 'pendente',
        }, { onConflict: 'comment_id' })
      }
      await logEntrega({
        ig_user_id: igUserId, automation_id: auto.id,
        canal, tipo: 'flow', status: 'na_fila',
        motivo: 'freio: sem ficha de envio agora',
      })
      return 'na_fila'
    }
  }

  const r = await enviaPasso(destino, auto, passo)

  if (canal === 'private_reply') {
    await anotaResultado('private_reply', r.ok, r.duro ?? false)
  }

  await logEntrega({
    ig_user_id: igUserId, automation_id: auto.id,
    canal, tipo: 'flow',
    status: r.ok ? 'ok' : 'erro',
    motivo: r.ok ? null : r.erro,
  })

  if (!r.ok) return 'erro'

  await agendaAtraso(igUserId, auto, passo)
  await marcaEsperando(igUserId, auto, passo)
  return 'enviado'
}

// =====================================================================
// QUANDO ALGUEM COMENTA
// =====================================================================
async function tratarComentario(valor: any) {
  const commentId = valor?.id
  const texto = valor?.text ?? ''
  const fromId = valor?.from?.id
  const username = valor?.from?.username
  const mediaId = valor?.media?.id

  if (!commentId || !fromId) return

  // 1. ja processei esse comentario? (o Meta reenvia)
  if (jaProcessou(`c:${commentId}`)) {
    console.log('[comentario] repetido, ignorando:', commentId)
    return
  }

  // 2. comentario meu mesmo? ignora (senao respondo a mim mesma)
  if (String(fromId) === String(IG_ACCOUNT_ID)) {
    console.log('[comentario] e da propria conta, ignorando')
    return
  }

  console.log('[comentario] de @' + (username ?? fromId) + ':', texto)

  // 3. acha a automacao: a palavra tem que casar E o post tambem
  const autos = await carregaAutomacoes()
  const auto = autos.find((a) => casaPalavra(a, texto) && casaPost(a, mediaId))
  if (!auto) {
    console.log('[comentario] nenhuma automacao casou, silencio')
    return
  }
  console.log('[comentario] casou com a automacao:', auto.nome)

  // 4. a regra do 1 por dia
  if (await recebeuNasUltimas24h(String(fromId))) {
    console.log('[comentario] essa pessoa ja recebeu nas ultimas 24h, pulando')
    return
  }

  // 5. entrega
  const resultado = await entregaAutomacao(
    { comment_id: commentId },
    auto,
    String(fromId),
    'private_reply',
    { commentId, username },
  )

  // 6. responde no comentario (so se a DM saiu ou esta garantida na fila)
  if (resultado === 'enviado' || resultado === 'na_fila') {
    const resposta = sorteiaVariacao(auto.public_reply, auto.public_reply_variants)
    if (resposta) {
      await chamaGraph(`${commentId}/replies`, { message: resposta })
    }
    // so marca o lead quando realmente saiu ou esta na fila. Se falhou,
    // deixa sem marcar pra poder tentar de novo depois.
    await salvaLead({
      ig_user_id: String(fromId),
      username,
      last_source: 'comment',
      last_keyword: texto.slice(0, 100),
      automation_id: auto.id,
      flow_step: String(primeiroPasso(auto)?.id ?? ''),
      link_sent: resultado === 'enviado',
      last_dm_at: resultado === 'enviado' ? new Date().toISOString() : null,
    })
  }
}

// =====================================================================
// QUANDO CHEGA UMA MENSAGEM NO DIRECT (ou um toque em botao)
// =====================================================================
async function tratarMensagem(evento: any) {
  const senderId = evento?.sender?.id
  const mid = evento?.message?.mid

  // 1. e um "echo" (mensagem que a propria conta mandou)? ignora.
  //    Se o mid esta em ig_bot_sends, fui eu, o robo, que mandei.
  if (evento?.message?.is_echo) {
    return
  }

  // 2. evento repetido? ignora.
  if (mid && jaProcessou(`m:${mid}`)) return

  if (!senderId || String(senderId) === String(IG_ACCOUNT_ID)) return

  const autos = await carregaAutomacoes()

  // -------------------------------------------------------------------
  // 3. TOQUE EM BOTAO. Vem de dois jeitos, e os DOIS precisam funcionar:
  //    - postback   (botao anexado no balao)
  //    - quick_reply (pilula)
  //    O payload STEP:automacao:passo carrega o id da automacao, entao
  //    duas automacoes com botao de mesmo nome nunca se misturam.
  // -------------------------------------------------------------------
  const payload = evento?.postback?.payload ?? evento?.message?.quick_reply?.payload

  if (payload && String(payload).startsWith('STEP:')) {
    const [, autoId, stepId] = String(payload).split(':')
    const auto = autos.find((a) => a.id === autoId)
    if (!auto) {
      console.warn('[botao] automacao do payload nao existe mais:', autoId)
      return
    }
    const passo = achaPasso(auto, stepId)
    if (!passo) {
      console.warn('[botao] passo nao existe:', stepId)
      return
    }

    console.log('[botao] avancando pro passo', stepId, 'da automacao', auto.nome)

    // Pela DM a janela de 24h ja esta aberta (a pessoa acabou de tocar).
    const r = await enviaPasso({ id: String(senderId) }, auto, passo)
    await logEntrega({
      ig_user_id: String(senderId), automation_id: auto.id,
      canal: 'dm', tipo: 'flow',
      status: r.ok ? 'ok' : 'erro', motivo: r.ok ? null : r.erro,
    })

    if (r.ok) {
      await salvaLead({
        ig_user_id: String(senderId),
        last_source: 'dm',
        automation_id: auto.id,
        flow_step: String(passo.id),
        last_dm_at: new Date().toISOString(),
      })
      await agendaAtraso(String(senderId), auto, passo)
      await marcaEsperando(String(senderId), auto, passo)
    }
    return
  }

  // -------------------------------------------------------------------
  // 4. COLETA DE DADO: se um passo pediu email ou telefone, a proxima
  //    mensagem de texto da pessoa e a resposta.
  // -------------------------------------------------------------------
  const texto = evento?.message?.text ?? ''
  if (texto) {
    const { data: lead } = await db.from('ig_leads')
      .select('expecting').eq('ig_user_id', String(senderId)).maybeSingle()

    const esperando = lead?.expecting as any
    if (esperando?.field) {
      const auto = autos.find((a) => a.id === esperando.automation_id)
      const valor = texto.trim()

      // valida antes de aceitar
      const valido = esperando.field === 'email'
        ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor)
        : esperando.field === 'telefone'
          ? valor.replace(/\D/g, '').length >= 10
          : valor.length > 0

      if (!valido) {
        await chamaGraph('me/messages', {
          recipient: { id: String(senderId) },
          message: {
            text: esperando.field === 'email'
              ? 'Hmm, esse e-mail parece incompleto. Pode mandar de novo?'
              : 'Nao consegui entender. Pode mandar de novo?',
          },
        })
        return
      }

      // salva o dado e limpa o "esperando"
      const campo = esperando.field === 'email' ? 'email' : 'telefone'
      await db.from('ig_leads').update({
        [campo]: valor,
        expecting: null,
        updated_at: new Date().toISOString(),
      }).eq('ig_user_id', String(senderId))

      console.log('[coleta] guardei o', campo, 'de', senderId)

      // segue a conversa, se tinha proximo passo
      if (auto && esperando.next !== null && esperando.next !== undefined) {
        const proximo = achaPasso(auto, esperando.next)
        if (proximo) {
          const r = await enviaPasso({ id: String(senderId) }, auto, proximo)
          if (r.ok) {
            await agendaAtraso(String(senderId), auto, proximo)
            await marcaEsperando(String(senderId), auto, proximo)
          }
        }
      }
      return
    }
  }

  // -------------------------------------------------------------------
  // 5. Mensagem de texto solta que nao bate com nada: SILENCIO.
  //    O sistema so responde quem pediu. Voce responde na mao.
  // -------------------------------------------------------------------
  console.log('[dm] mensagem sem gatilho, ficando quieto')
}

// =====================================================================
// A PORTA DE ENTRADA
// =====================================================================
Deno.serve(async (req) => {
  const url = new URL(req.url)

  // -------------------------------------------------------------------
  // GET: o aperto de mao. O Meta chama uma vez, na hora de cadastrar o
  // webhook, pra confirmar que a URL e sua mesmo.
  // -------------------------------------------------------------------
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[handshake] deu certo')
      return new Response(challenge ?? '', { status: 200 })
    }
    console.warn('[handshake] o verify_token nao bateu')
    return new Response('token invalido', { status: 403 })
  }

  // -------------------------------------------------------------------
  // POST: os eventos de verdade.
  // -------------------------------------------------------------------
  if (req.method === 'POST') {
    const corpo = await req.text()
    const assinatura = req.headers.get('x-hub-signature-256')
    const ok = await assinaturaValida(corpo, assinatura)

    if (!ok) {
      if (APP_SECRET_ENFORCE) {
        // Trava ligada: recusa mesmo.
        console.error('[assinatura] invalida, recusando (APP_SECRET_ENFORCE=true)')
        return new Response('assinatura invalida', { status: 401 })
      }
      // Modo teste: so avisa e processa assim mesmo.
      console.warn('[assinatura] nao bateu, mas APP_SECRET_ENFORCE esta desligado. ' +
                   'Processando assim mesmo (modo teste).')
    } else {
      console.log('[assinatura] confere')
    }

    // Responder RAPIDO e processar depois. Se demorarmos, o Meta acha que
    // caiu e manda o evento de novo, o que gera mensagem repetida.
    const processar = async () => {
      try {
        const dados = JSON.parse(corpo)
        for (const entry of dados?.entry ?? []) {
          // comentarios
          for (const change of entry?.changes ?? []) {
            if (change?.field === 'comments') {
              await tratarComentario(change.value)
            }
          }
          // mensagens e toques em botao
          for (const evento of entry?.messaging ?? []) {
            await tratarMensagem(evento)
          }
        }
      } catch (e) {
        console.error('[webhook] erro ao processar:', e)
      }
    }

    // @ts-ignore: EdgeRuntime existe no Supabase
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(processar())
    } else {
      await processar()
    }

    return new Response('EVENT_RECEIVED', { status: 200 })
  }

  return new Response('metodo nao suportado', { status: 405 })
})
