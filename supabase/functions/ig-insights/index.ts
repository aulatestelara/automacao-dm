// =====================================================================
// ig-insights: AS METRICAS
//
// Puxa do Instagram: seguidores, novos seguidores por dia e alcance por
// dia. Devolve tudo pronto pro painel desenhar os graficos.
//
// Protegida por login: so quem esta logado no painel consegue chamar.
// Por isso o deploy dela e SEM --no-verify-jwt (ao contrario do webhook).
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

  try {
    const dias = 15

    // 1. os dados da conta
    const rConta = await fetch(
      `${GRAPH}/me?fields=username,followers_count,media_count&access_token=${IG_ACCESS_TOKEN}`,
    )
    const conta = await rConta.json()

    if (conta?.error) {
      return resposta({ conectado: false, motivo: conta.error.message })
    }

    // 2. as series por dia (novos seguidores e alcance)
    const desde = Math.floor((Date.now() - dias * 86400_000) / 1000)
    const ate = Math.floor(Date.now() / 1000)

    const rSeries = await fetch(
      `${GRAPH}/me/insights?metric=follower_count,reach&period=day` +
      `&since=${desde}&until=${ate}&access_token=${IG_ACCESS_TOKEN}`,
    )
    const series = await rSeries.json()

    // transforma o formato do Instagram em algo simples: [{dia, valor}]
    const pegaSerie = (nome: string) => {
      const m = series?.data?.find((d: any) => d.name === nome)
      return (m?.values ?? []).map((v: any) => ({
        dia: (v.end_time ?? '').slice(0, 10),
        valor: v.value ?? 0,
      }))
    }

    const novosSeguidores = pegaSerie('follower_count')
    const alcance = pegaSerie('reach')

    return resposta({
      conectado: true,
      conta: {
        username: conta?.username ?? '',
        seguidores: conta?.followers_count ?? 0,
        posts: conta?.media_count ?? 0,
      },
      novos_seguidores: novosSeguidores,
      alcance,
      // soma dos novos seguidores no periodo
      novos_no_periodo: novosSeguidores.reduce((s: number, d: any) => s + d.valor, 0),
    })
  } catch (e) {
    console.error('[insights] erro:', e)
    return resposta({ conectado: false, motivo: String(e) })
  }
})
