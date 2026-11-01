# Pesquisa de leads: o que já temos (base de 31/10/2026, após Fortaleza, Aracaju e BH)

Objetivo: a próxima rodada de pesquisa **não deve trazer negócio que já está na base**.
Entregar à pesquisa este documento **junto com** `dblocal/pesquisa/ja-temos.csv`
(lista nominal; fica só nesta máquina, fora do git).

## 1. Lista de exclusão: `ja-temos.csv`

11.273 negócios, um por linha: `nome, telefone, instagram, bairro, cidade, uf, categoria, origem`.

| origem | o que é | quantos |
|---|---|---|
| site gerado | já tem site e está no CRM | 10.648 |
| pesquisado, sem telefone | veio numa planilha só com Instagram/Facebook (sem cidade) | 403 |
| pesquisado, fora do gerador | veio numa planilha e foi recusado (nicho, dado inválido) | 222 |

Regra de exclusão para quem pesquisa:

- **Mesmo telefone** = mesmo negócio. Comparar pelos **8 últimos dígitos** (o mesmo
  celular aparece com e sem o 9, com e sem 55/DDD).
- **Mesmo Instagram** = mesmo negócio (vale para os "sem telefone": se agora achar o
  WhatsApp, trazer marcado como "telefone novo").
- **Mesmo nome + mesma cidade**, telefone diferente = provável duplicado. Não descartar:
  trazer marcado como "conferir".
- Negócio da lista com telefone novo também é "conferir", não lead novo.

## 2. Onde já estamos (beleza)

Total na base: 10.651 negócios em 14 UFs. Pet: só os sites estáticos antigos.

| UF | negócios | cidades já cobertas (≥ 15 negócios) |
|---|---|---|
| DF | 1.681 | Brasília (DF inteiro) |
| PA | 1.451 | Belém (652), Ananindeua (289), Redenção, Castanhal, Santarém, Tucuruí, Parauapebas, Marabá, Paragominas, Altamira (46 cidades no total) |
| AM | 421 | Manaus (52 de beleza; o resto é site estático antigo) |
| PB | 371 | João Pessoa, Campina Grande, Cabedelo, Patos, Santa Rita |
| PI | 489 | Teresina (340), Parnaíba, Picos |
| TO | 275 | Araguaína, Gurupi, Paraíso do Tocantins, Palmas, Porto Nacional, Tocantinópolis |
| MA | 265 | São Luís (13 cidades) |
| RO | 236 | Porto Velho, Ji-Paraná, Ariquemes, Cacoal, Vilhena, Rolim de Moura |
| AP | 162 | Macapá, Santana |
| AC | 60 | Rio Branco |
| RR | 41 | Boa Vista |
| CE | 1.308 | Fortaleza 1.292 (4 rodadas pelo Maps em 30/10/2026, 25 bairros esgotados) |
| MG | 2.430 | Belo Horizonte 2.426 (Maps em 31/10/2026, 50 bairros × 5 termos), Contagem, Nova Lima, Betim, Ribeirão das Neves (1 cada) |
| SE | 1.461 | Aracaju 1.449 (Maps em 30/10/2026, 30 bairros × 5 termos esgotados), mais 8 cidades com 1–5 |

**Sem nada ainda:** SP, RJ, ES, PR, SC, RS, GO, MT, MS, BA, PE, AL, RN.
**Ralo (vale aprofundar):** região metropolitana de BH (Contagem, Betim, Nova Lima), interior do CE, interior de SE, AM fora de beleza em Manaus,
AC/RR fora da capital, interior do MA.

Rodadas anteriores que só repetiram o que já tínhamos (todas as linhas com telefone eram
duplicadas): Acre, Amazonas, São Luís, Maranhão interior. Mudar de cidade ou de bairro,
não repetir a mesma busca.


## 3. Nichos

Prioridade: **beleza**. Pet em segundo plano.

| aceito pelo gerador | termos de busca |
|---|---|
| salão | salão de beleza, cabeleireiro, escova, tranças, cachos |
| estética | clínica de estética, sobrancelha, cílios/lash, micropigmentação, depilação, massagem, spa, bronzeamento |
| unhas | manicure, nail designer, esmalteria |
| barbearia | barbearia |
| podologia | podólogo, podologia |
| tatuagem | estúdio de tatuagem |
| pet (2º plano) | pet shop, banho e tosa, clínica veterinária |

Caíram fora em rodadas passadas e **não valem a busca**: loja de cosméticos, perfumaria,
fornecedor de produtos de beleza, cafeteria. Categorias do Google em inglês
("Tanning salon", "Beautician", "Eyebrow bar") foram recusadas: escrever a categoria em
português (bronzeamento, esteticista, sobrancelha).

## 4. Formato da planilha

