#!/usr/bin/env python3
"""Proposta comercial Ysis → HVA em PDF (A4)."""
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
    KeepTogether, ListFlowable, ListItem, HRFlowable, CondPageBreak,
)
from reportlab.lib.utils import ImageReader
from pathlib import Path

DIR = Path(__file__).resolve().parent
OUT = DIR / "proposta-hva-ysis.pdf"

pdfmetrics.registerFont(TTFont("Arial", "/System/Library/Fonts/Supplemental/Arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Italic", "/System/Library/Fonts/Supplemental/Arial Italic.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Narrow", "/System/Library/Fonts/Supplemental/Arial Narrow.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Narrow-Bold", "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf"))

INK = colors.HexColor("#171013")
PAPER = colors.HexColor("#F7F1EA")
CARD = colors.white
MUT = colors.HexColor("#6D625C")
LINE = colors.HexColor("#E4D8CF")
ORANGE = colors.HexColor("#FF6A1A")
YSIS = colors.HexColor("#C9892E")
OK = colors.HexColor("#166534")
BAD = colors.HexColor("#9A3412")
CREAM = colors.HexColor("#FBF7F1")

W, H = A4
M = 16 * mm


def fit(path, max_w, max_h):
    src = ImageReader(str(path))
    iw, ih = src.getSize()
    scale = min(max_w / iw, max_h / ih)
    return Image(str(path), width=iw * scale, height=ih * scale)


def styles():
    s = {}
    s["kicker"] = ParagraphStyle(
        "kicker", fontName="Arial-Bold", fontSize=8, leading=11,
        textColor=YSIS, letterSpacing=1.4, spaceAfter=6,
    )
    s["h1"] = ParagraphStyle(
        "h1", fontName="Arial-Narrow-Bold", fontSize=22, leading=26,
        textColor=colors.white, spaceAfter=10,
    )
    s["lead"] = ParagraphStyle(
        "lead", fontName="Arial", fontSize=10, leading=14,
        textColor=colors.HexColor("#D8CCC4"),
    )
    s["h2"] = ParagraphStyle(
        "h2", fontName="Arial-Narrow-Bold", fontSize=15, leading=18,
        textColor=INK, spaceBefore=4, spaceAfter=8,
    )
    s["h3"] = ParagraphStyle(
        "h3", fontName="Arial-Bold", fontSize=11, leading=14,
        textColor=INK, spaceAfter=6,
    )
    s["body"] = ParagraphStyle(
        "body", fontName="Arial", fontSize=9.5, leading=13.2,
        textColor=INK, alignment=TA_JUSTIFY,
    )
    s["muted"] = ParagraphStyle(
        "muted", fontName="Arial", fontSize=8.2, leading=11.5, textColor=MUT,
    )
    s["cardt"] = ParagraphStyle(
        "cardt", fontName="Arial-Bold", fontSize=10.5, leading=13, textColor=INK,
    )
    s["cards"] = ParagraphStyle(
        "cards", fontName="Arial", fontSize=8.2, leading=11.2, textColor=MUT,
    )
    s["th"] = ParagraphStyle(
        "th", fontName="Arial-Bold", fontSize=7.4, leading=10,
        textColor=MUT,
    )
    s["td"] = ParagraphStyle(
        "td", fontName="Arial", fontSize=8, leading=11, textColor=INK,
    )
    s["bad"] = ParagraphStyle(
        "bad", fontName="Arial", fontSize=8, leading=11, textColor=BAD,
    )
    s["ok"] = ParagraphStyle(
        "ok", fontName="Arial", fontSize=8, leading=11, textColor=OK,
    )
    s["price"] = ParagraphStyle(
        "price", fontName="Arial-Narrow-Bold", fontSize=20, leading=24,
        textColor=colors.white,
    )
    s["priceL"] = ParagraphStyle(
        "priceL", fontName="Arial", fontSize=8, leading=11,
        textColor=colors.HexColor("#D8CCC4"),
    )
    s["foot"] = ParagraphStyle(
        "foot", fontName="Arial", fontSize=7.4, leading=10, textColor=MUT,
    )
    s["white"] = ParagraphStyle(
        "white", fontName="Arial-Bold", fontSize=8, leading=11, textColor=colors.white,
    )
    s["link"] = ParagraphStyle(
        "link", fontName="Arial", fontSize=8.5, leading=12, textColor=ORANGE,
    )
    return s


