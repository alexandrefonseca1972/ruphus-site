"use client";

import { useState } from "react";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Campo de destino e botão de envio. Vem preenchido com o e-mail cadastrado do dono,
 *  e pode ser trocado por outro endereço. Com `fixo`, o convite: o link só abre com
 *  o e-mail do dono, então o campo fica travado nele. */
export function EnviarPorEmail({
  cadastrado,
  onEnviar,
  fixo = false,
}: {
  cadastrado: string | null;
  onEnviar: (para: string) => void;
  fixo?: boolean;
}) {
  const [para, setPara] = useState(cadastrado ?? "");
  const digitado = para.trim();
  const erro = digitado && !EMAIL.test(digitado) ? "E-mail incompleto" : "";
  const pronto = !!digitado && !erro;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={para}
          readOnly={fixo}
          onChange={(e) => setPara(e.target.value)}
          aria-label="E-mail de destino"
          aria-invalid={!!erro}
          placeholder="e-mail do destinatário"
          className={`h-9 min-w-0 grow rounded-full border bg-white px-3 text-[16px] outline-none focus:border-[#17150F] sm:text-[13px] ${erro ? "border-[#8A2F2F]" : "border-[#D8D2C6]"} ${fixo ? "text-[#6F6A5E]" : ""}`}
        />
        <button
          type="button"
          disabled={!pronto}
          onClick={() => onEnviar(digitado.toLowerCase())}
          className="h-9 rounded-full border border-[#17150F] bg-white px-3 text-[13px] font-semibold text-[#17150F] hover:bg-[#F4F2EE] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar por e-mail
        </button>
      </div>
      {erro && <span className="text-xs text-[#8A2F2F]">{erro}</span>}
      {fixo && (
        <span className="text-xs leading-relaxed text-[#6F6A5E]">
          Só abre com este e-mail, o do dono. Para mandar a outro endereço, troque o e-mail do dono na aba Venda.
        </span>
      )}
    </div>
  );
}
