"use strict";
const $ = (id) => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll(".legal-tab"));
function activateTab(name) {
  if (!["processos","empresas","documentos"].includes(name)) name = "processos";
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    $( "panel-" + tab.dataset.tab).hidden = !active;
  });
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
}
tabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
window.addEventListener("hashchange", () => activateTab(location.hash.slice(1)));
activateTab(location.hash.slice(1));
function digits(value) { return String(value || "").replace(/\D/g, ""); }
function formatCNJ(value) {
  const d = digits(value).slice(0,20);
  return [d.slice(0,7),d.slice(7,9),d.slice(9,13),d.slice(13,14),d.slice(14,16),d.slice(16,20)].filter(Boolean).map((part,i)=>i===0?part:(i===1?"-":".")+part).join("");
}
function validCNJ(value) {
  const d = digits(value);
  if(d.length !== 20 || /^0{20}$/.test(d)) return false;
  const base = d.slice(0,7)+d.slice(9);
  let rem = 0;
  for (const ch of base+"00") rem = (rem*10+Number(ch))%97;
  return Number(d.slice(7,9)) === 98-rem;
}
const BRANCHES = {
  1: "Supremo Tribunal Federal", 2: "Conselho Nacional de Justiça",
  3: "Superior Tribunal de Justiça", 4: "Justiça Federal",
  5: "Justiça do Trabalho", 6: "Justiça Eleitoral",
  7: "Justiça Militar da União", 8: "Justiça Estadual",
  9: "Justiça Militar Estadual"
};
const STATES = {
  "01":"Acre", "02":"Alagoas", "03":"Amapá", "04":"Amazonas",
  "05":"Bahia", "06":"Ceará", "07":"Distrito Federal e Territórios",
  "08":"Espírito Santo", "09":"Goiás", "10":"Maranhão",
  "11":"Mato Grosso", "12":"Mato Grosso do Sul", "13":"Minas Gerais",
  "14":"Pará", "15":"Paraíba", "16":"Paraná", "17":"Pernambuco",
  "18":"Piauí", "19":"Rio de Janeiro", "20":"Rio Grande do Norte",
  "21":"Rio Grande do Sul", "22":"Rondônia", "23":"Roraima",
  "24":"Santa Catarina", "25":"Sergipe", "26":"São Paulo",
  "27":"Tocantins"
};
const COURT_DIRECTORY = "https://www.cnj.jus.br/poder-judiciario/tribunais/";
const PUBLIC_PORTALS = {
  "8.24": { label:"Consulta processual — TJSC (eproc)", url:"https://www.tjsc.jus.br/web/processo-eletronico-eproc" },
  "8.26": { label:"Consulta processual — TJSP (e-SAJ)", url:"https://esaj.tjsp.jus.br/esaj?servico=190090" },
  "8.16": { label:"Consulta processual — TJPR (Projudi)", url:"https://consulta.tjpr.jus.br/projudi_consulta/processo/consultaPublica.do?actionType=iniciar" },
  "4.04": { label:"Consulta processual — TRF4", url:"https://www.trf4.jus.br/trf4/controlador.php?acao=pagina_visualizar&id_pagina=3929" }
};
function processDestination(d) {
  const branch = d[13], courtCode = d.slice(14,16);
  const region = branch === "8" && STATES[courtCode]
    ? "Tribunal de Justiça de " + STATES[courtCode]
    : branch === "4"
      ? "Tribunal Regional Federal da " + Number(courtCode) + "ª Região"
      : branch === "5"
        ? "Tribunal Regional do Trabalho da " + Number(courtCode) + "ª Região"
        : branch === "6" ? "Tribunal Regional Eleitoral (código " + courtCode + ")" : "Código do tribunal: " + courtCode;
  return { name:region, portal:PUBLIC_PORTALS[branch+"."+courtCode] || {label:"Localizar o tribunal no CNJ",url:COURT_DIRECTORY} };
}
const processInput=$("process-number");
const processActions=$("process-actions");
const tribunalLink=$("tribunal-link");
const processResult=$("process-result");
processInput.addEventListener("input",()=>{
 processInput.value=formatCNJ(processInput.value);
 processResult.hidden=true;
 processActions.hidden=true;
 $("process-copy-status").textContent="";
});
$("process-form").addEventListener("submit",(e)=>{
 e.preventDefault();
 const d=digits(processInput.value), valid=validCNJ(d);
 processResult.hidden=false;
 processResult.classList.toggle("is-error",!valid);
 processActions.hidden=!valid;
 if(d.length!==20){processResult.textContent="Informe os 20 dígitos do número CNJ.";return;}
 if(!valid){processResult.textContent="Número CNJ inválido: confira os dígitos verificadores. Nenhuma consulta ao tribunal foi realizada.";return;}
 const destination=processDestination(d);
 processResult.textContent="Número CNJ matematicamente válido.\nAno: "+d.slice(9,13)+"\nRamo: "+(BRANCHES[d[13]]||"Não identificado")+"\nTribunal de origem: "+destination.name+"\n\nIsso não comprova a existência do processo nem seu andamento. Acesse a consulta oficial para verificar.";
 tribunalLink.textContent=destination.portal.label+" ↗";
 tribunalLink.href=destination.portal.url;
});
$("copy-process").addEventListener("click",async()=>{
 if(!validCNJ(processInput.value))return;
 try {
   await navigator.clipboard.writeText(formatCNJ(processInput.value));
   $("process-copy-status").textContent="Número copiado para preencher a consulta oficial.";
 } catch {
   processInput.focus();processInput.select();
   $("process-copy-status").textContent="Selecione e copie o número acima.";
 }
});
$("company-cnpj").addEventListener("input",(e)=>{
 const d=digits(e.target.value).slice(0,14);
 e.target.value=d.replace(/^(\d{2})(\d)/,"$1.$2").replace(/^(\d{2}\.\d{3})(\d)/,"$1.$2").replace(/\.(\d{3})(\d)/,".$1/$2").replace(/(\d{4})(\d)/,"$1-$2");
});
$("company-form").addEventListener("submit",(e)=>{
 e.preventDefault(); const d=digits($("company-cnpj").value);
 if(d.length!==14){$("company-cnpj").setCustomValidity("Informe 14 dígitos.");$("company-cnpj").reportValidity();$("company-cnpj").setCustomValidity("");return;}
 location.href="/?cnpj="+encodeURIComponent(d)+"#busca";
});
function documentSummary(text) {
 const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const words=(text.match(/\S+/g)||[]).length;
 const clauses=lines.filter(x=>/^(?:cl[aá]usula\s+|\d+[.ªº)]\s+|art(?:igo)?\.?\s*\d+)/i.test(x)).slice(0,20);
 const dates=Array.from(new Set(text.match(/\b\d{2}\/\d{2}\/\d{4}\b/g)||[])).slice(0,20);
 const money=Array.from(new Set(text.match(/R\$\s*\d[\d.,]*/g)||[])).slice(0,20);
 return "Resumo estrutural (não é parecer jurídico)\n\nPalavras: "+words+"\nLinhas não vazias: "+lines.length+"\nPossíveis cláusulas/artigos: "+clauses.length+"\nDatas identificadas: "+(dates.join(", ")||"nenhuma")+"\nValores monetários: "+(money.join(", ")||"nenhum")+"\n\nTrechos com possível numeração de cláusula:\n"+(clauses.join("\n")||"Nenhum identificado")+"\n\nRevise manualmente obrigações, prazos, penalidades, assinaturas e a legislação aplicável.";
}
$("analyze-document").addEventListener("click",()=>{
 const text=$("legal-text").value.trim(), result=$("document-result");
 result.hidden=false;result.classList.toggle("is-error",!text);
 result.textContent=text?documentSummary(text):"Cole um texto ou selecione um arquivo .txt para analisar.";
});
$("clear-document").addEventListener("click",()=>{$("legal-text").value="";$("legal-file").value="";$("document-result").hidden=true;});
$("legal-file").addEventListener("change",async(e)=>{
 const file=e.target.files[0];if(!file)return;
 const result=$("document-result");
 if(!/\.txt$/i.test(file.name)||file.size>200000){result.hidden=false;result.classList.add("is-error");result.textContent="Selecione um arquivo .txt de até 200 KB.";return;}
 $("legal-text").value=(await file.text()).slice(0,100000);result.hidden=true;
});
$("ano").textContent=new Date().getFullYear();
const menu=$("mobile-menu"),toggle=$("menu-toggle"),header=document.querySelector(".site-header");
function setMenu(open){menu.hidden=!open;toggle.setAttribute("aria-expanded",String(open));toggle.setAttribute("aria-label",open?"Fechar menu":"Abrir menu");header.classList.toggle("menu-open",open);}
toggle.addEventListener("click",()=>setMenu(menu.hidden));
document.addEventListener("click",e=>{if(!header.contains(e.target))setMenu(false);});
document.addEventListener("keydown",e=>{if(e.key==="Escape")setMenu(false);});
$("theme-toggle").addEventListener("click",()=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;try{localStorage.setItem("radarfiscal:theme",next);}catch(_){}});
