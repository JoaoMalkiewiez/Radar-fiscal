"use strict";
const digits = (value) => String(value || "").replace(/\D/g, "").slice(0, 11);
function formatCPF(value) {
  const d = digits(value);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + "." + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
  return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
}
function isValidCPF(value) {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let len = 9; len < 11; len++) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const check = (sum * 10) % 11;
    if ((check === 10 ? 0 : check) !== Number(d[len])) return false;
  }
  return true;
}
const input = document.getElementById("cpf-input");
const result = document.getElementById("cpf-result");
const copyButton = document.getElementById("copy-cpf");
const copyFeedback = document.getElementById("copy-feedback");
input.addEventListener("input", () => {
  input.value = formatCPF(input.value);
  result.hidden = true;
  copyButton.disabled = !isValidCPF(input.value);
  copyFeedback.textContent = "";
});
document.getElementById("cpf-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const d = digits(input.value);
  result.hidden = false;
  const valid = isValidCPF(d);
  result.className = "cpf-result " + (valid ? "is-valid" : "is-invalid");
  copyButton.disabled = !valid;
  result.textContent = d.length !== 11 ? "Digite um CPF com 11 dígitos." : valid
    ? "CPF matematicamente válido. Isso não confirma existência, titularidade ou situação cadastral."
    : "CPF inválido: os dígitos verificadores não conferem.";
});
copyButton.addEventListener("click", async () => {
  if (!isValidCPF(input.value)) return;
  try {
    await navigator.clipboard.writeText(formatCPF(input.value));
    copyFeedback.textContent = "CPF copiado. Cole o número no formulário oficial da Receita Federal.";
  } catch {
    input.focus();
    input.select();
    copyFeedback.textContent = "Selecione e copie o CPF acima para preencher a consulta oficial.";
  }
});
document.getElementById("ano").textContent = new Date().getFullYear();
const toggle = document.getElementById("menu-toggle");
const menu = document.getElementById("mobile-menu");
const header = document.querySelector(".site-header");
function setMenu(open) {
  menu.hidden = !open;
  header.classList.toggle("menu-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
}
toggle.addEventListener("click", () => setMenu(menu.hidden));
document.addEventListener("click", (event) => { if (!header.contains(event.target)) setMenu(false); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMenu(false); });
menu.addEventListener("click", (event) => { if (event.target.closest("a")) setMenu(false); });
const themeButton = document.getElementById("theme-toggle");
themeButton.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("radarfiscal:theme", next); } catch (_) {}
});


/* Consulta contratada: só aparece quando Serpro e acesso de operador estão configurados. */
const cpfSerproSection = document.getElementById("cpf-serpro-section");
const cpfApiForm = document.getElementById("cpf-api-form");
const cpfApiStatus = document.getElementById("cpf-api-status");
const cpfApiResult = document.getElementById("cpf-api-result");
const cpfApiButton = document.getElementById("cpf-api-submit");
const cpfApiNumber = document.getElementById("cpf-api-number");
const cpfApiBirth = document.getElementById("cpf-api-birth");
cpfApiNumber.addEventListener("input", () => {
  cpfApiNumber.value = formatCPF(cpfApiNumber.value);
  cpfApiResult.hidden = true;
});
cpfApiBirth.max = new Date().toISOString().slice(0, 10);
function printCpfApiResult(data) {
  cpfApiResult.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = "Consulta oficial concluída";
  cpfApiResult.appendChild(heading);
  const rows = [
    ["Nome", data.nome],
    ["Nome social", data.nomeSocial],
    ["Situação cadastral", data.situacao],
    ["Fonte", data.fonte],
    ["Consultado em", data.consultadoEm ? new Date(data.consultadoEm).toLocaleString("pt-BR") : null],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const row = document.createElement("p");
    const name = document.createElement("b");
    name.textContent = label + ": ";
    row.append(name, document.createTextNode(String(value)));
    cpfApiResult.append(row);
  }
  if (data.parcial) {
    const note = document.createElement("p");
    note.textContent = "A fonte retornou dados parciais.";
    cpfApiResult.append(note);
  }
}
async function checkCpfApiStatus() {
  try {
    const response = await fetch("/api/cpf/status", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Status indisponível");
    const info = await response.json();
    if (info.serproDisponivel === true) {
      cpfSerproSection.hidden = false;
      cpfApiStatus.textContent = "Integração configurada. Acesso exclusivo de operador autorizado.";
      cpfApiForm.hidden = false;
    } else {
      cpfSerproSection.hidden = true;
      cpfApiStatus.textContent = "Integração ainda não ativada. A consulta cadastral real depende de contrato e credenciais do Serpro; por enquanto, use o serviço da Receita Federal acima.";
      cpfApiForm.hidden = true;
    }
  } catch {
    cpfSerproSection.hidden = true;
    cpfApiStatus.textContent = "Não foi possível verificar a disponibilidade da integração. A consulta gratuita de CPF continua funcionando.";
    cpfApiForm.hidden = true;
  }
}
void checkCpfApiStatus();
cpfApiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const cpf = digits(cpfApiNumber.value);
  const nascimento = cpfApiBirth.value;
  const accessKey = document.getElementById("cpf-api-key").value;
  const finalidade = document.getElementById("cpf-api-purpose").value.trim();
  const confirmacao = document.getElementById("cpf-api-confirmation").checked;
  cpfApiResult.hidden = false;
  cpfApiResult.replaceChildren();
  cpfApiResult.classList.remove("is-error");
  if (!isValidCPF(cpf) || !nascimento || !confirmacao || finalidade.length < 10 || !accessKey) {
    cpfApiResult.textContent = "Informe CPF válido, nascimento, chave de operador e finalidade legítima confirmada.";
    cpfApiResult.classList.add("is-error");
    return;
  }
  cpfApiButton.disabled = true;
  cpfApiButton.textContent = "Consultando Serpro…";
  cpfApiResult.textContent = "Consultando a fonte oficial. Esta operação pode ser cobrada pelo fornecedor.";
  // A chave é mantida somente na variável local durante esta chamada, sem localStorage.
  document.getElementById("cpf-api-key").value = "";
  try {
    const response = await fetch("/api/cpf/consulta", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessKey },
      body: JSON.stringify({ cpf, nascimento, finalidade, confirmacao }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "A consulta oficial não foi concluída.");
    printCpfApiResult(data);
  } catch (error) {
    cpfApiResult.classList.add("is-error");
    cpfApiResult.textContent = error.message || "Não foi possível consultar o Serpro.";
  } finally {
    cpfApiButton.disabled = false;
    cpfApiButton.textContent = "Consultar cadastro oficial";
  }
});
