// =====================================================================
// ig-media: A LISTA DOS SEUS POSTS
//
// Serve pro seletor "Em quais posts" do editor de automacao: devolve os
// posts da conta com miniatura, pra voce escolher onde a automacao vale.
//
// Protegida por login (deploy SEM --no-verify-jwt).
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IG_ACCESS_TOKEN = Deno.env.get('IG_ACCESS_TOKEN') ?? ''
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
    return resposta({ erro: 'faca login pra ver os posts' }, 401)
  }

  if (!IG_ACCESS_TOKEN) {
    // Sem Instagram ligado: lista vazia, sem quebrar o editor.
    return resposta({ conectado: false, posts: [] })
  }

  try {
    const campos = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'
    const r = await fetch(`${GRAPH}/me/media?fields=${campos}&limit=50&access_token=${IG_ACCESS_TOKEN}`)
    const dados = await r.json()

    if (dados?.error) {
      return resposta({ conectado: false, posts: [], motivo: dados.error.message })
    }

    const posts = (dados?.data ?? []).map((p: any) => ({
      id: p.id,
      // o video usa thumbnail_url; a foto usa media_url mesmo
      thumb: p.thumbnail_url ?? p.media_url ?? '',
      legenda: (p.caption ?? '').slice(0, 80),
      tipo: p.media_type,
      link: p.permalink,
      data: p.timestamp,
    }))

    return resposta({ conectado: true, posts })
  } catch (e) {
    console.error('[media] erro:', e)
    return resposta({ conectado: false, posts: [], motivo: String(e) })
  }
})
