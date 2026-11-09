"use strict";
// Página informativa: sem coleta de CPF/CNPJ, sem chamadas a serviços de dados pessoais.
const el = (id) => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll(".asset-tab"));
function activateTab(name, updateUrl = true) {
  if (name !== "imoveis" && name !== "veiculos") name = "imoveis";
  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    el("panel-" + tab.dataset.tab).hidden = !selected;
  });
  if (updateUrl && location.hash !== "#" + name) {
    history.replaceState(null, "", "#" + name);
  }
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    activateTab(tabs[next].dataset.tab);
    tabs[next].focus();
  });
});
window.addEventListener("hashchange", () => activateTab(location.hash.slice(1), false));
activateTab(location.hash.slice(1), false);
el("ano").textContent = new Date().getFullYear();

const menu = el("mobile-menu");
const toggle = el("menu-toggle");
const header = document.querySelector(".site-header");
function setMenu(open) {
  menu.hidden = !open;
  header.classList.toggle("menu-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
}
toggle.addEventListener("click", () => setMenu(menu.hidden));
menu.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});
document.addEventListener("click", (event) => {
  if (!header.contains(event.target)) setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenu(false);
});
el("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("radarfiscal:theme", next); } catch (_) { /* storage opcional */ }
});