S = styles()


def header_footer(c, doc):
    c.saveState()
    c.setFillColor(INK)
    c.rect(0, H - 12 * mm, W, 12 * mm, fill=1, stroke=0)
    c.setFillColor(YSIS)
    c.setFont("Arial-Bold", 8)
    c.drawString(M, H - 7.6 * mm, "YSIS  ·  PROPOSTA COMERCIAL")
    c.setFillColor(colors.HexColor("#E8DCD4"))
    c.setFont("Arial", 8)
    c.drawRightString(W - M, H - 7.6 * mm, "HVA  ·  Hospital Vet Amour 24h")
    c.setFillColor(INK)
    c.rect(0, 0, W, 10 * mm, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#C9BDB6"))
    c.setFont("Arial", 7)
    c.drawString(M, 4.2 * mm, "setembro 2026  ·  não é o site oficial")
    c.drawRightString(W - M, 4.2 * mm, "página %d" % doc.page)
    c.restoreState()


def cover_page(c, doc):
    header_footer(c, doc)


def fato(titulo, texto):
    inner = [
        [Paragraph(titulo, S["cardt"])],
        [Paragraph(texto, S["cards"])],
    ]
    t = Table(inner, colWidths=[85 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (0, 0), 8),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def price_box(label, value, note):
    inner = [
        [Paragraph(label, S["priceL"])],
        [Paragraph(value, S["price"])],
        [Paragraph(note, S["priceL"])],
    ]
    t = Table(inner, colWidths=[82 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), INK),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (0, 0), 10),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 10),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 2),
    ]))
    return t


