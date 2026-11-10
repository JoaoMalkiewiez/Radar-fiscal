"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {parseCsv, normalize, search} = require("../rural-csv");

const csv = [
  "Código do Imóvel;Denominação;Município;UF;Área Total (ha);Titular;Condição da Pessoa;Percentual de Detenção",
  '123;"FAZENDA; EXEMPLO";Blumenau;SC;15,7;"João da Silva";Proprietário;50',
  '124;SÍTIO DE TESTE;Gaspar;SC;8,0;Empresa Teste;Possuidor;100',
  '125;COLÔNIA;Blumenau;SC;4,0;João da Silva;Detentor;25',
].join("\r\n");

test("parser do SNCR lê CSV com separador ponto e vírgula, aspas e UTF-8",()=>{
 const rows=parseCsv("\uFEFF"+csv);
 assert.equal(rows.length,4);
 assert.equal(rows[1][1],"FAZENDA; EXEMPLO");
 assert.equal(rows[2][1],"SÍTIO DE TESTE");
});
test("pesquisa por nome exato não confunde nomes semelhantes nem acentos",()=>{
 const result=search(csv,"joao da silva");
 assert.equal(result.matches.length,2);
 assert.equal(result.searchedRows,3);
 assert.equal(result.matches[0].name,"FAZENDA; EXEMPLO");
 assert.equal(result.matches[1].code,"125");
 assert.equal(search(csv,"João da Silva Filho").matches.length,0);
});
test("ausência na planilha é diferente de ausência de bens",()=>{
 assert.deepEqual(search(csv,"Pessoa Inexistente").matches,[]);
});
test("rejeita planilha sem colunas de titular e imóvel",()=>{
 assert.throws(()=>search("Nome;Número\nTeste;123","Teste"),/colunas de Titular/);
});
test("rejeita CSV malformado sem inventar dados",()=>{
 assert.throws(()=>parseCsv('"Aspas não fechadas'),/aspas não fechadas/);
});
test("normaliza espaços e acentos sem fazer correspondência parcial",()=>{
 assert.equal(normalize("  JoÃo   DA    SILVA "), "joao da silva");
});
