# O seu sistema de automação de DM

Um painel web com login e um motor de automação de direct do Instagram: alguém comenta uma
palavra num post seu, o sistema manda a DM sozinho, com botão, e a conversa segue.

Este arquivo é o passo a passo pra colocar no ar. Vai com calma, um passo por vez.

---

## Passo 0: ver o sistema funcionando agora (sem configurar nada)

Você já pode abrir e navegar o sistema inteiro antes de configurar qualquer coisa.

1. No terminal, dentro desta pasta, rode:
   ```
   python3 -m http.server 5173
   ```
2. Abra no navegador: **http://localhost:5173**
3. Entre com **qualquer e-mail** e uma **senha de 5 dígitos** (ex: `12345`). Entra direto.

Nesse modo, o sistema não usa o Supabase pra nada. Serve pra você clicar em tudo: o menu, o
Início, as Métricas, criar uma automação e ver a prévia da DM ao vivo. As automações que você
criar aqui ficam salvas só no seu navegador, não valem como sistema no ar.

Os passos abaixo são pra colocar no ar de verdade, com login e dados salvos.

---

## Passo 1: criar o projeto no Supabase e rodar os scripts

1. Crie uma conta em [supabase.com](https://supabase.com) e crie um projeto novo.
2. Abra o **SQL Editor** (o ícone de banco de dados no menu da esquerda).
3. Rode os 4 arquivos da pasta `supabase/sql/`, **nesta ordem**, um de cada vez (cole o
   conteúdo, aperte Run):

   | Arquivo | O que faz |
   |---|---|
   | `01-tabelas.sql` | Cria as tabelas |
   | `02-freio.sql` | Cria o freio de envio |
   | `03-rls.sql` | Tranca o banco |
   | `04-cron.sql` | Agenda os robôs (leia o passo 5 antes) |

> **O `02-freio.sql` é o passo que não pode faltar.** É ele que conta quantas DMs saíram e
> segura o resto na fila. Sem essas duas funções, o sistema falha fechado: **nenhuma DM por
> comentário sai**, tudo vai pra fila, e a fila nunca anda. E não aparece erro nenhum na tela,
> o sistema só fica mudo. Se um dia parar de enviar do nada, comece olhando aqui.

Deixe o `04-cron.sql` pro passo 5, porque ele precisa de valores que você só vai ter depois.

---

## Passo 2: criar o seu login

Ainda no Supabase:

1. Vá em **Authentication** > **Users** > **Add user** > **Create new user**.
2. Coloque o seu e-mail e uma senha, e marque **Auto Confirm User**.

É esse login que vale quando o site estiver no ar. Não existe tela de "criar conta" de
propósito: o sistema é só seu.

---

## Passo 3: configurar os segredos

No Supabase, vá em **Edge Functions** > **Secrets** (ou **Settings** > **Edge Functions**) e
adicione um por um. Alguns valores você só vai ter no passo 6, então volte aqui depois.

| Segredo | O que é | De onde vem |
|---|---|---|
| `IG_ACCESS_TOKEN` | O token da sua conta | Passo 6 |
| `IG_ACCOUNT_ID` | O id numérico da sua conta | Passo 6 |
| `APP_SECRET` | O segredo do app do Meta | Passo 6 |
| `APP_SECRET_ENFORCE` | Deixe `false` por enquanto | Você mesmo |
| `VERIFY_TOKEN` | Uma senha que você inventa | Você mesmo |
| `GRAPH_API_VERSION` | `v21.0` | Fixo |
| `SCHED_SECRET` | Outra senha que você inventa | Você mesmo |
| `TEST_IG_ACCOUNTS` | O id da sua conta de teste | Passo 9 |

Pra gerar as senhas (`VERIFY_TOKEN` e `SCHED_SECRET`), rode no terminal:
```
openssl rand -hex 16
```
Guarde as duas num lugar seguro. Você vai precisar delas de novo.

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já vêm preenchidos sozinhos pelo Supabase, você
> não precisa criar.

---

## Passo 4: publicar as funções

Instale a CLI do Supabase e rode, dentro desta pasta:

```
supabase login
supabase link --project-ref SEU_PROJETO_AQUI

# ATENÇÃO no --no-verify-jwt aqui embaixo:
supabase functions deploy instagram-webhook --no-verify-jwt
supabase functions deploy ig-scheduler --no-verify-jwt
supabase functions deploy ig-token-refresh --no-verify-jwt

# estas duas ficam protegidas por login, então SEM o --no-verify-jwt:
supabase functions deploy ig-insights
supabase functions deploy ig-media
```

> **O `--no-verify-jwt` na `instagram-webhook` é obrigatório.** Sem ele, o Instagram não
> consegue chamar a sua função (ele não tem como fazer login no seu Supabase). O webhook
> precisa ser público. Quem protege ele é a assinatura (o `APP_SECRET`) e o `VERIFY_TOKEN`.
> A `ig-scheduler` e a `ig-token-refresh` também são públicas, mas estão trancadas pelo
> `SCHED_SECRET`.

---

## Passo 5: agendar os robôs

Abra o `supabase/sql/04-cron.sql`, troque os dois placeholders (`SEU_PROJETO_AQUI` e
`SEU_SCHED_SECRET_AQUI`) e rode no SQL Editor.

Isso liga dois robôs:
- **ig-scheduler**, a cada 1 minuto: manda o que ficou na fila do freio.
- **ig-token-refresh**, 1x por semana: renova o token antes de vencer.

Pra conferir se estão funcionando, espere 1 minuto e rode:
```sql
select id, status_code, content, created from net._http_response order by created desc limit 5;
```
Você quer ver `status_code = 200`. Se vier **401**, o `x-sched-key` não bate com o
`SCHED_SECRET`. Se vier **404**, a função não foi publicada ou o nome do projeto está errado.

---

## Passo 6: o app no Meta for Developers

1. Entre em [developers.facebook.com](https://developers.facebook.com) e crie um app.
2. Adicione o produto **Instagram** > **Instagram API with Instagram Login**.
3. Conecte a sua conta profissional do Instagram (precisa ser conta profissional ou de
   criador, conta pessoal não serve).
4. Libere as permissões: ler comentários, ler mensagens e enviar mensagens.
5. Gere o **token long-lived** e copie o **id numérico da conta**.
6. Copie também o **App Secret** (fica em Configurações > Básico).
7. Volte no passo 3 e cole os três valores nos segredos.

---

## Passo 7: cadastrar o webhook

Ainda no Meta, em **Webhooks**:

1. **URL de callback:**
   `https://SEU_PROJETO_AQUI.supabase.co/functions/v1/instagram-webhook`
2. **Verify token:** o mesmo `VERIFY_TOKEN` que você inventou no passo 3.
3. Clique em verificar e salvar. Se der erro aqui, o `VERIFY_TOKEN` não bate, ou a função não
   foi publicada com `--no-verify-jwt`.
4. **Assine os três campos:** `comments`, `messages` e `messaging_postbacks`.

> **Os três, sem pular nenhum.** O `messaging_postbacks` é o que faz os botões da conversa
> funcionarem. Sem ele, a DM chega bonitinha, a pessoa toca no botão, e não acontece nada.

---

## Passo 8: publicar o painel

O painel é só HTML, CSS e JS. Sobe em qualquer lugar (GitHub Pages, por exemplo).

Antes de subir, abra o `config.js` e troque os dois valores pelos do seu projeto (você acha os
dois em Supabase > Settings > API):

```js
window.CONFIG = {
  SUPABASE_URL: 'https://SEU_PROJETO_AQUI.supabase.co',
  SUPABASE_ANON_KEY: 'a-sua-chave-anon',
}
```

Pode deixar esses dois valores públicos sem medo: quem tranca o banco é o RLS, não essa chave.
A chave que **nunca** pode aparecer aqui é a de **service_role**.

Assim que o site sair do localhost, o login passa a ser o do Supabase (o do passo 2). O modo de
teste local não funciona fora do localhost, de propósito.

---

## Passo 9: testar

1. Pegue uma **segunda conta** do Instagram. A sua própria conta é ignorada de propósito (o
   sistema não responde a você mesma).
2. Descubra o id numérico dela e coloque no segredo `TEST_IG_ACCOUNTS`. Assim ela ignora a
   regra do "1 por dia" e você testa quantas vezes quiser.
3. Crie uma automação no painel com uma palavra fácil (ex: `teste01`).
4. Comente essa palavra num post seu, com a segunda conta.
5. A DM deve chegar em segundos.

**Se não chegar,** olhe nesta ordem:
- Os logs da função: Supabase > Edge Functions > instagram-webhook > Logs.
- A tabela `ig_deliveries`: cada tentativa de envio está lá, com o motivo do erro.
- Se aparecer `na_fila` em tudo: é o freio. Confira se o `02-freio.sql` rodou mesmo.
- Se não aparecer nada nos logs: o webhook não está chegando. Reveja o passo 7.

---

## Passo 10: ligar a trava (depois que funcionar)

Só quando tudo estiver funcionando, mude o segredo `APP_SECRET_ENFORCE` pra `true` e publique
a função de novo.

Isso faz o webhook **recusar** qualquer requisição que não venha comprovadamente do Meta. Antes
disso, ele só avisa no log e processa assim mesmo, o que ajuda nos primeiros testes.

---

# As regras do jogo (leia, é sério)

O Instagram bloqueia conta que abusa. O sistema já vem com freios, mas as regras são estas:

- **Opt-in sempre.** O sistema só responde quem comentou, ou seja, quem pediu. Nada de disparo
  em massa, nada de lista comprada. Isso não é negociável e é o que mantém a sua conta viva.
- **1 DM por pessoa a cada 24h** no gatilho de comentário (as contas de teste ignoram).
- **O freio de envio:** no máximo 6 por minuto, 60 por hora e 180 por dia. Bem abaixo do limite
  do Instagram (que gira em torno de 200 a 300 respostas privadas por dia), de propósito. O que
  passar disso espera na fila e sai depois, sozinho.
- **O disjuntor:** 3 falhas duras seguidas (bloqueio) pausam os envios por 3 horas.
- **A janela de 24h da Meta:** fora de uma interação recente, não dá pra mandar DM. O
  comentário e o toque no botão abrem essa janela.
- **O token vence em cerca de 60 dias.** A renovação automática cuida disso (passo 5).

**Os limites técnicos que valem lembrar:**

| Limite | Quanto |
|---|---|
| Título do botão | 20 letras (o resto é cortado) |
| Botões por mensagem, no formato colado no balão | 3 |
| Botões no formato pílula (o plano B) | 13 |
| Responder um comentário | até cerca de 7 dias depois |
| Linhas por consulta ao banco | 1000 (pagine nas tabelas que crescem) |

---

# O `flow`: como a conversa é guardada

Toda automação guarda a conversa inteira num campo só, o `flow`. Não existe coluna separada de
"mensagem" e "link": tudo mora aqui. É isso que deixa o sistema simples e sem dois caminhos
fazendo a mesma coisa.

```json
{
  "steps": [
    {
      "id": 1,
      "message": "oii! toca no botao aqui embaixo",
      "buttons": [
        { "title": "Quero o link", "next": 2 }
      ]
    },
    {
      "id": 2,
      "message": "aqui esta o material",
      "buttons": [
        { "title": "Ver o material", "url": "https://exemplo.com/material" }
      ]
    }
  ]
}
```

As regras:

- **A Mensagem 1 é sempre o primeiro item do array**, não importa o número do `id` dela. O
  código pega o primeiro do array, ele não procura por `id === 0`.
- Um botão tem **ou** `next` (vai pra outra mensagem) **ou** `url` (abre um link). Nunca os dois.
- Botão sem `next` e sem `url` significa **encerrar**: a conversa acaba ali. Ele não é enviado
  e nem aparece na prévia.
- **"Um link"**: a Mensagem 1 tem um botão com `url`. Uma etapa só, o toque abre o site.
- **"Continua a conversa"**: o botão da Mensagem 1 tem `next` apontando pra Mensagem 2.
- O payload que viaja no botão é `STEP:idDaAutomacao:proximoPasso`. Como o id da automação vai
  junto, duas automações com botão de mesmo nome nunca se misturam.

---

# Os arquivos

```
index.html                  o painel (login + sistema)
app.js                      a lógica do painel
styles.css                  o visual (a cor do sistema está no topo, em --destaque)
config.js                   onde você cola a URL e a chave do Supabase

supabase/sql/
  01-tabelas.sql            as tabelas
  02-freio.sql              o freio (o passo que não pode faltar)
  03-rls.sql                as regras de acesso
  04-cron.sql               os robôs agendados

supabase/functions/
  instagram-webhook/        o cérebro: recebe os eventos e responde
  ig-scheduler/             o carteiro: esvazia a fila e manda os atrasos
  ig-token-refresh/         renova o token antes de vencer
  ig-insights/              as métricas
  ig-media/                 a lista dos seus posts
```

---

# Checklist do que você precisa preencher

- [ ] `config.js`: `SUPABASE_URL` e `SUPABASE_ANON_KEY`
- [ ] `04-cron.sql`: o nome do projeto e o `SCHED_SECRET`
- [ ] Segredo `IG_ACCESS_TOKEN`
- [ ] Segredo `IG_ACCOUNT_ID`
- [ ] Segredo `APP_SECRET`
- [ ] Segredo `APP_SECRET_ENFORCE` (`false` no começo, `true` no final)
- [ ] Segredo `VERIFY_TOKEN`
- [ ] Segredo `GRAPH_API_VERSION` (`v21.0`)
- [ ] Segredo `SCHED_SECRET`
- [ ] Segredo `TEST_IG_ACCOUNTS`
- [ ] O usuário admin criado no Authentication
- [ ] Os campos `comments`, `messages` e `messaging_postbacks` assinados no Meta

---

# Quando algo der errado

| O que acontece | Onde olhar |
|---|---|
| Nenhuma DM sai, e nem dá erro | O `02-freio.sql` rodou? Veja se a `ig_send_queue` está enchendo |
| A DM chega, mas o botão não faz nada | O `messaging_postbacks` foi assinado no Meta? (passo 7) |
| A pessoa recebe a mesma DM repetida | Alguma outra automação (ou um ManyChat antigo) está ligada no mesmo post? |
| O webhook não verifica | O `VERIFY_TOKEN` não bate, ou faltou o `--no-verify-jwt` |
| Parou tudo do nada, depois de uns 2 meses | O token venceu. Veja a tabela `ig_token_status` |
| As métricas não aparecem | Normal se o Instagram ainda não foi conectado. O painel não quebra por isso |

O melhor lugar pra investigar é sempre a tabela **`ig_deliveries`**: cada tentativa de envio
está registrada lá, com o motivo do erro escrito.
