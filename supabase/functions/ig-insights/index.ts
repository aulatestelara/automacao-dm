// =====================================================================
// ig-insights: AS METRICAS
//
// Puxa do Instagram tudo o que o painel mostra na aba Metricas:
// seguidores, novos seguidores, alcance por dia, contas engajadas,
// interacoes e o ranking dos posts.
//
// Aceita ?dias=7|30|90 (o padrao e 30).
//
// Protegida por login: so quem esta logado no painel consegue chamar.
// Por isso o deploy dela e SEM --no-verify-jwt (ao contrario do webhook).
//
// TRES LIMITES DA API QUE MANDAM NESTE ARQUIVO:
//   1. Insights de conta so aceitam janelas de ate 30 dias por chamada.
//      Pra 90 dias, a gente quebra em 3 pedacos e cola (ver janelas()).
//   2. follower_count so existe nos ultimos 30 dias. Pedir mais que isso
//      derruba a chamada inteira, entao ele anda por fora do resto.
//   3. Conta nova/pequena faz o Instagram recusar metrica por falta de
//      dados. Por isso CADA pedaco falha sozinho, sem levar junto o que
//      deu certo (ver tentaJson()).
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IG_ACCESS_TOKEN = Deno.env.get('IG_ACCESS_TOKEN') ?? ''
const IG_ACCOUNT_ID   = Deno.env.get('IG_ACCOUNT_ID') ?? ''
const GRAPH_VERSION   = Deno.env.get('GRAPH_API_VERSION') ?? 'v21.0'
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: cors })
}

// So passa quem esta logado no painel.
async function estaLogado(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization')
  if (!auth) return false
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: auth } } },
    )
    const { data, error } = await sb.auth.getUser()
    return !error && !!data?.user
  } catch {
    return false
  }
}

// Busca que nunca explode: erro vira null e a vida continua. Uma metrica
// que o Instagram recusa nao pode derrubar as outras cinco.
async function tentaJson(url: string, oque: string): Promise<any | null> {
  try {
    const r = await fetch(url)
    const j = await r.json()
    if (j?.error) {
      console.warn(`[insights] ${oque} recusado:`, j.error.message)
      return null
    }
    return j
  } catch (e) {
    console.warn(`[insights] ${oque} falhou:`, String(e))
    return null
  }
}

// Quebra o periodo em pedacos de ate 30 dias, porque a API nao aceita mais
// que isso de uma vez. Devolve [{desde, ate}] em segundos.
function janelas(dias: number): Array<{ desde: number; ate: number }> {
  const agora = Math.floor(Date.now() / 1000)
  const pedacos = []
  let fim = agora
  let restam = dias
  while (restam > 0) {
    const tamanho = Math.min(restam, 30)
    pedacos.push({ desde: fim - tamanho * 86400, ate: fim })
    fim -= tamanho * 86400
    restam -= tamanho
  }
  return pedacos
}

// O formato do Instagram ([{end_time, value}]) vira [{dia, valor}].
function viraSerie(bloco: any): Array<{ dia: string; valor: number }> {
  return (bloco?.values ?? []).map((v: any) => ({
    dia: (v.end_time ?? '').slice(0, 10),
    valor: v.value ?? 0,
  }))
}

// As series por dia (alcance), coladas de varias janelas de 30 dias.
async function serieDiaria(metrica: string, dias: number) {
  const partes = await Promise.all(
    janelas(dias).map((j) =>
      tentaJson(
        `${GRAPH}/me/insights?metric=${metrica}&period=day` +
        `&since=${j.desde}&until=${j.ate}&access_token=${IG_ACCESS_TOKEN}`,
        `serie ${metrica}`,
      ),
    ),
  )

  const tudo: Record<string, number> = {}
  for (const p of partes) {
    const bloco = p?.data?.find((d: any) => d.name === metrica)
    for (const d of viraSerie(bloco)) {
      if (d.dia) tudo[d.dia] = d.valor // dia repetido nas bordas: fica um so
    }
  }

  return Object.entries(tudo)
    .map(([dia, valor]) => ({ dia, valor }))
    .sort((a, b) => a.dia.localeCompare(b.dia))
}

// Os totais do periodo (contas engajadas, interacoes). Essas metricas usam
// metric_type=total_value, que devolve um numero so em vez de uma serie.
async function totalDoPeriodo(metrica: string, dias: number): Promise<number | null> {
  const partes = await Promise.all(
    janelas(dias).map((j) =>
      tentaJson(
        `${GRAPH}/me/insights?metric=${metrica}&metric_type=total_value&period=day` +
        `&since=${j.desde}&until=${j.ate}&access_token=${IG_ACCESS_TOKEN}`,
        `total ${metrica}`,
      ),
    ),
  )

  let soma = 0
  let achou = false
  for (const p of partes) {
    const v = p?.data?.find((d: any) => d.name === metrica)?.total_value?.value
    if (typeof v === 'number') { soma += v; achou = true }
  }
  return achou ? soma : null
}

