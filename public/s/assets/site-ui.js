(() => {
  const abrirMenu = (dialog, gatilho) => {
    dialog.showModal();
    gatilho.setAttribute("aria-expanded", "true");
    document.body.classList.add("site-menu-open");
    dialog.querySelector("button, a")?.focus();
  };

  const ligarMenu = (gatilho, dialog) => {
    const fechar = () => {
      if (dialog.open) dialog.close();
      gatilho.setAttribute("aria-expanded", "false");
      document.body.classList.remove("site-menu-open");
      gatilho.focus();
    };
    gatilho.addEventListener("click", () => dialog.open ? fechar() : abrirMenu(dialog, gatilho));
    dialog.querySelectorAll("[data-menu-close], nav a").forEach((el) => el.addEventListener("click", fechar));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      fechar();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) fechar();
    });
    dialog.addEventListener("close", () => {
      gatilho.setAttribute("aria-expanded", "false");
      document.body.classList.remove("site-menu-open");
    });
  };

  const montarMenuEditorial = () => {
    const header = document.querySelector("header#hd");
    const nav = header?.querySelector("nav");
    if (!header || !nav || header.querySelector(".site-menu-trigger")) return;
    const gatilho = document.createElement("button");
    gatilho.type = "button";
    gatilho.className = "site-menu-trigger";
    gatilho.textContent = "Menu";
    gatilho.setAttribute("aria-expanded", "false");
    gatilho.setAttribute("aria-controls", "site-menu-editorial");
    header.append(gatilho);

    const dialog = document.createElement("dialog");
    dialog.className = "site-menu";
    dialog.id = "site-menu-editorial";
    dialog.setAttribute("aria-label", "Menu do site");
    const fechar = document.createElement("button");
    fechar.type = "button";
    fechar.className = "site-menu-close";
    fechar.setAttribute("aria-label", "Fechar menu");
    fechar.textContent = "×";
    dialog.append(fechar, nav.cloneNode(true));
    document.body.append(dialog);
    ligarMenu(gatilho, dialog);
  };

  const erroDoCampo = (form, campo) => {
    let erro = form.querySelector(`[data-error-for="${campo.name}"]`);
    if (!erro) {
      erro = document.createElement("p");
      erro.className = "field-error";
      erro.dataset.errorFor = campo.name;
      erro.id = `${form.id || "formulario"}-${campo.name}-erro`;
      campo.insertAdjacentElement("afterend", erro);
    }
    erro.setAttribute("role", "alert");
    const descritos = (campo.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    if (!descritos.includes(erro.id)) campo.setAttribute("aria-describedby", [...descritos, erro.id].join(" "));
    return erro;
  };

  const validarCampo = (form, campo) => {
    campo.setCustomValidity("");
    const valor = campo.value.trim();
    if (campo.name === "nome" && valor) {
      const letras = valor.match(/[\p{L}]/gu) ?? [];
      if (letras.length < 2) campo.setCustomValidity("Informe seu nome com pelo menos 2 letras.");
    }
    if (campo.name === "telefone" && valor) {
      const d = valor.replace(/\D/g, "");
      const ddd = (d.length > 11 && d.startsWith("55") ? d.slice(2) : d).slice(0, 2);
      if (d.length < 10 || d.length > 13) campo.setCustomValidity("Informe o WhatsApp com DDD.");
      else if (!/^(1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])$/.test(ddd)) campo.setCustomValidity("DDD inválido. Confira os dois primeiros dígitos.");
      else if (d.length === 11 && d[2] !== "9") campo.setCustomValidity("Celular com 11 dígitos começa com 9 depois do DDD.");
    }
    const erro = erroDoCampo(form, campo);
    erro.textContent = campo.validationMessage;
    campo.setAttribute("aria-invalid", campo.validity.valid ? "false" : "true");
    return campo.validity.valid;
  };

  const dataLocal = () => {
    const agora = new Date();
    return new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  const textoDoFormulario = (form) => {
    const valor = (nome) => form.elements.namedItem(nome)?.value?.trim() ?? "";
    const marca = form.getAttribute("data-brand") || document.querySelector(".logo, .brand-name")?.textContent?.trim() || "o negócio";
    const introducao = form.getAttribute("data-intro") || `Olá! Vim pelo site da ${marca} e quero agendar um horário.`;
    const linhas = [introducao, `Nome: ${valor("nome")}`];
    if (valor("telefone")) linhas.push(`Telefone: ${valor("telefone")}`);
    if (valor("servico")) linhas.push(`Serviço: ${valor("servico")}`);
    if (valor("dia")) {
      const [ano, mes, dia] = valor("dia").split("-");
      linhas.push(`Dia de preferência: ${dia}/${mes}/${ano}`);
    }
    if (valor("hora")) linhas.push(`Horário: ${valor("hora")}`);
    if (valor("periodo")) linhas.push(`Período: ${valor("periodo")}`);
    if (valor("msg")) linhas.push(`Obs.: ${valor("msg")}`);
    return linhas.join("\n");
  };

  const ligarFormulario = (form) => {
    const campos = [...form.querySelectorAll("input, select, textarea")];
    const nota = form.querySelector(".form-note") || Object.assign(document.createElement("p"), { className: "form-note" });
    if (!nota.parentNode) form.append(nota);
    nota.setAttribute("aria-live", "polite");
    form.noValidate = true;
    form.querySelectorAll('input[type="date"]').forEach((campo) => {
      if (!campo.min) campo.min = dataLocal();
    });
    campos.forEach((campo) => {
      erroDoCampo(form, campo);
      campo.addEventListener("focusout", () => {
        if (campo.required || campo.value.trim()) validarCampo(form, campo);
      });
      campo.addEventListener("input", () => {
        campo.setCustomValidity("");
        erroDoCampo(form, campo).textContent = "";
        campo.setAttribute("aria-invalid", "false");
      });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      nota.textContent = "";
      form.querySelectorAll(".whatsapp-fallback").forEach((el) => el.remove());
      const invalido = campos.find((campo) => !validarCampo(form, campo));
      if (invalido) {
        nota.textContent = "Revise o campo destacado antes de abrir o WhatsApp.";
        nota.dataset.estado = "erro";
        invalido.focus();
        return;
      }
      const texto = textoDoFormulario(form);
      const url = `https://wa.me/${form.getAttribute("data-wa")}?text=${encodeURIComponent(texto)}`;
      const aberta = window.open(url, "_blank");
      if (aberta) aberta.opener = null;
      nota.dataset.estado = aberta ? "ok" : "erro";
      nota.textContent = aberta
        ? "WhatsApp aberto em outra aba. Revise a mensagem e toque em enviar."
        : "O navegador bloqueou a nova aba. Use o link abaixo ou copie a mensagem.";
      if (aberta) return;

      const recuperacao = document.createElement("div");
      recuperacao.className = "whatsapp-fallback";
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Abrir o WhatsApp";
      const copiar = document.createElement("button");
      copiar.type = "button";
      copiar.textContent = "Copiar mensagem";
      copiar.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(texto);
          copiar.textContent = "Mensagem copiada";
        } catch {
          nota.textContent = "Não foi possível copiar automaticamente. Use “Abrir o WhatsApp”.";
        }
      });
      recuperacao.append(link, copiar);
      nota.after(recuperacao);
      link.focus();
    });
  };

  const iniciar = () => {
    montarMenuEditorial();
    document.querySelectorAll("[data-menu-open]").forEach((gatilho) => {
      const dialog = document.getElementById(gatilho.getAttribute("data-menu-open"));
      if (dialog instanceof HTMLDialogElement) ligarMenu(gatilho, dialog);
    });
    document.querySelectorAll("form[data-wa]").forEach(ligarFormulario);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
  else iniciar();
})();
