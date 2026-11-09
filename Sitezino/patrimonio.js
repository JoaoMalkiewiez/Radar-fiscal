"use strict";
/* Documento validado apenas no navegador: nenhuma API recebe CPF/CNPJ desta tela. */
const el=(id)=>document.getElementById(id);
const digits=(v)=>String(v||"").replace(/\D/g,"");
const only=(v)=>digits(v).slice(0,14);
function cpfValid(v){
 const d=digits(v);if(d.length!==11||/^(\d)\1{10}$/.test(d))return false;
 for(let len=9;len<11;len++){let sum=0;for(let i=0;i<len;i++)sum+=Number(d[i])*(len+1-i);const n=(sum*10)%11;if((n===10?0:n)!==Number(d[len]))return false;}
 return true;
}
function cnpjValid(v){
 const d=digits(v);if(d.length!==14||/^(\d)\1{13}$/.test(d))return false;
 for(const n of [12,13]){let weight=n-7,sum=0;for(let i=0;i<n;i++){sum+=Number(d[i])*weight;weight--;if(weight<2)weight=9;}let r=sum%11;if((r<2?0:11-r)!==Number(d[n]))return false;}return true;
}
function formatDocument(v){
 const d=only(v);if(d.length<=11){if(d.length<=3)return d;if(d.length<=6)return d.slice(0,3)+"."+d.slice(3);if(d.length<=9)return d.slice(0,3)+"."+d.slice(3,6)+"."+d.slice(6);return d.slice(0,3)+"."+d.slice(3,6)+"."+d.slice(6,9)+"-"+d.slice(9);}
 return d.slice(0,2)+"."+d.slice(2,5)+"."+d.slice(5,8)+"/"+d.slice(8,12)+"-"+d.slice(12);
}
function maskDocument(d){return d.length===11?"***.***."+d.slice(6,9)+"-**":"**.***.***/"+d.slice(8,12)+"-**";}
function activateTab(name){
 if(name!=="imoveis"&&name!=="veiculos")name="imoveis";
 for(const tab of document.querySelectorAll(".asset-tab")){let active=tab.dataset.tab===name;tab.setAttribute("aria-selected",String(active));tab.tabIndex=active?0:-1;el("panel-"+tab.dataset.tab).hidden=!active;}
 if(location.hash!=="#"+name)history.replaceState(null,"","#"+name);
}
for(const tab of document.querySelectorAll(".asset-tab"))tab.addEventListener("click",()=>activateTab(tab.dataset.tab));
window.addEventListener("hashchange",()=>activateTab(location.hash.slice(1)));
activateTab(location.hash.slice(1));
const docInput=el("asset-document"),result=el("asset-result");
docInput.addEventListener("input",()=>{docInput.value=formatDocument(docInput.value);result.hidden=true;});
el("asset-state").addEventListener("change",()=>result.hidden=true);
el("asset-purpose").addEventListener("change",()=>result.hidden=true);
el("asset-consent").addEventListener("change",()=>result.hidden=true);
el("asset-form").addEventListener("submit",(event)=>{
 event.preventDefault();
 const d=digits(docInput.value),valid=cpfValid(d)||cnpjValid(d),uf=el("asset-state").value,purpose=el("asset-purpose").value,confirmed=el("asset-consent").checked;
 result.hidden=false;
 result.classList.toggle("is-error",!valid||!uf||!purpose||!confirmed);
 result.replaceChildren();
 if(!valid||!uf||!purpose||!confirmed){
  result.textContent=(!valid?"Informe um CPF ou CNPJ matematicamente válido. ":"")+(!uf?"Selecione o estado. ":"")+(!purpose?"Informe a finalidade. ":"")+(!confirmed?"Confirme a declaração de responsabilidade.":"");return;
 }
 const heading=document.createElement("strong");heading.textContent="Preparação concluída — não é uma pesquisa de bens";
 const summary=document.createElement("div");summary.textContent="Documento: "+maskDocument(d)+" · Estado: "+uf+" · Finalidade declarada: "+el("asset-purpose").selectedOptions[0].textContent+".";
 const note=document.createElement("p");note.textContent="Agora abra o RI Digital pelo link ao lado, autentique-se e informe o documento diretamente no serviço oficial. O Radar Fiscal não transmite seus dados nem recebe resultados.";
 const copy=document.createElement("button");copy.type="button";copy.textContent="Copiar documento para a consulta oficial";copy.addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText(formatDocument(d));copy.textContent="Documento copiado";}catch{docInput.focus();docInput.select();copy.textContent="Selecione e copie o documento acima";}
 });
 result.append(heading,summary,note,copy);
});
el("ano").textContent=new Date().getFullYear();
const menu=el("mobile-menu"),toggle=el("menu-toggle"),header=document.querySelector(".site-header");
function setMenu(open){menu.hidden=!open;header.classList.toggle("menu-open",open);toggle.setAttribute("aria-expanded",String(open));toggle.setAttribute("aria-label",open?"Fechar menu":"Abrir menu");}
toggle.addEventListener("click",()=>setMenu(menu.hidden));
menu.addEventListener("click",e=>{if(e.target.closest("a"))setMenu(false);});
document.addEventListener("click",e=>{if(!header.contains(e.target))setMenu(false);});
document.addEventListener("keydown",e=>{if(e.key==="Escape")setMenu(false);});
el("theme-toggle").addEventListener("click",()=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;try{localStorage.setItem("radarfiscal:theme",next)}catch(_){}});
