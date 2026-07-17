// =====================================================================
// O PAINEL
//
// Tudo em JavaScript puro, sem framework. Pode hospedar em qualquer lugar
// (GitHub Pages, por exemplo), porque sao so arquivos.
//
// Regra de ouro deste arquivo: NADA pode quebrar a tela. Se o Supabase ou
// o Instagram ainda nao estao configurados, o sistema mostra um estado
// vazio simpatico e segue funcionando.
// =====================================================================

// ---------------------------------------------------------------------
// MODO LOCAL x MODO PRODUCAO
//
// O sistema descobre sozinho onde esta:
//   localhost / 127.0.0.1 / file://  ->  modo de teste local (sem Supabase)
//   qualquer outro endereco          ->  modo producao (login pelo Supabase)
// ---------------------------------------------------------------------
const EH_LOCAL = ['localhost', '127.0.0.1', '', '0.0.0.0'].includes(location.hostname)
  || location.protocol === 'file:'

// Liga o Supabase, se estiver configurado. Se nao estiver, sb fica null e
// o resto do sistema lida com isso sem quebrar.
let sb = null
try {
  const url = window.CONFIG?.SUPABASE_URL
  const key = window.CONFIG?.SUPABASE_ANON_KEY
  const configurado = url && key && !url.includes('SEU_VALOR_AQUI') && !key.includes('SEU_VALOR_AQUI')
  if (configurado && window.supabase) {
    sb = window.supabase.createClient(url, key)
  }
} catch (e) {
  console.warn('Supabase nao configurado ainda:', e)
}

const $  = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))

// Escapa texto antes de jogar no HTML (evita quebrar a tela e coisa pior).
function esc(t) {
  return String(t ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

// =====================================================================
// LOGIN
// =====================================================================
const CHAVE_LOCAL = 'login_local'

function mostraErroLogin(msg) {
  const el = $('#loginErro')
  el.textContent = msg
  el.style.display = 'block'
}

async function tentarLogin(e) {
  e.preventDefault()
  $('#loginErro').style.display = 'none'

  const email = $('#loginEmail').value.trim()
  const senha = $('#loginSenha').value
  const btn = $('#btnEntrar')

  // -------------------------------------------------------------------
  // MODO DE TESTE LOCAL: qualquer e-mail e uma senha de 5 digitos entram.
  // Nao usa o Supabase pra nada. Isso NAO e seguranca de verdade, e por
  // isso que so funciona em localhost.
  // -------------------------------------------------------------------
  if (EH_LOCAL) {
    if (!/^\d{5}$/.test(senha)) {
      mostraErroLogin('No modo de teste local, a senha precisa ter 5 digitos. Ex: 12345')
      return
    }
    localStorage.setItem(CHAVE_LOCAL, JSON.stringify({ email, quando: Date.now() }))
    abrirApp(email)
    return
  }

  // -------------------------------------------------------------------
  // MODO PRODUCAO: o login de verdade, pelo Supabase.
  // -------------------------------------------------------------------
  if (!sb) {
    mostraErroLogin('O sistema ainda nao foi conectado ao Supabase. Veja o LEIA-ME.')
    return
  }

  btn.disabled = true
  btn.textContent = 'Entrando...'
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: senha })
    if (error) {
      // nunca mostra o erro tecnico cru pra pessoa
      mostraErroLogin('E-mail ou senha incorretos')
      return
    }
    abrirApp(data.user?.email ?? email)
  } catch (err) {
    console.error(err)
    mostraErroLogin('Nao consegui entrar agora. Tente de novo em instantes.')
  } finally {
    btn.disabled = false
    btn.textContent = 'Entrar'
  }
}

async function sair() {
  localStorage.removeItem(CHAVE_LOCAL)
  try { if (sb) await sb.auth.signOut() } catch { /* tudo bem */ }
  location.reload()
}

function abrirApp(email) {
  $('#telaLogin').style.display = 'none'
  $('#app').classList.add('ativo')
  $('#menuUsuario').textContent = email ?? ''
  if (EH_LOCAL) $('#faixaTeste').style.display = 'block'
  carregarInicio()
}

// Ve se a pessoa ja estava logada.
async function conferirSessao() {
  if (EH_LOCAL) {
    $('#avisoLocal').style.display = 'block'
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? 'null')
      if (salvo?.email) { abrirApp(salvo.email); return }
    } catch { /* segue pro login */ }
    return
  }

  if (!sb) return
  try {
    const { data } = await sb.auth.getSession()
    if (data?.session?.user) abrirApp(data.session.user.email)
  } catch (e) {
    console.warn('nao consegui ver a sessao:', e)
  }
}

// =====================================================================
// O MENU E AS SECOES
// =====================================================================
function irPara(secao) {
  $$('.menu-item[data-secao]').forEach((b) =>
    b.classList.toggle('ativo', b.dataset.secao === secao))
  $('#secaoInicio').style.display     = secao === 'inicio' ? '' : 'none'
  $('#secaoCalendario').style.display = secao === 'calendario' ? '' : 'none'
  $('#secaoInstagram').style.display  = secao === 'instagram' ? '' : 'none'

  if (secao === 'inicio') carregarInicio()
  if (secao === 'instagram') carregarInstagram()
}

// =====================================================================
// SECAO: INICIO (os numeros)
// Se nao tem banco ou nao tem dado, mostra zero. Nunca quebra.
// =====================================================================
async function carregarInicio() {
  const numeros = { leads: 0, automacoes: 0, dms: 0 }

  if (sb) {
    try {
      const [leads, autos, dms] = await Promise.all([
        sb.from('ig_leads').select('*', { count: 'exact', head: true }),
        sb.from('ig_automations').select('*', { count: 'exact', head: true }).eq('active', true),
        sb.from('ig_deliveries').select('*', { count: 'exact', head: true })
          .eq('status', 'ok')
          .gte('ts', new Date(Date.now() - 7 * 86400_000).toISOString()),
      ])
      numeros.leads = leads.count ?? 0
      numeros.automacoes = autos.count ?? 0
      numeros.dms = dms.count ?? 0
    } catch (e) {
      console.warn('sem numeros por enquanto:', e)
    }
  } else {
    // sem banco: pelo menos conta as automacoes do teste local
    numeros.automacoes = lerAutomacoesLocais().filter((a) => a.active).length
  }

  $('#numLeads').textContent = numeros.leads
  $('#numAutomacoes').textContent = numeros.automacoes
  $('#numDms').textContent = numeros.dms
}

// =====================================================================
// SECAO: INSTAGRAM
// =====================================================================
function carregarInstagram() {
  carregarMetricas()
  carregarAutomacoes()
}

