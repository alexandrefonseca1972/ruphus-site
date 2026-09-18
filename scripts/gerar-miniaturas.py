#!/usr/bin/env python3
"""Refaz as miniaturas de /s/_p a partir dos sites no ar.

As miniaturas são a foto da página que o painel e a galeria da landing mostram.
Quando o HTML muda (troca de marca, botão novo), elas envelhecem sozinhas e
ninguém percebe: só este script as alcança.

    python3 scripts/gerar-miniaturas.py                 # todos
    python3 scripts/gerar-miniaturas.py --limite 5      # prova antes
    python3 scripts/gerar-miniaturas.py --slug santo-pet
"""

import argparse
import asyncio
import io
import sys
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parents[2]
SITES = RAIZ / "sites"
SAIDA = SITES / "_p"
LARGURA, ALTURA = 420, 525  # o formato que o painel já espera
# A captura é feita maior e reduzida: a 420 px de viewport o site aparece
# ampliado demais e só cabe meia dobra. A 630 o layout ainda é o do celular,
# mas entra a mesma fatia de página das miniaturas antigas.
CAPTURA = (630, 787)


# pastas que têm index.html mas não são site de cliente: não viram subdomínio
NAO_SAO_SITES = {"catalogo", "privacidade", "sobre", "sb", "assets"}


def slugs():
    return sorted(
        d.name
        for d in SITES.iterdir()
        if d.is_dir()
        and not d.name.startswith(("_", "."))
        and d.name not in NAO_SAO_SITES
        and (d / "index.html").exists()
    )


async def um(contexto, slug, espera=12_000, tentativas=2):
    for tentativa in range(tentativas):
        pagina = await contexto.new_page()
        try:
            # "load" espera TODA imagem da página — 5 a 15 s, e a miniatura só
            # mostra a primeira dobra. Espera-se só o que vai aparecer nela.
            await pagina.goto(f"https://{slug}.ruphus.site/", wait_until="domcontentloaded", timeout=30_000)
            try:
                # espera tudo — inclusive foto de fundo em CSS, que um teste de
                # <img> não alcança — mas desiste em 12 s e fotografa assim mesmo
                await pagina.wait_for_load_state("load", timeout=espera)
            except Exception:
                pass
            await pagina.wait_for_timeout(400)
            bruto = await pagina.screenshot(type="png")
            img = Image.open(io.BytesIO(bruto)).convert("RGB").resize((LARGURA, ALTURA), Image.LANCZOS)
            img.save(SAIDA / f"{slug}.webp", "WEBP", quality=80, method=6)
            return None
        except Exception as erro:
            if tentativa == tentativas - 1:
                return f"{slug}: {type(erro).__name__} {erro}".split("\n")[0][:160]
        finally:
            await pagina.close()


async def principal(lista, paralelos, espera):
    SAIDA.mkdir(parents=True, exist_ok=True)
    falhas, feitos = [], 0
    async with async_playwright() as p:
        navegador = await p.chromium.launch()
        contextos = [
            await navegador.new_context(
                viewport={"width": CAPTURA[0], "height": CAPTURA[1]},
                device_scale_factor=1.5,
                locale="pt-BR",
            )
            for _ in range(paralelos)
        ]
        fila = asyncio.Queue()
        for s in lista:
            fila.put_nowait(s)

        async def trabalhador(ctx):
            nonlocal feitos
            while True:
                try:
                    slug = fila.get_nowait()
                except asyncio.QueueEmpty:
                    return
                erro = await um(ctx, slug, espera)
                feitos += 1
                if erro:
                    falhas.append(erro)
                if feitos % 25 == 0 or feitos == len(lista):
                    print(f"  {feitos}/{len(lista)}", flush=True)

        await asyncio.gather(*(trabalhador(c) for c in contextos))
        await navegador.close()
    return falhas


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", action="append", help="só estes")
    ap.add_argument("--limite", type=int)
    ap.add_argument("--paralelos", type=int, default=8)
    ap.add_argument("--espera", type=int, default=12_000, help="ms esperando as fotos antes de fotografar")
    args = ap.parse_args()

    lista = args.slug or slugs()
    if args.limite:
        lista = lista[: args.limite]
    print(f"{len(lista)} miniaturas → {SAIDA}")

    falhas = asyncio.run(principal(lista, args.paralelos, args.espera))
    if falhas:
        print(f"\n{len(falhas)} falharam:", file=sys.stderr)
        for f in falhas[:20]:
            print("  " + f, file=sys.stderr)
        sys.exit(1)
    print("todas prontas")
