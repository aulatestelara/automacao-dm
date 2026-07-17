# Prompt: colocar um domínio próprio no site

Cole o texto abaixo no Claude Code, trocando as duas últimas linhas pelos seus dados.

Antes de colar, você precisa ter: o site já publicado no GitHub Pages, e um domínio já
registrado (na Hostinger ou onde você preferir).

---

```
Quero colocar um domínio próprio no meu site que está no GitHub Pages.

Faça o seguinte, nesta ordem:

1. Descubra sozinho qual é o meu repositório e a URL atual do GitHub Pages
   (olhe o remote do git na pasta do projeto).

2. Abra no meu Chrome as duas páginas que eu vou precisar:
   - o painel de DNS da Hostinger (hpanel.hostinger.com/domains)
   - a configuração de Pages do meu repositório (a aba Settings > Pages)

3. Me diga EXATAMENTE o que eu tenho que criar no DNS: o tipo do registro,
   o que vai no campo "Nome" e o que vai no campo "Valor / Aponta para".
   Escreva os valores prontos pra eu copiar, um por linha.
   Se eu quiser o domínio raiz (sem www), me explique por que são 4 registros
   do tipo A em vez de 1 CNAME.

4. Espere eu avisar que colei. Aí verifique se o DNS já propagou (com dig).
   Se ainda não propagou, me diga quanto tempo esperar e como eu confiro sozinha.

5. Quando propagar, configure o lado do GitHub por mim: o domínio no repositório,
   o arquivo CNAME e o HTTPS forçado.

6. No final, teste o endereço novo de verdade (abrindo no navegador) e me diga
   se está no ar. Se der erro de certificado, me explique se é só esperar ou se
   é problema de configuração.

O meu domínio é: COLOQUE_SEU_DOMINIO_AQUI
Eu quero ele: NA RAIZ (sem www) ou COM WWW  (escolha uma e apague a outra)
```

---

## O que esperar

O Claude vai abrir as páginas e te dizer o que colar. **A criação do registro de DNS é
manual**: ele não tem o login da sua Hostinger, então essa parte é você quem faz. Ele te
mostra onde e o quê.

## Por que raiz e www são diferentes

É a pegadinha clássica, e é bom entender em vez de decorar.

**Com www** (`www.seusite.com`) é 1 registro só:

| Tipo | Nome | Valor |
|---|---|---|
| CNAME | `www` | `SEU-USUARIO.github.io` |

**Na raiz** (`seusite.com`, sem o www) são 4 registros, porque a regra do DNS não deixa a raiz
de um domínio usar CNAME:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

Esses 4 números são os servidores do GitHub Pages. São iguais pra todo mundo, no mundo inteiro.

## A parte que assusta e não é bug

Depois de criar o registro, **o site não funciona na hora**. O DNS leva de 10 minutos a
algumas horas pra propagar pela internet, e o certificado de HTTPS do GitHub só é emitido
**depois** que o DNS propaga.

Então é normal, nos primeiros minutos, ver:
- "site não encontrado"
- erro de certificado / "sua conexão não é particular"

Isso passa sozinho. Pra conferir se já propagou, roda no terminal (trocando pelo seu domínio):

```
dig +short www.seusite.com
```

Quando responder o endereço do GitHub, propagou.
