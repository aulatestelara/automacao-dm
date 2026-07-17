# Tutorial: colocar o seu domínio próprio no site (passo a passo manual)

Use este tutorial se você preferir fazer na mão, ou se o Claude não conseguir fazer sozinho.

Os valores estão prontos pra copiar e colar.

---

## PARTE 1: no painel de DNS (Hostinger)

Entra em **hpanel.hostinger.com** → **Domínios** → escolhe o seu domínio → **DNS / Nameservers**.

### Se você quer o site no domínio raiz (seudominio.com.br, sem o www)

Cria **4 registros**, um de cada vez. Em todos, o **Tipo** é `A` e o **Nome** é `@`.
Só o valor muda:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Fica assim:

| Tipo | Nome | Aponta para | TTL |
|---|---|---|---|
| A | `@` | `185.199.108.153` | 14400 (deixa o padrão) |
| A | `@` | `185.199.109.153` | 14400 |
| A | `@` | `185.199.110.153` | 14400 |
| A | `@` | `185.199.111.153` | 14400 |

**Por que 4 e não 1?** São os 4 servidores do GitHub Pages no mundo. Se um cair, os outros
atendem. E o `@` significa "o domínio sem nada na frente".

### Se você também quer o www

Cria **1 registro só**:

| Tipo | Nome | Aponta para | TTL |
|---|---|---|---|
| CNAME | `www` | `SEU-USUARIO.github.io` | 14400 |

Troca `SEU-USUARIO` pelo seu usuário do GitHub. Exemplo: `aulatestelara.github.io`

**Por que aqui é CNAME e na raiz é A?** É a pegadinha que derruba todo mundo. A regra do DNS
**não permite** CNAME no domínio raiz (`@`), só em subdomínio (`www`, `blog`, `loja`). Por isso
a raiz usa os 4 endereços A e o www usa CNAME. Não é escolha, é regra da internet.

**Antes de salvar:** se já existir um registro `A` ou `CNAME` com o nome `@` ou `www` apontando
pra outro lugar, apaga ele primeiro. Dois registros brigando pelo mesmo nome fazem o site abrir
"às vezes sim, às vezes não", que é o pior tipo de problema pra descobrir.

---

## PARTE 2: no GitHub

Duas formas. A segunda é a que salva quando a primeira não funciona.

### Forma 1: pelo site do GitHub

1. Abre o seu repositório
2. Clica em **Settings** (a engrenagem, no topo)
3. No menu da esquerda, clica em **Pages**
4. No campo **Custom domain**, cola o seu domínio
5. Clica em **Save**
6. Espera o check verde e marca a caixinha **Enforce HTTPS**

### Forma 2: pelo arquivo CNAME (a que quase nunca falha)

Cria na **raiz do projeto** um arquivo chamado exatamente **`CNAME`**: tudo em maiúsculo e
**sem extensão** (não é `CNAME.txt`).

Dentro dele, uma linha só, com o seu domínio e nada mais:

```
seudominio.com.br
```

E publica:

```
git add CNAME
git commit -m "Aponta o site pro meu dominio"
git push
```

**Esse arquivo é a peça mais importante do tutorial inteiro.** É ele que faz o GitHub saber qual
site entregar naquele domínio. Sem ele, o DNS chega no GitHub e o GitHub responde
**"Site not found"**, mesmo com o DNS 100% certo.

---

## PARTE 3: conferir se funcionou

No terminal (troca pelo seu domínio):

```
dig +short seudominio.com.br
```

Você quer ver os 4 endereços do GitHub. Pro www:

```
dig +short www.seudominio.com.br
```

E pra testar o site:

```
curl -I https://seudominio.com.br
```

Quando vier `HTTP/2 200`, está no ar.

---

## PARTE 4: os erros que vão acontecer (e não são bugs)

| O que aparece | O que é | O que fazer |
|---|---|---|
| **"Site not found · GitHub Pages"** | O DNS chegou no GitHub, mas nenhum repositório reivindicou o domínio | Falta o arquivo **CNAME** ou o Custom domain (Parte 2) |
| **"Sua conexão não é particular"** | O certificado ainda não foi emitido | Esperar. O GitHub só emite o HTTPS **depois** que o DNS propaga. Leva de minutos a algumas horas |
| **"Este site não pode ser acessado"** | O DNS ainda não propagou | Esperar e conferir com o `dig` |
| **Abre o site errado** | Registro antigo brigando, ou outro repositório com o mesmo domínio | Apagar o registro velho, ou tirar o Custom domain do outro repositório |
| **O GitHub recusa o domínio** | Outro repositório já reivindicou ele | Tirar de lá primeiro. Um domínio só pode estar em **um** repositório por vez |

**A regra de ouro:** depois de mexer no DNS, **espera antes de mexer de novo**. 90% dos problemas
se resolvem sozinhos em 15 minutos. Quem fica mexendo em cima do que já estava certo é quem
quebra de verdade.

---

## Resumindo, o que cada peça faz

- **O DNS** diz pra internet: "esse domínio mora nos servidores do GitHub".
- **O arquivo CNAME (ou o Custom domain)** diz pro GitHub: "desse domínio, entrega ESTE site".

Você precisa das **duas**. Só o DNS dá "Site not found". Só o CNAME não leva ninguém até lá.