// Os posts, ja com as metricas de cada um. dias = 0 significa "tudo".
//
// ATENCAO, pegadinha do Instagram: salvos/compartilhamentos/views/alcance
// so existem pra post publicado DEPOIS que a conta virou profissional.
// E pior: um unico post antigo derruba a chamada inteira. Por isso, se os
// insights forem recusados, a gente busca de novo sem eles e avisa o painel,
// em vez de mostrar zero e deixar a pessoa achando que o post fracassou.
async function buscaPosts(dias: number): Promise<{ posts: any[]; aviso: string | null }> {
  const base = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,' +
               'like_count,comments_count'

  let lista: any[] = []
  let aviso: string | null = null

  const comInsights = await fetch(
    `${GRAPH}/me/media?fields=${base},insights.metric(reach,saved,shares,views)` +
    `&limit=50&access_token=${IG_ACCESS_TOKEN}`,
  ).then((r) => r.json()).catch(() => null)

  if (comInsights?.data) {
    lista = comInsights.data
  } else {
    const msg = comInsights?.error?.message ?? ''
    console.warn('[insights] posts sem metricas detalhadas:', msg)

    aviso = /convertida|converted|profissional|professional/i.test(msg)
      ? 'O Instagram so mostra salvos, compartilhamentos e visualizacoes dos posts ' +
        'publicados DEPOIS que a conta virou profissional. Os posts antigos ficam ' +
        'so com curtidas e comentarios.'
      : 'Nao consegui trazer salvos, compartilhamentos e visualizacoes agora. ' +
        'Curtidas e comentarios estao certos.'

    const semInsights = await tentaJson(
      `${GRAPH}/me/media?fields=${base}&limit=50&access_token=${IG_ACCESS_TOKEN}`,
      'posts (sem insights)',
    )
    lista = semInsights?.data ?? []
  }

  const corte = dias ? Date.now() - dias * 86400_000 : 0

  const posts = lista
    .filter((p: any) => !dias || !p.timestamp || new Date(p.timestamp).getTime() >= corte)
    .map((p: any) => {
      const metrica = (nome: string) => {
        const m = p.insights?.data?.find((d: any) => d.name === nome)
        return m?.values?.[0]?.value ?? m?.total_value?.value ?? 0
      }

      const curtidas = p.like_count ?? 0
      const comentarios = p.comments_count ?? 0
      const salvos = metrica('saved')
      const compartilhamentos = metrica('shares')

      return {
        id: p.id,
        thumb: p.thumbnail_url ?? p.media_url ?? '',
        legenda: (p.caption ?? '').slice(0, 90),
        tipo: p.media_type,
        link: p.permalink,
        data: p.timestamp,
        curtidas,
        comentarios,
        salvos,
        compartilhamentos,
        views: metrica('views'),
        alcance: metrica('reach'),
        // "melhores" = o que a pessoa fez de proposito. Ver o post e passivo;
        // salvar e compartilhar da trabalho, entao pesam mais.
        pontos: curtidas + comentarios * 2 + salvos * 3 + compartilhamentos * 3,
      }
    })

  return { posts, aviso }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (!(await estaLogado(req))) {
    return resposta({ erro: 'faca login pra ver as metricas' }, 401)
  }

  if (!IG_ACCESS_TOKEN || !IG_ACCOUNT_ID) {
    // Sem Instagram ligado ainda: devolve vazio de um jeito educado, o
    // painel mostra "conecte seu Instagram" em vez de quebrar.
    return resposta({ conectado: false, motivo: 'o Instagram ainda nao foi configurado' })
  }

  // O periodo pode vir na url (?dias=30) ou no corpo ({dias: 30}).
  // dias = 0 e o "Tudo": todos os posts, desde sempre.
  const naUrl = new URL(req.url).searchParams.get('dias')
  let dias = naUrl === null ? NaN : Number(naUrl)
  if (Number.isNaN(dias)) {
    try { dias = Number((await req.json())?.dias ?? NaN) } catch { dias = NaN }
  }
  if (![0, 7, 30, 90].includes(dias)) dias = 30

  // As series por dia nao tem "desde sempre": o Instagram so guarda uns
  // meses. No "Tudo", o grafico mostra 90 dias e o painel avisa isso.
  const diasSerie = dias === 0 ? 90 : dias

  try {
    const conta = await tentaJson(
      `${GRAPH}/me?fields=username,followers_count,media_count&access_token=${IG_ACCESS_TOKEN}`,
      'conta',
    )

    // Sem os dados da conta, nao ha metrica nenhuma: aqui vale desistir.
    if (!conta) {
      return resposta({
        conectado: false,
        motivo: 'o Instagram nao respondeu. O token pode ter vencido.',
      })
    }

    // Tudo de uma vez. Cada um se vira sozinho se falhar.
    const [alcance, novosSeguidores, contasEngajadas, interacoes, midia] = await Promise.all([
      serieDiaria('reach', diasSerie),
      // follower_count so tem os ultimos 30 dias, entao ele nunca pede mais.
      serieDiaria('follower_count', Math.min(diasSerie, 30)),
      totalDoPeriodo('accounts_engaged', diasSerie),
      totalDoPeriodo('total_interactions', diasSerie),
      buscaPosts(dias),
    ])

    const soma = (s: Array<{ valor: number }>) => s.reduce((t, d) => t + d.valor, 0)

    return resposta({
      conectado: true,
      periodo: dias,          // 0 = tudo
      periodo_serie: diasSerie, // o que o grafico realmente cobre
      conta: {
        username: conta?.username ?? '',
        seguidores: conta?.followers_count ?? 0,
        posts: conta?.media_count ?? 0,
      },
      resumo: {
        seguidores: conta?.followers_count ?? 0,
        novos_seguidores: soma(novosSeguidores),
        // novos_seguidores so cobre 30 dias; o painel avisa quando o
        // periodo pedido e maior que isso.
        novos_seguidores_limite: Math.min(diasSerie, 30),
        alcance: soma(alcance),
        contas_engajadas: contasEngajadas,
        interacoes,
      },
      alcance,
      novos_seguidores: novosSeguidores,
      posts: midia.posts,
      // quando o Instagram nega salvos/views, o painel explica o porque
      aviso_posts: midia.aviso,
      // compatibilidade com a versao antiga do painel
      novos_no_periodo: soma(novosSeguidores),
    })
  } catch (e) {
    console.error('[insights] erro:', e)
    return resposta({ conectado: false, motivo: String(e) })
  }
})
