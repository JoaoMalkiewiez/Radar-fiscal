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
input.addEventListener("input", () => {
  input.value = formatCPF(input.value);
  result.hidden = true;
});
document.getElementById("cpf-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const d = digits(input.value);
  result.hidden = false;
  const valid = isValidCPF(d);
  result.className = "cpf-result " + (valid ? "is-valid" : "is-invalid");
  result.textContent = d.length !== 11 ? "Digite um CPF com 11 dígitos." : valid
    ? "CPF matematicamente válido. Isso não confirma existência, titularidade ou situação cadastral."
    : "CPF inválido: os dígitos verificadores não conferem.";
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
