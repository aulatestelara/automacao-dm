# Prompt: conectar o Instagram no sistema

Cole o texto abaixo no Claude Code, na pasta do seu projeto.

Antes de colar, você precisa ter:

- o app já criado em developers.facebook.com, com o caso de uso **"Gerenciar mensagens e conteúdo no Instagram"**
- a sua conta do Instagram como **profissional** (criador ou empresa), não pessoal
- a sua conta do Instagram já adicionada como **Testador do Instagram** no app, e o convite **aceito**
  (o convite chega no Instagram em Configurações > Apps e sites > Convites de testador)
- o **token de acesso** já gerado na tela Instagram > Configuração da API, seção 2

**Muito importante sobre segredos:** o token de acesso e a chave secreta são senhas. Quem tiver o
seu token consegue mandar DM pela sua conta. Não cole os dois direto na conversa do Claude,
principalmente se você estiver gravando a tela ou compartilhando o print com alguém. O prompt
abaixo já pede pro Claude criar um arquivo pra você colar em segurança.

---

```
Quero conectar a minha conta do Instagram no meu sistema de automação de DM.
Eu já gerei o token de acesso no painel da Meta.

Faça o seguinte, nesta ordem:

1. Descubra sozinho qual é o meu projeto Supabase (a URL está no config.js do
   projeto) e confirme que a CLI do Supabase consegue enxergar esse projeto.
   Se não conseguir, me explique o que fazer, porque provavelmente eu preciso
   gerar um token de acesso em supabase.com/dashboard/account/tokens.

2. Antes de pedir qualquer segredo, olhe o código das minhas edge functions e
   me diga quais permissões o meu sistema realmente usa na API do Instagram.
   Só me faça adicionar o que o código chama de verdade, nada além disso.
   Preste atenção: se o código usa graph.instagram.com, as permissões certas
   são as que começam com instagram_business_ (a API nova, com login do
   Instagram). As que não têm "business" no nome são de outra API, a que exige
   Página do Facebook, e não servem.

3. Crie um arquivo de texto pra eu colar os segredos e abra ele pra mim. Eu não
   quero colar essas coisas na conversa. O arquivo precisa de um campo pro token
   de acesso do Instagram e um pra chave secreta do app.

   ATENÇÃO: a chave secreta que eu preciso pegar é a "Chave secreta do app do
   INSTAGRAM", que fica no topo da tela de Configuração da API. Não é a chave do
   app do Facebook, que fica em Configurações > Básico. São diferentes e trocar
   as duas faz o webhook recusar tudo depois. Me lembre disso quando abrir o
   arquivo.

4. Quando eu avisar que salvei, leia o arquivo e configure os secrets no meu
   projeto Supabase, sem imprimir os valores no chat: o token de acesso, a chave
   secreta e o ID da conta do Instagram.

   O ID da conta você mesmo descobre: chame a API do Instagram com o meu token
   pedindo user_id e username. Assim você confirma que o token funciona de
   verdade e pega o ID de brinde, sem eu ter que caçar isso no painel.

5. Teste a minha função de webhook antes de eu mexer no painel da Meta: mande
   uma verificação igual à que a Meta manda (hub.mode, hub.verify_token e
   hub.challenge, usando o meu VERIFY_TOKEN que já está nos secrets) e me diga
   se ela devolveu o desafio certo.

6. Me diga exatamente o que colar na seção 3 (Configurar webhooks) do painel da
   Meta: a URL de callback e o verify token, já prontos, escritos aqui no chat
   pra eu copiar. Me diga também quais campos eu tenho que assinar, e não se
   esqueça de me mandar ligar o botão de assinatura do webhook na linha da minha
   conta, na seção 2, que vem desligado.

7. No final, apague o arquivo com os segredos.

Se em algum momento a Meta reclamar de "função de desenvolvedor insuficiente" ao
gerar o token, me ajude a investigar nesta ordem: se eu estou logada com o perfil
certo do Facebook, se esse perfil é Administrador em Funções do app, e se a minha
conta do Instagram está como Testador do Instagram com o convite ACEITO (o mais
comum é o convite estar pendente).
```

---

## Se der erro

**"Função de desenvolvedor é insuficiente" na hora de gerar o token.** Quase sempre é o convite de
testador ainda pendente. Vá no Instagram, em Configurações e privacidade > Apps e sites > Convites
de testador, e aceite. Só depois volte no painel da Meta.

**Não aparece o Instagram no menu do app.** O produto não foi adicionado. Procure "Adicionar
produto" na barra lateral, ache Instagram e clique em Configurar.

**Não consigo adicionar a conta.** Provavelmente ela ainda está como pessoal. Mude pra profissional
no app do Instagram, em Configurações > Tipo de conta.

**O Explorador da Graph API está travado, não deixo clicar em nada.** Está tudo certo, ele é a
ferramenta da outra API, a do Facebook. O seu sistema não usa ele. O token sai da tela Instagram >
Configuração da API, seção 2.