Uma linha por negócio, cabeçalho na primeira linha, **no máximo 300 linhas por arquivo**.

| coluna | obrigatória | observação |
|---|---|---|
| nome | sim | nome do negócio como aparece no Maps |
| telefone | sim | com DDD; de preferência o WhatsApp. Sem telefone não vira site |
| categoria | sim | em português, um dos nichos acima |
| cidade | sim | |
| uf | sim | sigla |
| endereco, bairro | não | |
| nota, avaliacoes | não | só se lidas no Google; nunca estimar |
| instagram | não | @perfil ou link |
| horario | não | |
| link_maps | sim | link real da ficha no Google Maps (prova de que existe) |

## 5. Regras contra dado inventado

Duas planilhas antigas (Paraíba v3 e Belém consolidada) vieram com telefones e negócios
inventados; mensagens foram para estranhos. Por isso:

- Célula vazia é melhor que chute. Nunca completar telefone, nota, avaliações ou Instagram.
- Telefone recusado: dígito repetido (99999-9999), pares (98811-2233), escada (91234-5678),
  "9xxxx-xxxx", vários números sobre o mesmo prefixo.
- Link do Maps tem que abrir a ficha (não `maps.app.goo.gl/?cid=<texto>`).
- Sem CNPJ "sequencial" nem nome montado com o bairro.
- Fontes que deram certo: Google Maps (via Firecrawl) e Solutudo
  (`solutudo.com.br/empresas/<uf>/<cidade>/<categoria>?pagina=N`).

## 6. Quando a planilha voltar

1. `npm run dblocal` (atualiza a base local).
2. `npm run dblocal -- comparar planilha.xlsx` → `dblocal/comparacao-planilha.csv`.
3. `npm run gerar:sites -- planilha.xlsx` (só prévia); conferir recusas.
4. `npm run gerar:sites -- planilha.xlsx --aplicar`.
5. `npx tsx scripts/consolidar-planilhas.mts --aplicar planilha.xlsx` (guarda a planilha na tabela
   `planilhas`; sem arquivo, lê todos os `docs/*.xlsx`).
6. Regerar este documento e o `ja-temos.csv` antes da rodada seguinte.

## 6b. Coletar direto do Maps (sem pesquisa externa)

**Pelo /admin, aba Coleta:** escolher estado e cidade (lista do IBGE) e pôr na fila. Um worker
coleta, o admin mostra o andamento ao vivo e, no fim, a prévia e o botão de gerar os sites.
Nada de planilha. O worker roda numa máquina com o projeto, o `.env.local` e o agent-browser
(este Mac ou uma VPS Linux):

    npm run coletar -- --fila

Com o admin rodando nessa mesma máquina (`npm run dev` no Mac, ou numa VPS), o botão **Ligar
worker** da aba Coleta faz isso sozinho (log em `dblocal/pesquisa/worker.log`) e **Desligar
worker** para como o Ctrl+C. No site publicado (Vercel) o botão não aparece: lá não há navegador.
**Excluir** apaga um pedido cancelado, com erro, pronto ou concluído e os leads dele; sites já
gerados continuam no ar.

Sem bairros, a coleta busca primeiro na cidade toda e usa os bairros mais citados nos endereços
para a segunda volta. Leva ~6 s por ficha: uma capital dá ~3.000 fichas, umas 5 horas.

**Pela linha de comando** (sai em planilhas para o passo 3 acima):
`npm run coletar -- "Cidade" UF [--bairros="a,b"] [--termos="x,y"]`; `--so-montar` refaz as planilhas.

- Compara com o Firestore (não precisa de `npm run dblocal`).
- Retoma de onde parou; navegador travado ou lento é reiniciado; o que falha 3 vezes é deixado
  de lado; 5 falhas seguidas param a coleta (bloqueio do Google ou rede fora).
- Estado de cada coleta em `dblocal/pesquisa/<cidade>-<uf>/` (`COLETA_PASTA` muda a raiz).

## 7. Texto-base para pedir a pesquisa

> Pesquise negócios de beleza (salão, estética, sobrancelha/cílios, depilação, unhas,
> barbearia, podologia) em **[CIDADE/UF, bairros]**. Use apenas o Google Maps e fontes
> públicas verificáveis. **Exclua todo negócio do arquivo `ja-temos.csv`**: mesmo telefone
> (8 últimos dígitos), mesmo Instagram ou mesmo nome na mesma cidade. Entregue .xlsx com as colunas
> nome, telefone, categoria, endereco, bairro, cidade, uf, nota, avaliacoes, instagram,
> horario, link_maps; até 300 linhas por arquivo. Não invente nenhum dado: deixe a célula
> vazia quando não encontrar. Quem não tiver telefone, deixe de fora.