def build():
    story = []
    usable = W - 2 * M

    # Cover block (flows under the painted band via spacers + white text in a table)
    cover_txt = Table([
        [Paragraph("HVA NÃO PRECISA DE “MAIS UM SITE”.", S["h1"])],
        [Paragraph(
            "Precisa de um caminho de urgência que o tutor entenda em 8 segundos.",
            ParagraphStyle("h1b", parent=S["h1"], fontSize=14, leading=18, textColor=ORANGE),
        )],
        [Paragraph(
            "Leitura do hospital, do site oficial e do Google. Demonstração pronta para o celular. "
            "Nada disto é o site oficial — só vai ao ar no domínio de vocês depois de autorização.",
            S["lead"],
        )],
    ], colWidths=[usable])
    cover_txt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), INK),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (0, 0), 12),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(cover_txt)
    story.append(Spacer(1, 5 * mm))

    facade = fit(DIR / "img/g10.jpg", usable, 40 * mm)
    facade.hAlign = "CENTER"
    story.append(facade)
    story.append(Paragraph(
        "Fachada do HVA na Rodovia Augusto Montenegro, Km 5 — Parque Verde, Belém. Foto do próprio hospital.",
        ParagraphStyle("capf", parent=S["muted"], alignment=TA_CENTER, spaceBefore=3),
    ))
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("O que o hospital já é", S["h2"]))
    grid = Table([
        [fato("24h desde 2016", "Primeiro hospital 24h da Augusto Montenegro, segundo o próprio site."),
         fato("4,4 · 581 avaliações", "Nota e volume reais no Google — prova social forte, não “5 estrelas”.")],
        [fato("Laboratório e raio-X", "Diferencial de emergência: o exame não sai do prédio."),
         fato("Dois números", "Fixo (91) 3351-4450 e WhatsApp (91) 99204-0555.")],
    ], colWidths=[usable / 2 - 2 * mm, usable / 2 - 2 * mm])
    grid.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 4),
        ("LEFTPADDING", (1, 0), (1, -1), 4),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(grid)
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        "O HVA já tem marca (laranja, gato + cão), Instagram <b>@hva.belem</b>, Facebook, "
        "endereço ao lado da Hapvida e site em <b>hospitalvetamour.com.br</b>. "
        "Enviar uma página genérica de “clínica em Tapanã” seria um erro: o tutor e o dono reconhecem na hora que não é o hospital.",
        S["body"],
    ))

    story.append(Spacer(1, 7 * mm))
    story.append(Paragraph("Onde o tutor trava hoje", S["h2"]))

    def row(a, b, c):
        return [Paragraph(a, S["td"]), Paragraph(b, S["bad"]), Paragraph(c, S["ok"])]

    rows = [
        [Paragraph("PONTO", S["th"]), Paragraph("SITE ATUAL", S["th"]), Paragraph("O QUE A PROPOSTA FAZ", S["th"])],
        row("Primeira decisão",
            "O mesmo “Fale no WhatsApp / Ligue agora” se repete em todo bloco, com a mesma mensagem genérica.",
            "Duas portas no topo: <b>é urgência</b> ou <b>consulta / especialidade</b>."),
        row("WhatsApp",
            "Texto único: “gostaria de mais informações sobre os serviços”.",
            "Mensagem pronta de urgência (“estou indo agora”) ou de especialidade nomeada."),
        row("Prova",
            "Bloco “hospital 5 estrelas” enquanto o Google mostra 4,4 em 581 avaliações.",
            "Usa a nota real. Tutores desconfiam de estrela inflada; o volume já convence."),
        row("Especialidade",
            "Lista longa, sem ação. O FAQ diz ordem de chegada; o texto fala em hora marcada.",
            "Cada especialidade abre o WhatsApp com o pedido. FAQ alinha os dois fluxos."),
        row("Madrugada no celular",
            "Página institucional WordPress, CTAs repetidos, Instagram ausente no conteúdo principal.",
            "Barra fixa Ligar + WhatsApp de urgência; endereço com Hapvida; fotos do próprio hospital."),
    ]
    col_w = [28 * mm, 72 * mm, usable - 100 * mm]
    tbl = Table(rows, colWidths=col_w, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFE6DC")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("BACKGROUND", (0, 1), (-1, 1), CREAM),
        ("BACKGROUND", (0, 3), (-1, 3), CREAM),
        ("BACKGROUND", (0, 5), (-1, 5), CREAM),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 2.5 * mm))
    story.append(Paragraph(
        "Concorrência imediata na mesma rodovia: Bel e Bola 24h a cerca de 200 m. "
        "HVM em Ananindeua tem mais avaliações (821) com nota menor (4,1). "
        "O HVA ganha se a busca de madrugada terminar em ligação, não em comparação de sites.",
        S["muted"],
    ))

    story.append(CondPageBreak(90 * mm))
    story.append(Paragraph("O que foi construído", S["h2"]))
    story.append(Paragraph(
        "Uma página de conversão com a identidade do HVA: laranja da fachada, logo oficial, "
        "fotos do laboratório, do bloco, da clínica felina e da internação. "
        "Sem banco de imagem. Sem bairro errado. Sem WhatsApp do telefone fixo.",
        S["body"],
    ))
    story.append(Spacer(1, 3 * mm))

    thumbs = []
    caps = ["Laboratório", "Cirurgia 24h", "Clínica felina", "Farmácia"]
    files = ["g5.jpg", "g8.jpg", "g4.jpg", "g3.jpg"]
    tw = (usable - 9 * mm) / 4
    th = tw * 500 / 700
    cells_img, cells_cap = [], []
    for f, cap in zip(files, caps):
        im = Image(str(DIR / "img" / f), width=tw, height=th)
        cells_img.append(im)
        cells_cap.append(Paragraph(cap, ParagraphStyle("cap", parent=S["muted"], alignment=TA_CENTER, fontSize=7.4)))
    photos = Table([cells_img, cells_cap], colWidths=[tw] * 4)
    photos.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 1.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.5),
        ("TOPPADDING", (0, 1), (-1, 1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
    ]))
    story.append(photos)
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(
        "Demonstração: <link href='https://www.ysis.app/hva-hospital-veterinario-vet-amour-24-horas/' color='#FF6A1A'>"
        "ysis.app/hva-hospital-veterinario-vet-amour-24-horas</link>"
        " &nbsp;·&nbsp; Site atual: <link href='https://hospitalvetamour.com.br/' color='#FF6A1A'>"
        "hospitalvetamour.com.br</link>",
        S["link"],
    ))

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("O que entra no ar, se vocês autorizarem", S["h2"]))
    bullets = [
        "A página no domínio que escolherem (o de vocês ou um endereço Ysis, no começo).",
        "WhatsApp e telefone certos, com origem da mensagem.",
        "Ajustes de texto, fotos e especialidades que o hospital confirmar.",
        "Manutenção: horário, número e conteúdo quando mudarem.",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(b, S["body"]), leftIndent=8, bulletColor=ORANGE) for b in bullets],
        bulletType="bullet", start="•", leftIndent=12, bulletFontName="Arial-Bold",
        bulletFontSize=10, bulletOffsetY=-1,
    ))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(
        "Não prometemos volume de clientes. A página organiza quem já procura o HVA — no Google, "
        "no Instagram ou no link do WhatsApp — e separa urgência de agenda.",
        S["muted"],
    ))

    story.append(Spacer(1, 7 * mm))
    story.append(Paragraph("Investimento", S["h2"]))
    prices = Table([
        [price_box("Para publicar", "R$ 250", "uma vez, página no ar"),
         price_box("Para manter", "R$ 59,90", "por mês, hospedagem e ajustes básicos")],
    ], colWidths=[usable / 2 - 2 * mm, usable / 2 - 2 * mm])
    prices.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("RIGHTPADDING", (0, 0), (0, 0), 4),
        ("LEFTPADDING", (1, 0), (1, 0), 4),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
    ]))
    story.append(prices)
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        "Valor fixo da Ysis, o mesmo para todo cliente. Sem taxa extra de “hospital 24h”. "
        "Se o site atual já resolve o que vocês precisam, dizemos isso na conversa — não é troca por troca.",
        S["muted"],
    ))

    story.append(Spacer(1, 7 * mm))
    story.append(Paragraph("Como avançar", S["h2"]))
    steps = [
        "Abrir a demonstração no celular, como um tutor às 2h.",
        "Marcar o que está diferente do real (equipe, exames, fluxo de especialidade).",
        "Decidir se a página substitui o site, vira o link da bio, ou fica só para anúncio de urgência.",
        "Autorizar marca, fotos e textos. Aí sai o aviso de proposta e o noindex.",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph("%d.  %s" % (i, t), S["body"]), leftIndent=4)
         for i, t in enumerate(steps, 1)],
        bulletType="bullet", start="", leftIndent=4, bulletFontSize=0,
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(
        "WhatsApp: <link href='https://wa.me/5592995349783?text=Quero%20falar%20da%20proposta%20do%20HVA%20Hospital%20Vet%20Amour' color='#FF6A1A'>"
        "(92) 99534-9783</link>"
        " &nbsp;·&nbsp; E-mail: <link href='mailto:app.ruphus@gmail.com' color='#FF6A1A'>"
        "app.ruphus@gmail.com</link>",
        S["link"],
    ))
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.4, color=LINE, spaceAfter=6))
    story.append(Paragraph(
        "Fontes: hospitalvetamour.com.br, perfil Google (4,4 / 581), Instagram @hva.belem. "
        "Consulta em setembro de 2026. Plantão, exames e especialidades devem ser reconfirmados "
        "com o hospital antes da publicação oficial. Fotos do estabelecimento usadas nesta proposta.",
        S["foot"],
    ))

    doc = SimpleDocTemplate(
        str(OUT), pagesize=A4,
        leftMargin=M, rightMargin=M,
        topMargin=16 * mm, bottomMargin=14 * mm,
        title="Proposta Ysis · HVA Hospital Vet Amour 24h",
        author="Ysis",
        subject="Proposta comercial de página de conversão para o HVA",
    )
    doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
    print(OUT)


if __name__ == "__main__":
    build()
