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
const processInput=$("process-number");
processInput.addEventListener("input",()=>{processInput.value=formatCNJ(processInput.value);$("process-result").hidden=true;});
$("process-form").addEventListener("submit",(e)=>{
 e.preventDefault();
 const d=digits(processInput.value), result=$("process-result");
 result.hidden=false;
 result.classList.toggle("is-error",!validCNJ(d));
 if(d.length!==20) {result.textContent="Informe os 20 dígitos do número CNJ.";return;}
 if(!validCNJ(d)) {result.textContent="Número CNJ inválido: confira os dígitos verificadores. Nenhuma consulta ao tribunal foi realizada.";return;}
 const segments={1:"Supremo Tribunal Federal",2:"Conselho Nacional de Justiça",3:"Superior Tribunal de Justiça",4:"Justiça Federal",5:"Justiça do Trabalho",6:"Justiça Eleitoral",7:"Justiça Militar da União",8:"Justiça Estadual",9:"Justiça Militar Estadual"};
 const branch=d[13],year=d.slice(9,13);
 result.textContent="Número CNJ válido (verificação matemática).\nAno: "+year+"\nSegmento: "+(segments[branch]||"Não identificado")+"\nPara consultar movimentações e partes, acesse o tribunal competente pelos links oficiais abaixo. A validação não comprova que o processo existe.";
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