function trocarAba(aba) {
  $$('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba))
  $('#painelMetricas').style.display = aba === 'metricas' ? '' : 'none'
  $('#painelAutomacoes').style.display = aba === 'automacoes' ? '' : 'none'
  $('#painelInteracoes').style.display = aba === 'interacoes' ? '' : 'none'

  // As interacoes so vao no banco quando voce abre a aba, pra nao pesar
  // o carregamento do painel inteiro.
  if (aba === 'interacoes') carregarInteracoes()
}

// ---------------------------------------------------------------------
// Sub-aba: METRICAS
// ---------------------------------------------------------------------
function metricasVazias(motivo) {
  $('#painelMetricas').innerHTML = `
    <div class="vazio">
      <div class="icone">📊</div>
      <h3>Conecte seu Instagram pra ver as metricas</h3>
      <p>${esc(motivo ?? 'Assim que voce ligar a sua conta, os numeros aparecem aqui')}</p>
    </div>`
}

function barrinhas(serie, rotulo) {
  if (!serie?.length) return '<p class="subtitulo">Ainda sem dados</p>'
  const maior = Math.max(...serie.map((d) => d.valor), 1)
  return `<div class="grafico">${serie.map((d) => {
    const altura = Math.max(3, Math.round((d.valor / maior) * 100))
    const dia = (d.dia ?? '').slice(5).split('-').reverse().join('/')
    return `<div class="barra" style="height:${altura}%">
      <span class="dica">${dia}: ${d.valor} ${esc(rotulo)}</span>
    </div>`
  }).join('')}</div>`
}

// O periodo escolhido (0 = tudo) e a ordem do ranking. Ficam guardados
// aqui pra sobreviver a troca de aba.
let periodoMetricas = 30
let ordemPosts = 'melhores'
let dadosMetricas = null

const PERIODOS = [
  { dias: 7,  nome: '7 dias' },
  { dias: 30, nome: '30 dias' },
  { dias: 90, nome: '90 dias' },
  { dias: 0,  nome: 'Tudo' },
]

const ORDENS = [
  { chave: 'melhores',    nome: 'Melhores',        campo: 'pontos' },
  { chave: 'curtidos',    nome: 'Mais curtidos',   campo: 'curtidas' },
  { chave: 'comentados',  nome: 'Mais comentados', campo: 'comentarios' },
  { chave: 'salvos',      nome: 'Mais salvos',     campo: 'salvos' },
  { chave: 'vistos',      nome: 'Mais vistos',     campo: 'views' },
]

const num = (n) => (n ?? 0).toLocaleString('pt-BR')

async function carregarMetricas() {
  if (!sb) {
    metricasVazias('Configure o Supabase e o Instagram pra ver os numeros aqui')
    return
  }

  $('#painelMetricas').innerHTML = '<p class="subtitulo">Carregando...</p>'

  try {
    const { data, error } = await sb.functions.invoke('ig-insights', {
      body: { dias: periodoMetricas },
    })
    if (error || !data?.conectado) {
      metricasVazias(data?.motivo)
      return
    }

    // conta os leads do banco pra mostrar junto
    let leads = 0
    try {
      const r = await sb.from('ig_leads').select('*', { count: 'exact', head: true })
      leads = r.count ?? 0
    } catch { /* segue com zero */ }

    dadosMetricas = { ...data, leads }
    desenharMetricas()
  } catch (e) {
    console.warn('metricas indisponiveis:', e)
    metricasVazias()
  }
}

function desenharMetricas() {
  const d = dadosMetricas
  if (!d) return

  const r = d.resumo ?? {}
  const rotuloPeriodo = PERIODOS.find((p) => p.dias === d.periodo)?.nome ?? ''

  // Metrica que o Instagram negou vem null, e null nao e zero. Mostrar "0"
  // pra dado que nao existe e mentira; entao aparece um tracinho.
  const numeroOuTraco = (v) => (v === null || v === undefined)
    ? '<span class="sem-dado">—</span>' : num(v)

  const filtros = PERIODOS.map((p) => `
    <button class="pilula ${p.dias === periodoMetricas ? 'ativa' : ''}"
            data-periodo="${p.dias}">${p.nome}</button>`).join('')

  $('#painelMetricas').innerHTML = `
    <div class="barra-filtros">
      <div class="pilulas">${filtros}</div>
      <button class="btn btn-pequeno" id="btnAtualizarMetricas">↻ Atualizar</button>
    </div>

    <div class="grade-cartoes">
      <div class="cartao">
        <span class="rotulo">Seguidores</span>
        <div class="numerao">${num(r.seguidores)}</div>
        <p class="ajuda">@${esc(d.conta?.username ?? '')}</p>
      </div>
      <div class="cartao">
        <span class="rotulo">Novos seguidores</span>
        <div class="numerao">${num(r.novos_seguidores)}</div>
        <p class="ajuda">${r.novos_seguidores_limite < (d.periodo || 90)
          ? `O Instagram so guarda ${r.novos_seguidores_limite} dias disso`
          : `Nos ultimos ${r.novos_seguidores_limite} dias`}</p>
      </div>
      <div class="cartao">
        <span class="rotulo">Alcance</span>
        <div class="numerao">${num(r.alcance)}</div>
        <p class="ajuda">Contas que viram voce</p>
      </div>
      <div class="cartao">
        <span class="rotulo">Contas engajadas</span>
        <div class="numerao">${numeroOuTraco(r.contas_engajadas)}</div>
        <p class="ajuda">Curtiram, comentaram ou salvaram</p>
      </div>
      <div class="cartao">
        <span class="rotulo">Interacoes</span>
        <div class="numerao">${numeroOuTraco(r.interacoes)}</div>
        <p class="ajuda">Curtidas + comentarios + salvos</p>
      </div>
      <div class="cartao">
        <span class="rotulo">Leads captados</span>
        <div class="numerao">${num(d.leads)}</div>
        <p class="ajuda">Pessoas que a automacao trouxe</p>
      </div>
    </div>

    <div class="cartao" style="margin-bottom:14px">
      <span class="rotulo">📈 Alcance por dia
        ${d.periodo === 0 ? '<span class="ajuda" style="text-transform:none">(o grafico so vai ate 90 dias)</span>' : ''}
      </span>
      ${barrinhas(d.alcance, 'de alcance')}
    </div>

    <div class="cartao" style="margin-bottom:14px">
      <span class="rotulo">👥 Novos seguidores por dia</span>
      ${barrinhas(d.novos_seguidores, 'novos')}
    </div>

    <div class="cartao">
      <div class="barra-filtros" style="margin-bottom:14px">
        <span class="rotulo" style="margin:0">🔥 Melhores posts ${rotuloPeriodo ? `(${esc(rotuloPeriodo)})` : ''}</span>
        <div class="pilulas">
          ${ORDENS.map((o) => `<button class="pilula pilula-pequena ${o.chave === ordemPosts ? 'ativa' : ''}"
             data-ordem="${o.chave}">${o.nome}</button>`).join('')}
        </div>
      </div>
      ${desenhaPosts()}
      ${d.aviso_posts ? `<p class="aviso" style="margin-top:12px">ℹ️ ${esc(d.aviso_posts)}</p>` : ''}
    </div>`

  $$('#painelMetricas [data-periodo]').forEach((b) => {
    b.onclick = () => {
      periodoMetricas = Number(b.dataset.periodo)
      carregarMetricas()
    }
  })
  $$('#painelMetricas [data-ordem]').forEach((b) => {
    b.onclick = () => {
      ordemPosts = b.dataset.ordem
      desenharMetricas()
    }
  })
  $('#btnAtualizarMetricas').onclick = carregarMetricas
}

function desenhaPosts() {
  const d = dadosMetricas
  const posts = d.posts ?? []

  if (!posts.length) {
    // Nao ter post no periodo e diferente de nao ter post nenhum. Se a
    // conta tem posts, o caminho e trocar o filtro, e a tela diz isso.
    const temPostsFora = (d.conta?.posts ?? 0) > 0
    return `
      <div class="vazio" style="padding:36px 20px">
        <div class="icone">📭</div>
        <h3>Nenhum post ${d.periodo ? 'nesse periodo' : 'ainda'}</h3>
        <p>${temPostsFora && d.periodo
          ? 'Voce tem posts, mas nenhum foi publicado nesse intervalo. Experimente "Tudo".'
          : 'Publique alguma coisa e os numeros aparecem aqui'}</p>
        ${temPostsFora && d.periodo
          ? '<button class="btn btn-pequeno" onclick="verTudoMetricas()">Ver tudo</button>' : ''}
      </div>`
  }

  const campo = ORDENS.find((o) => o.chave === ordemPosts)?.campo ?? 'pontos'
  const lista = [...posts].sort((a, b) => (b[campo] ?? 0) - (a[campo] ?? 0)).slice(0, 12)

  // Ordenar por uma metrica que veio toda zerada so embaralha a lista sem
  // dizer nada. Melhor avisar que o dado nao existe.
  const tudoZero = lista.every((p) => !p[campo])
  const avisoOrdem = tudoZero
    ? `<p class="aviso" style="margin-bottom:12px">Nenhum post tem
       "${esc(ORDENS.find((o) => o.chave === ordemPosts)?.nome.toLowerCase() ?? '')}" pra mostrar.
       A ordem abaixo esta pela data.</p>`
    : ''

  return avisoOrdem + `<div class="grade-melhores">${lista.map((p) => `
    <a class="post-card" href="${esc(p.link ?? '#')}" target="_blank" rel="noopener"
       title="${esc(p.legenda || 'Ver no Instagram')}">
      <div class="post-card-foto">
        ${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : '<span>📷</span>'}
        ${p.tipo === 'VIDEO' ? '<span class="post-tipo">▶</span>' : ''}
        ${p.tipo === 'CAROUSEL_ALBUM' ? '<span class="post-tipo">❏</span>' : ''}
      </div>
      <div class="post-card-nums">
        <span title="curtidas">❤️ ${num(p.curtidas)}</span>
        <span title="comentarios">💬 ${num(p.comentarios)}</span>
        ${p.salvos ? `<span title="salvos">🔖 ${num(p.salvos)}</span>` : ''}
        ${p.views ? `<span title="visualizacoes">👀 ${num(p.views)}</span>` : ''}
        ${p.alcance ? `<span title="alcance">📣 ${num(p.alcance)}</span>` : ''}
      </div>
    </a>`).join('')}</div>`
}

function verTudoMetricas() {
  periodoMetricas = 0
  carregarMetricas()
}

// ---------------------------------------------------------------------
// Sub-aba: AUTOMACOES (a lista)
//
// No modo de teste local nao tem banco, entao as automacoes ficam
// guardadas so no navegador, pra voce conseguir clicar e ver funcionando.
// ---------------------------------------------------------------------
const CHAVE_AUTOS_LOCAIS = 'automacoes_teste_local'

function lerAutomacoesLocais() {
  try { return JSON.parse(localStorage.getItem(CHAVE_AUTOS_LOCAIS) ?? '[]') }
  catch { return [] }
}
function gravarAutomacoesLocais(lista) {
  localStorage.setItem(CHAVE_AUTOS_LOCAIS, JSON.stringify(lista))
}

let automacoes = []

async function carregarAutomacoes() {
  if (sb) {
    try {
      const { data, error } = await sb.from('ig_automations')
        .select('*').order('updated_at', { ascending: false })
      if (error) throw error
      automacoes = data ?? []
    } catch (e) {
      console.warn('nao consegui ler as automacoes:', e)
      automacoes = []
    }
  } else {
    automacoes = lerAutomacoesLocais()
  }
  desenharAutomacoes()

  // As fotos dos posts vem do Instagram e demoram um pouco. A lista ja
  // apareceu ali em cima; quando as fotos chegarem, a gente repinta.
  if (!postsCache) garantirPosts().then(() => desenharAutomacoes())
}

// A foto do post que a automacao vigia, pra voce bater o olho e saber
// qual e qual. Sem post escolhido, ela vale pra todos, e isso tambem
// merece um desenho proprio.
function miniaturaDoPost(a) {
  const ids = a.media_ids ?? []

  if (!ids.length) {
    return `<div class="auto-foto auto-foto-todos" title="Vale pra todos os seus posts">🌐</div>`
  }

  const post = (postsCache ?? []).find((p) => String(p.id) === String(ids[0]))
  const sobra = ids.length > 1 ? `<span class="mais">+${ids.length - 1}</span>` : ''

  // Post nao achado = ou os posts ainda nao carregaram, ou ele foi apagado
  // do Instagram. Nos dois casos, um quadrado neutro e melhor que um X.
  if (!post?.thumb) {
    return `<div class="auto-foto auto-foto-vazia" title="Post ${esc(String(ids[0]))}">📷${sobra}</div>`
  }

  return `<div class="auto-foto" title="${esc(post.legenda || 'Post vinculado')}">
    <img src="${esc(post.thumb)}" alt="" loading="lazy">${sobra}
  </div>`
}

function desenharAutomacoes() {
  const alvo = $('#listaAutomacoes')

  if (!automacoes.length) {
    alvo.innerHTML = `
      <div class="vazio">
        <div class="icone">💬</div>
        <h3>Nenhuma automacao ainda</h3>
        <p>Crie a primeira e veja a previa da DM ao vivo, do lado, enquanto escreve</p>
        <button class="btn btn-primario" onclick="abrirEditor()">＋ Nova automacao</button>
      </div>`
    return
  }

  alvo.innerHTML = automacoes.map((a) => {
    const palavras = a.match_any
      ? '<span class="palavra">qualquer palavra</span>'
      : (a.keyword ?? '').split(',').filter(Boolean)
          .map((k) => `<span class="palavra">${esc(k.trim())}</span>`).join('')

    return `
      <div class="linha-auto">
        ${miniaturaDoPost(a)}
        <div class="info">
          <div class="nome">${esc(a.nome)}</div>
          <div class="palavras">${palavras || '<span class="palavra">sem palavra</span>'}</div>
        </div>
        <span class="selo ${a.active ? 'selo-ok' : 'selo-off'}">
          ${a.active ? '● ligada' : '○ desligada'}
        </span>
        <button class="btn btn-pequeno" onclick="abrirEditor('${a.id}')">Editar</button>
        <button class="btn btn-pequeno btn-perigo" onclick="apagarAutomacao('${a.id}')">🗑</button>
      </div>`
  }).join('')
}

// ---------------------------------------------------------------------
// Sub-aba: INTERACOES
// A planilha de quem ja falou com as suas automacoes.
// ---------------------------------------------------------------------
let leads = []
let buscaLeads = ''

// "ha 5 min", "ontem", "12/07". Data crua nao diz nada pra quem olha rapido.
function quandoFoi(iso) {
  if (!iso) return '<span class="fraco">nunca</span>'
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `ha ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `ha ${horas}h`
  const dias = Math.floor(horas / 24)
  if (dias === 1) return 'ontem'
  if (dias < 7) return `ha ${dias} dias`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

async function carregarInteracoes() {
  const alvo = $('#listaLeads')

  if (!sb) {
    $('#resumoLeads').innerHTML = ''
    alvo.innerHTML = `
      <div class="vazio">
        <div class="icone">📋</div>
        <h3>Conecte o Supabase pra ver as interacoes</h3>
        <p>Aqui vai aparecer todo mundo que comentou e recebeu a sua DM</p>
      </div>`
    return
  }

  alvo.innerHTML = '<p class="subtitulo">Carregando...</p>'

  try {
    // Tres buscas de uma vez: as pessoas, as entregas (pra contar quantas
    // DMs cada uma recebeu) e as automacoes (pra mostrar o nome, nao o id).
    const [rLeads, rEntregas] = await Promise.all([
      sb.from('ig_leads').select('*').order('last_dm_at', { ascending: false, nullsFirst: false }),
      sb.from('ig_deliveries').select('ig_user_id, status, ts'),
    ])

    if (rLeads.error) throw rLeads.error

    const entregas = rEntregas.data ?? []
    const contagem = {}
    for (const e of entregas) {
      if (e.status !== 'ok') continue
      contagem[e.ig_user_id] = (contagem[e.ig_user_id] ?? 0) + 1
    }

    if (!automacoes.length) await carregarAutomacoes()
    const nomeAuto = {}
    for (const a of automacoes) nomeAuto[a.id] = a.nome

    leads = (rLeads.data ?? []).map((l) => ({
      ...l,
      interacoes: contagem[l.ig_user_id] ?? 0,
      automacao: nomeAuto[l.automation_id] ?? '',
    }))
  } catch (e) {
    console.error('[interacoes]', e)
    $('#resumoLeads').innerHTML = ''
    alvo.innerHTML = `<p class="aviso">Nao consegui carregar as interacoes agora.
      Recarregue a pagina pra tentar de novo.</p>`
    return
  }

  desenharInteracoes()
}

function leadsFiltrados() {
  const q = buscaLeads.trim().toLowerCase()
  if (!q) return leads
  return leads.filter((l) => [
    l.username, l.last_keyword, l.email, l.telefone, l.automacao,
    ...(l.tags ?? []),
  ].filter(Boolean).join(' ').toLowerCase().includes(q))
}

function desenharInteracoes() {
  const alvo = $('#listaLeads')
  const lista = leadsFiltrados()

  // O resumo de cima: os numeros que valem olhar antes da planilha.
  const seteDias = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recentes = leads.filter((l) => l.last_dm_at && new Date(l.last_dm_at).getTime() > seteDias).length
  const comContato = leads.filter((l) => l.email || l.telefone).length
  const clicaram = leads.filter((l) => l.link_sent).length

  $('#resumoLeads').innerHTML = `
    <div class="cartao">
      <span class="rotulo">Pessoas</span>
      <div class="numerao">${leads.length}</div>
      <p class="ajuda">Ja falaram com voce</p>
    </div>
    <div class="cartao">
      <span class="rotulo">Nos ultimos 7 dias</span>
      <div class="numerao">${recentes}</div>
      <p class="ajuda">Movimento recente</p>
    </div>
    <div class="cartao">
      <span class="rotulo">Receberam o link</span>
      <div class="numerao">${clicaram}</div>
      <p class="ajuda">Chegaram ate o final da conversa</p>
    </div>
    <div class="cartao">
      <span class="rotulo">Deixaram contato</span>
      <div class="numerao">${comContato}</div>
      <p class="ajuda">Email ou telefone na conversa</p>
    </div>`

  if (!leads.length) {
    alvo.innerHTML = `
      <div class="vazio">
        <div class="icone">📋</div>
        <h3>Ninguem interagiu ainda</h3>
        <p>Assim que alguem comentar a sua palavra, a pessoa aparece aqui</p>
      </div>`
    return
  }

  if (!lista.length) {
    alvo.innerHTML = `<div class="vazio"><div class="icone">🔎</div>
      <h3>Nada encontrado</h3><p>Ninguem bate com "${esc(buscaLeads)}"</p></div>`
    return
  }

  alvo.innerHTML = `
    <div class="tabela-rolo">
      <table class="tabela">
        <thead>
          <tr>
            <th>Pessoa</th>
            <th>Origem</th>
            <th>Palavra</th>
            <th>Automacao</th>
            <th>Contato</th>
            <th>Etiquetas</th>
            <th class="num">Interacoes</th>
            <th>Onde parou</th>
            <th>Ultima vez</th>
          </tr>
        </thead>
        <tbody>
          ${lista.map((l) => {
            const origem = l.last_source === 'comment'
              ? '<span class="palavra">💬 comentario</span>'
              : l.last_source === 'dm'
                ? '<span class="palavra">✉️ direct</span>'
                : `<span class="palavra">${esc(l.last_source ?? '?')}</span>`

            const contato = [
              l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : '',
              l.telefone ? esc(l.telefone) : '',
            ].filter(Boolean).join('<br>') || '<span class="fraco">nao deixou</span>'

            const tags = (l.tags ?? []).length
              ? l.tags.map((t) => `<span class="palavra">${esc(t)}</span>`).join(' ')
              : '<span class="fraco">sem etiqueta</span>'

            const parou = l.link_sent
              ? '<span class="selo selo-ok">✓ recebeu o link</span>'
              : l.flow_step
                ? `<span class="selo">passo ${esc(String(l.flow_step))}</span>`
                : '<span class="fraco">so a 1a mensagem</span>'

            return `
              <tr>
                <td>
                  <a class="pessoa" href="https://instagram.com/${esc(l.username ?? '')}"
                     target="_blank" rel="noopener">@${esc(l.username ?? 'sem nome')}</a>
                </td>
                <td>${origem}</td>
                <td>${l.last_keyword ? `<span class="palavra">${esc(l.last_keyword)}</span>`
                                     : '<span class="fraco">-</span>'}</td>
                <td>${l.automacao ? esc(l.automacao) : '<span class="fraco">apagada</span>'}</td>
                <td>${contato}</td>
                <td><div class="palavras">${tags}</div></td>
                <td class="num">${l.interacoes}</td>
                <td>${parou}</td>
                <td class="fraco">${quandoFoi(l.last_dm_at)}</td>
              </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    <p class="ajuda" style="margin-top:10px">
      Mostrando ${lista.length} de ${leads.length} ${leads.length === 1 ? 'pessoa' : 'pessoas'}
    </p>`
}

// Baixa o que esta na tela (ja filtrado) como planilha de verdade.
function exportarLeads() {
  const lista = leadsFiltrados()
  if (!lista.length) {
    alert('Nao tem nada pra baixar ainda.')
    return
  }

  const colunas = ['usuario', 'id_instagram', 'origem', 'palavra', 'automacao', 'email',
                   'telefone', 'etiquetas', 'interacoes', 'recebeu_link', 'ultima_vez']

  // Ponto e virgula, porque o Excel em portugues abre assim sem baguncar.
  const celula = (v) => {
    const s = String(v ?? '')
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const linhas = lista.map((l) => [
    l.username ?? '', l.ig_user_id ?? '', l.last_source ?? '', l.last_keyword ?? '',
    l.automacao ?? '', l.email ?? '', l.telefone ?? '', (l.tags ?? []).join(', '),
    l.interacoes, l.link_sent ? 'sim' : 'nao',
    l.last_dm_at ? new Date(l.last_dm_at).toLocaleString('pt-BR') : '',
  ].map(celula).join(';'))

  // O ﻿ (BOM) e o que faz o Excel entender acento. Sem ele, sai "JoÃ£o".
  const csv = '﻿' + [colunas.join(';'), ...linhas].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `interacoes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function apagarAutomacao(id) {
  const a = automacoes.find((x) => x.id === id)
  if (!confirm(`Apagar a automacao "${a?.nome ?? ''}"? Isso nao tem volta.`)) return

  if (sb) {
    try {
      const { error } = await sb.from('ig_automations').delete().eq('id', id)
      if (error) throw error
    } catch (e) {
      alert('Nao consegui apagar agora. Tente de novo.')
      return
    }
  } else {
    gravarAutomacoesLocais(lerAutomacoesLocais().filter((x) => x.id !== id))
  }
  await carregarAutomacoes()
  carregarInicio()
}

// =====================================================================
// O EDITOR
// =====================================================================

// Tudo o que a pessoa esta editando fica aqui dentro.
// Repare no "ehLink": e um estado PROPRIO, nao deduzido da URL estar
// preenchida. E por isso que o campo do link aparece na hora, mesmo vazio.
let ed = null
let sujo = false        // tem coisa nao salva?
let seqPasso = 1        // gerador dos ids dos passos
let postsCache = null   // os posts do Instagram (busca uma vez so)

function editorVazio() {
  return {
    id: null,
    nome: '',
    palavras: [],
    qualquer: false,
    ativa: true,
    posts: [],
    respostaPublica: '',
    variacoes: [],
    mensagem: '',
    temBotao: true,      // o botao ja vem LIGADO nas automacoes novas
    textoBotao: '',
    ehLink: true,        // comeca em "Um link"
    link: '',
    passos: [],
    anexo: '',
  }
}

// Le a automacao salva no banco e transforma no formato do editor.
function doFlowParaEditor(a) {
  const e = editorVazio()
  e.id = a.id
  e.nome = a.nome ?? ''
  e.palavras = (a.keyword ?? '').split(',').map((k) => k.trim()).filter(Boolean)
  e.qualquer = !!a.match_any
  e.ativa = a.active !== false
  e.posts = a.media_ids ?? []
  e.respostaPublica = a.public_reply ?? ''
  e.variacoes = a.public_reply_variants ?? []
  e.anexo = (a.asset_ids ?? [])[0] ?? ''

  const passos = a.flow?.steps ?? []
  // O PRIMEIRO do array e sempre a Mensagem 1, nao importa o id dele.
  const msg1 = passos[0]
  if (msg1) {
    e.mensagem = msg1.message ?? ''
    const b = (msg1.buttons ?? [])[0]
    if (b) {
      e.temBotao = true
      e.textoBotao = b.title ?? ''
      e.ehLink = !!(b.url && b.url.trim())
      e.link = b.url ?? ''
    } else {
      e.temBotao = false
    }
  }

  // do segundo passo em diante e a sequencia
  e.passos = passos.slice(1).map((s) => ({
    id: s.id,
    message: s.message ?? '',
    buttons: (s.buttons ?? []).map((b) => ({
      title: b.title ?? '',
      // o destino tambem e estado proprio, pelo mesmo motivo do ehLink
      destino: (b.url && b.url.trim()) ? 'link'
             : (b.next !== null && b.next !== undefined) ? 'proximo'
             : 'encerrar',
      next: b.next ?? null,
      url: b.url ?? '',
    })),
  }))

  // o proximo id novo comeca depois do maior que ja existe
  seqPasso = Math.max(1, ...passos.map((s) => Number(s.id) || 0)) + 1
  return e
}

// Transforma o que esta no editor no formato do banco (o flow).
function doEditorParaFlow() {
  const steps = []

  // Mensagem 1 (sempre o primeiro do array)
  const msg1 = { id: 1, message: ed.mensagem.trim(), buttons: [] }

  if (ed.temBotao && ed.textoBotao.trim()) {
    if (ed.ehLink) {
      // "Um link": um botao so, com a URL. Uma etapa e acabou.
      msg1.buttons.push({ title: ed.textoBotao.trim().slice(0, 20), url: ed.link.trim() })
    } else if (ed.passos.length) {
      // "Continua a conversa": o botao aponta pro segundo passo.
      msg1.buttons.push({ title: ed.textoBotao.trim().slice(0, 20), next: ed.passos[0].id })
    }
  }
  steps.push(msg1)

  // os passos seguintes
  for (const p of ed.passos) {
    steps.push({
      id: p.id,
      message: (p.message ?? '').trim(),
      buttons: (p.buttons ?? [])
        .filter((b) => b.title?.trim())
        .map((b) => {
          const titulo = b.title.trim().slice(0, 20)
          if (b.destino === 'link') return { title: titulo, url: (b.url ?? '').trim() }
          if (b.destino === 'proximo' && b.next) return { title: titulo, next: b.next }
          // "encerrar": botao sem destino. Nao e enviado, a conversa acaba ali.
          return { title: titulo }
        }),
    })
  }

  return { steps }
}

function abrirEditor(id) {
  const a = id ? automacoes.find((x) => x.id === id) : null
  ed = a ? doFlowParaEditor(a) : editorVazio()
  if (!a) seqPasso = 1
  sujo = false

  $('#editorTitulo').textContent = a ? `Editando: ${a.nome}` : 'Nova automacao'
  $('#editor').classList.add('aberto')

  // joga o estado nos campos
  $('#edNome').value = ed.nome
  $('#edQualquer').checked = ed.qualquer
  $('#edRespostaPublica').value = ed.respostaPublica
  $('#edMensagem').value = ed.mensagem
  $('#edTemBotao').checked = ed.temBotao
  $('#edTextoBotao').value = ed.textoBotao
  $('#edAcaoBotao').value = ed.ehLink ? 'link' : 'conversa'
  $('#edLink').value = ed.link
  $('#edAnexo').value = ed.anexo

  desenharPalavras()
  desenharVariacoes()
  desenharPassos()
  atualizarAreas()
  carregarPosts()
  atualizarPrevia()
}

function fecharEditor() {
  // nao perder o que foi digitado por um clique errado
  if (sujo && !confirm('Voce tem alteracoes nao salvas. Sair mesmo assim?')) return
  $('#editor').classList.remove('aberto')
  ed = null
}

// Mostra ou esconde as areas conforme as escolhas.
function atualizarAreas() {
  $('#areaBotao').style.display = ed.temBotao ? '' : 'none'
  // O campo do link aparece NA HORA quando a acao e "link", mesmo com a
  // URL ainda vazia. Quem manda e o ed.ehLink, nao o conteudo do campo.
  $('#areaLink').style.display = ed.ehLink ? '' : 'none'
  $('#areaConversa').style.display = ed.ehLink ? 'none' : ''
  $('#refMensagem1').textContent = ed.mensagem.trim() || '(escreva a sua mensagem la em cima)'

  // o contador do botao. Passou de 20, avisa em vermelho: o Instagram corta.
  const n = ed.textoBotao.length
  $('#contaBotao').textContent = n
  const ajuda = $('#ajudaBotao')
  if (n > 20) {
    ajuda.style.color = 'var(--erro)'
    ajuda.innerHTML = `<span id="contaBotao">${n}</span>/20 letras. Passou do limite: o ` +
      `Instagram vai cortar em "<strong>${esc(ed.textoBotao.slice(0, 20))}</strong>".`
  } else {
    ajuda.style.color = ''
    ajuda.innerHTML = `<span id="contaBotao">${n}</span>/20 letras. O Instagram corta o ` +
      `titulo do botao em 20 letras.`
  }
}

// ---------------------------------------------------------------------
// As palavras-chave (as etiquetas)
// ---------------------------------------------------------------------
function desenharPalavras() {
  const caixa = $('#caixaPalavras')
  const input = $('#edPalavraInput')
  caixa.querySelectorAll('.tag').forEach((t) => t.remove())
  ed.palavras.forEach((p, i) => {
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.innerHTML = `${esc(p)} <button type="button" aria-label="tirar">×</button>`
    tag.querySelector('button').onclick = () => {
      ed.palavras.splice(i, 1); sujo = true; desenharPalavras()
    }
    caixa.insertBefore(tag, input)
  })
}

function addPalavra(texto) {
  const p = texto.trim().replace(/,$/, '')
  if (!p) return
  if (!ed.palavras.includes(p)) { ed.palavras.push(p); sujo = true }
  desenharPalavras()
}

// ---------------------------------------------------------------------
// As variacoes A/B da resposta publica
// ---------------------------------------------------------------------
function desenharVariacoes() {
  $('#edPubVariacoes').innerHTML = ed.variacoes.map((v, i) => `
    <div style="display:flex; gap:6px; margin-top:6px">
      <input class="campo" value="${esc(v)}" data-var="${i}" placeholder="Outra forma de dizer">
      <button class="btn btn-pequeno btn-perigo" data-tirar-var="${i}">×</button>
    </div>`).join('')

  $$('#edPubVariacoes [data-var]').forEach((el) => {
    el.oninput = () => { ed.variacoes[Number(el.dataset.var)] = el.value; sujo = true }
  })
  $$('#edPubVariacoes [data-tirar-var]').forEach((el) => {
    el.onclick = () => {
      ed.variacoes.splice(Number(el.dataset.tirarVar), 1); sujo = true; desenharVariacoes()
    }
  })
}

// ---------------------------------------------------------------------
// O seletor de posts
// ---------------------------------------------------------------------
// Busca os posts uma vez so e guarda. O editor e a lista de automacoes
// usam os dois a mesma lista.
async function garantirPosts() {
  if (postsCache) return postsCache
  if (!sb) return (postsCache = [])
  try {
    const { data, error } = await sb.functions.invoke('ig-media')
    postsCache = (error || !data?.conectado) ? [] : (data.posts ?? [])
  } catch {
    postsCache = []
  }
  return postsCache
}

async function carregarPosts() {
  const alvo = $('#edPosts')

  if (!sb) {
    alvo.innerHTML = `<p class="aviso">Conecte o Instagram pra escolher posts.
      Por enquanto, a automacao vale pra todos.</p>`
    return
  }

  if (!postsCache) {
    alvo.innerHTML = '<p class="subtitulo">Buscando seus posts...</p>'
    await garantirPosts()
  }

  if (!postsCache.length) {
    alvo.innerHTML = `<p class="aviso">Nao consegui listar os posts agora.
      Sem escolher nenhum, a automacao vale pra todos.</p>`
    return
  }

  alvo.innerHTML = `<div class="grade-posts">${postsCache.map((p) => `
    <div class="post-mini ${ed.posts.includes(p.id) ? 'escolhido' : ''}" data-post="${esc(p.id)}"
         title="${esc(p.legenda)}">
      ${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : ''}
      <span class="marca">✓</span>
    </div>`).join('')}</div>`

  $$('#edPosts [data-post]').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.post
      const i = ed.posts.indexOf(id)
      if (i >= 0) ed.posts.splice(i, 1); else ed.posts.push(id)
      sujo = true
      el.classList.toggle('escolhido')
    }
  })
}

// ---------------------------------------------------------------------
// O CONSTRUTOR DE SEQUENCIA (o mini-chat)
// ---------------------------------------------------------------------
function addPasso() {
  ed.passos.push({ id: ++seqPasso, message: '', buttons: [] })
  sujo = true
  desenharPassos()
  atualizarPrevia()
}

function desenharPassos() {
  $('#listaPassos').innerHTML = ed.passos.map((p, i) => {
    // as opcoes de "ir pra outra mensagem": todos os outros passos
    const opcoes = ed.passos.filter((o) => o.id !== p.id)

    const botoes = (p.buttons ?? []).map((b, j) => `
      <div class="btn-config">
        <div class="btn-config-topo">
          <!-- sem maxlength de proposito: ver a nota no index.html -->
          <input class="campo" style="flex:1" value="${esc(b.title)}"
                 placeholder="Nome do botao" data-bt="${i}:${j}">
          <select class="campo" style="flex:1" data-bd="${i}:${j}">
            <option value="proximo" ${b.destino === 'proximo' ? 'selected' : ''}>ir pra outra mensagem</option>
            <option value="link" ${b.destino === 'link' ? 'selected' : ''}>abrir um link</option>
            <option value="encerrar" ${b.destino === 'encerrar' ? 'selected' : ''}>encerrar</option>
          </select>
          <button class="btn btn-pequeno btn-perigo" data-btirar="${i}:${j}">×</button>
        </div>

        ${b.destino === 'proximo' ? `
          <select class="campo" data-bn="${i}:${j}">
            <option value="">Escolha a mensagem...</option>
            ${opcoes.map((o) => `<option value="${o.id}" ${String(b.next) === String(o.id) ? 'selected' : ''}>
              Mensagem ${ed.passos.findIndex((x) => x.id === o.id) + 2}
            </option>`).join('')}
            <option value="novo">＋ criar uma mensagem nova</option>
          </select>` : ''}

        ${b.destino === 'link' ? `
          <textarea class="campo campo-link" data-bu="${i}:${j}"
            placeholder="https://exemplo.com/a-sua-pagina">${esc(b.url)}</textarea>
          <p class="ajuda">O link vai aqui, nunca no nome do botao</p>` : ''}

        ${b.destino === 'encerrar'
          ? '<p class="ajuda">A conversa acaba aqui. Esse botao nao aparece pra pessoa.</p>' : ''}
      </div>`).join('')

    return `
      <div class="passo">
        <div class="passo-topo">
          <span class="passo-nome">Mensagem ${i + 2}</span>
          <button class="btn btn-pequeno btn-perigo" data-ptirar="${i}">🗑</button>
        </div>
        <textarea class="campo" data-pm="${i}" style="min-height:60px"
          placeholder="O que essa mensagem diz">${esc(p.message)}</textarea>
        ${botoes}
        <button class="btn btn-pequeno" data-padd="${i}" style="margin-top:8px">＋ botao</button>
      </div>`
  }).join('')

  ligarEventosPassos()
}

function ligarEventosPassos() {
  // o texto da mensagem
  $$('#listaPassos [data-pm]').forEach((el) => {
    el.oninput = () => {
      ed.passos[Number(el.dataset.pm)].message = el.value
      sujo = true; atualizarPrevia()
    }
  })

  // apagar a mensagem
  $$('#listaPassos [data-ptirar]').forEach((el) => {
    el.onclick = () => {
      const i = Number(el.dataset.ptirar)
      const idApagado = ed.passos[i].id
      ed.passos.splice(i, 1)
      // limpa os botoes que apontavam pra ela, pra nao ficar destino quebrado
      for (const p of ed.passos) {
        for (const b of p.buttons ?? []) {
          if (String(b.next) === String(idApagado)) { b.next = null; b.destino = 'encerrar' }
        }
      }
      sujo = true; desenharPassos(); atualizarPrevia()
    }
  })

  // adicionar botao
  $$('#listaPassos [data-padd]').forEach((el) => {
    el.onclick = () => {
      ed.passos[Number(el.dataset.padd)].buttons.push({
        title: '', destino: 'proximo', next: null, url: '',
      })
      sujo = true; desenharPassos(); atualizarPrevia()
    }
  })

  // o nome do botao
  $$('#listaPassos [data-bt]').forEach((el) => {
    el.oninput = () => {
      const [i, j] = el.dataset.bt.split(':').map(Number)
      ed.passos[i].buttons[j].title = el.value
      sujo = true; atualizarPrevia()
    }
  })

  // o DESTINO do botao
  $$('#listaPassos [data-bd]').forEach((el) => {
    el.onchange = () => {
      const [i, j] = el.dataset.bd.split(':').map(Number)
      const b = ed.passos[i].buttons[j]
      b.destino = el.value

      // O detalhe critico: se a pessoa colou um link no NOME do botao
      // (que so aceita 20 letras) e agora escolheu "abrir um link", o
      // sistema move o link pro campo certo e poe um nome padrao.
      if (b.destino === 'link' && /^https?:\/\//i.test(b.title.trim())) {
        b.url = b.title.trim()
        b.title = 'Acessar'
      }
      sujo = true; desenharPassos(); atualizarPrevia()
    }
  })

  // "ir pra outra mensagem": qual?
  $$('#listaPassos [data-bn]').forEach((el) => {
    el.onchange = () => {
      const [i, j] = el.dataset.bn.split(':').map(Number)
      const b = ed.passos[i].buttons[j]
      if (el.value === 'novo') {
        // cria a mensagem nova ja apontada por este botao
        const novo = { id: ++seqPasso, message: '', buttons: [] }
        ed.passos.push(novo)
        b.next = novo.id
      } else {
        b.next = el.value ? Number(el.value) : null
      }
      sujo = true; desenharPassos(); atualizarPrevia()
    }
  })

  // a URL do botao
  $$('#listaPassos [data-bu]').forEach((el) => {
    el.oninput = () => {
      const [i, j] = el.dataset.bu.split(':').map(Number)
      ed.passos[i].buttons[j].url = el.value
      sujo = true; atualizarPrevia()
    }
  })

  // apagar o botao
  $$('#listaPassos [data-btirar]').forEach((el) => {
    el.onclick = () => {
      const [i, j] = el.dataset.btirar.split(':').map(Number)
      ed.passos[i].buttons.splice(j, 1)
      sujo = true; desenharPassos(); atualizarPrevia()
    }
  })
}

// ---------------------------------------------------------------------
// A PREVIA AO VIVO
//
// Mostra exatamente o que e enviado de verdade: o botao COLADO no balao,
// e botao sem destino nao aparece (porque tambem nao e enviado).
// ---------------------------------------------------------------------
function balaoHtml(texto, botoes, anexo) {
  const t = (texto ?? '').trim()
  if (!t && !botoes.length) return ''

  // corta em 20 letras na previa tambem, pra voce ver o botao exatamente
  // como ele vai chegar (o Instagram corta mesmo)
  const linhasBotoes = botoes.map((b) => `
    <div class="balao-botao">${b.link ? '🔗' : ''} ${esc(b.title.trim().slice(0, 20))}</div>`).join('')

  const linhaAnexo = anexo
    ? `<div class="balao-anexo">📎 ${esc(anexo)}</div>` : ''

  return `<div class="balao">
    ${t ? `<div class="balao-texto">${esc(t)}</div>` : ''}
    ${linhaAnexo}${linhasBotoes}
  </div>`
}

function atualizarPrevia() {
  if (!ed) return
  const alvo = $('#previaCorpo')
  const partes = []

  // Mensagem 1
  const botoes1 = []
  if (ed.temBotao && ed.textoBotao.trim()) {
    if (ed.ehLink && ed.link.trim()) {
      botoes1.push({ title: ed.textoBotao, link: true })
    } else if (!ed.ehLink && ed.passos.length) {
      botoes1.push({ title: ed.textoBotao, link: false })
    }
    // botao sem destino (link vazio, ou conversa sem nenhuma mensagem 2)
    // nao entra: igual nao e enviado de verdade
  }

  const nomeAnexo = ed.anexo
    ? ($('#edAnexo')?.selectedOptions?.[0]?.textContent ?? 'arquivo') : ''
  const b1 = balaoHtml(ed.mensagem, botoes1, nomeAnexo)
  if (b1) partes.push(b1)

  // as mensagens seguintes (so no modo "continua a conversa")
  if (!ed.ehLink) {
    for (const p of ed.passos) {
      const bts = (p.buttons ?? [])
        .filter((b) => b.title?.trim())
        // so aparece botao com destino de verdade
        .filter((b) => (b.destino === 'link' && b.url?.trim())
                    || (b.destino === 'proximo' && b.next))
        .map((b) => ({ title: b.title, link: b.destino === 'link' }))
      const html = balaoHtml(p.message, bts, '')
      if (html) partes.push(html)
    }
  }

  alvo.innerHTML = partes.length
    ? partes.join('')
    : '<p class="previa-vazio">Escreva a sua mensagem e ela aparece aqui</p>'
}

// ---------------------------------------------------------------------
// SALVAR
// ---------------------------------------------------------------------
async function salvar() {
  // validacao amigavel, antes de tentar salvar
  if (!ed.nome.trim()) {
    alert('Dê um nome pra automacao, pra voce se achar depois.')
    $('#edNome').focus(); return
  }
  if (!ed.palavras.length && !ed.qualquer) {
    alert('Adicione pelo menos uma palavra que ativa, ou ligue "qualquer palavra ativa".')
    $('#edPalavraInput').focus(); return
  }
  if (!ed.mensagem.trim()) {
    alert('Escreva a mensagem que a pessoa recebe.')
    $('#edMensagem').focus(); return
  }
  if (ed.temBotao && !ed.textoBotao.trim()) {
    alert('Escreva o texto do botao, ou desligue o botao.')
    $('#edTextoBotao').focus(); return
  }
  if (ed.temBotao && ed.ehLink && !ed.link.trim()) {
    alert('Cole o link completo, senao o botao nao leva a lugar nenhum.')
    $('#edLink').focus(); return
  }
  if (ed.temBotao && !ed.ehLink && !ed.passos.length) {
    alert('No modo "continua a conversa", adicione pelo menos a Mensagem 2.')
    return
  }

  const registro = {
    nome: ed.nome.trim(),
    keyword: ed.palavras.join(','),
    match_any: ed.qualquer,
    active: ed.ativa,
    media_ids: ed.posts,
    public_reply: ed.respostaPublica.trim(),
    public_reply_variants: ed.variacoes.map((v) => v.trim()).filter(Boolean),
    flow: doEditorParaFlow(),
    asset_ids: ed.anexo ? [ed.anexo] : [],
    updated_at: new Date().toISOString(),
  }

  // -------------------------------------------------------------------
  // Sem Supabase (o modo de teste local): guarda so no navegador e avisa
  // com todas as letras que isso NAO e o sistema de verdade ainda.
  // -------------------------------------------------------------------
  if (!sb) {
    const lista = lerAutomacoesLocais()
    if (ed.id) {
      const i = lista.findIndex((x) => x.id === ed.id)
      if (i >= 0) lista[i] = { ...lista[i], ...registro }
    } else {
      lista.unshift({ ...registro, id: 'local-' + Date.now(), created_at: new Date().toISOString() })
    }
    gravarAutomacoesLocais(lista)
    sujo = false
    alert('Salvo APENAS neste navegador (modo de teste local).\n\n' +
          'Isso serve pra voce ver o sistema funcionando. Pra salvar de verdade e a ' +
          'automacao rodar no Instagram, conecte o Supabase seguindo o LEIA-ME.')
    $('#editor').classList.remove('aberto')
    await carregarAutomacoes()
    carregarInicio()
    return
  }

  // -------------------------------------------------------------------
  // Com Supabase: salva de verdade.
  // -------------------------------------------------------------------
  const btn = $('#btnSalvar')
  btn.disabled = true
  btn.textContent = 'Salvando...'
  try {
    const { error } = ed.id
      ? await sb.from('ig_automations').update(registro).eq('id', ed.id)
      : await sb.from('ig_automations').insert(registro)
    if (error) throw error

    sujo = false
    $('#editor').classList.remove('aberto')
    await carregarAutomacoes()
    carregarInicio()
  } catch (e) {
    console.error(e)
    alert('Nao consegui salvar agora. Confira se voce esta logada e tente de novo.')
  } finally {
    btn.disabled = false
    btn.textContent = 'Salvar automacao'
  }
}

// =====================================================================
// LIGANDO TUDO
// =====================================================================
const EMOJIS = ['🫶','👀','😍','🥰','😂','😮','🔥','✨','💌','👉','🙌','💕']

function montarEmojis() {
  $('#barraEmojis').innerHTML = EMOJIS
    .map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')

  $$('#barraEmojis [data-emoji]').forEach((b) => {
    b.onclick = () => {
      // insere no cursor, e nao no fim do texto
      const campo = $('#edMensagem')
      const ini = campo.selectionStart ?? campo.value.length
      const fim = campo.selectionEnd ?? campo.value.length
      campo.value = campo.value.slice(0, ini) + b.dataset.emoji + campo.value.slice(fim)
      ed.mensagem = campo.value
      sujo = true
      campo.focus()
      const pos = ini + b.dataset.emoji.length
      campo.setSelectionRange(pos, pos)
      atualizarAreas()
      atualizarPrevia()
    }
  })
}

function iniciar() {
  // login
  $('#formLogin').addEventListener('submit', tentarLogin)
  $('#btnSair').addEventListener('click', sair)

  // menu
  $$('.menu-item[data-secao]').forEach((b) =>
    b.addEventListener('click', () => irPara(b.dataset.secao)))
  $$('[data-ir]').forEach((b) =>
    b.addEventListener('click', () => irPara(b.dataset.ir)))

  // sub-abas
  $$('.aba').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)))

  // editor
  $('#btnNovaAutomacao').addEventListener('click', () => abrirEditor())
  $('#btnExportarLeads').addEventListener('click', exportarLeads)
  $('#buscaLeads').addEventListener('input', (e) => {
    buscaLeads = e.target.value
    desenharInteracoes()
  })
  $('#btnFecharEditor').addEventListener('click', fecharEditor)
  $('#btnSalvar').addEventListener('click', salvar)
  $('#btnAddPasso').addEventListener('click', addPasso)

  $('#edNome').addEventListener('input', (e) => { ed.nome = e.target.value; sujo = true })

  $('#edPalavraInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addPalavra(e.target.value)
      e.target.value = ''
    }
    // apagar a ultima etiqueta com o backspace no campo vazio
    if (e.key === 'Backspace' && !e.target.value && ed.palavras.length) {
      ed.palavras.pop(); sujo = true; desenharPalavras()
    }
  })
  // se a pessoa clicar fora sem apertar Enter, nao perde o que digitou
  $('#edPalavraInput').addEventListener('blur', (e) => {
    if (e.target.value.trim()) { addPalavra(e.target.value); e.target.value = '' }
  })

  $('#edQualquer').addEventListener('change', (e) => { ed.qualquer = e.target.checked; sujo = true })

  $('#edRespostaPublica').addEventListener('input', (e) => {
    ed.respostaPublica = e.target.value; sujo = true
  })
  $('#btnAddVariacao').addEventListener('click', () => {
    ed.variacoes.push(''); sujo = true; desenharVariacoes()
  })

  $('#edMensagem').addEventListener('input', (e) => {
    ed.mensagem = e.target.value; sujo = true; atualizarAreas(); atualizarPrevia()
  })

  $('#edTemBotao').addEventListener('change', (e) => {
    ed.temBotao = e.target.checked; sujo = true; atualizarAreas(); atualizarPrevia()
  })

  $('#edTextoBotao').addEventListener('input', (e) => {
    ed.textoBotao = e.target.value; sujo = true; atualizarAreas(); atualizarPrevia()
  })

  $('#edAcaoBotao').addEventListener('change', (e) => {
    // guarda a escolha no estado PROPRIO. E por isso que o campo do link
    // aparece na hora e nao volta atras so porque a URL esta vazia.
    ed.ehLink = e.target.value === 'link'

    // o mesmo cuidado da sequencia: link colado no nome do botao vai pro
    // campo certo, e o botao ganha um nome de gente.
    if (ed.ehLink && /^https?:\/\//i.test(ed.textoBotao.trim())) {
      ed.link = ed.textoBotao.trim()
      ed.textoBotao = 'Acessar'
      $('#edTextoBotao').value = ed.textoBotao
      $('#edLink').value = ed.link
    }
    sujo = true; atualizarAreas(); atualizarPrevia()
  })

  $('#edLink').addEventListener('input', (e) => {
    ed.link = e.target.value; sujo = true; atualizarPrevia()
  })

  $('#edAnexo').addEventListener('change', (e) => {
    ed.anexo = e.target.value; sujo = true; atualizarPrevia()
  })

  montarEmojis()

  // fechar o editor com Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#editor').classList.contains('aberto')) fecharEditor()
  })

  // avisa se fechar a aba com coisa nao salva
  window.addEventListener('beforeunload', (e) => {
    if (sujo && $('#editor').classList.contains('aberto')) {
      e.preventDefault()
      e.returnValue = ''
    }
  })

  conferirSessao()
}

// deixa essas duas acessiveis pelos botoes escritos no HTML
window.abrirEditor = abrirEditor
window.apagarAutomacao = apagarAutomacao
window.verTudoMetricas = verTudoMetricas

iniciar()
