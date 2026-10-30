const EMAIL = "contato@rbcip.org";           // destino dos pedidos de correção
const $ = i => document.getElementById(i);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const u8 = s => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
let DATA, PUB, SEL;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

async function carregar() {   // devolve "" se ok, ou o nome do arquivo que falhou
  const ler = async n => {
    const r = await fetch(n, {cache: "no-cache"});
    if (!r.ok) throw new Error(`${n} (erro ${r.status})`);
    return r.json();
  };
  try { DATA = await ler("data.json"); PUB = (await ler("pubkey.json")).pub; return ""; }
  catch (e) { return e.message; }
}

async function validar(t) {
  let b;
  try { b = u8(t.trim()); } catch { return "Senha inválida."; }
  if (b.length !== 70) return "Senha inválida.";
  const key = await crypto.subtle.importKey("raw", u8(PUB), {name:"ECDSA", namedCurve:"P-256"}, false, ["verify"]);
  const ok = await crypto.subtle.verify({name:"ECDSA", hash:"SHA-256"}, key, b.slice(6), b.slice(0, 6));
  if (!ok) return "Senha inválida.";
  const dv = new DataView(b.buffer);
  if (dv.getUint32(0) * 1000 < Date.now()) return "Senha expirada. Solicite uma nova.";
  if (dv.getUint16(4) < DATA.ver_min) return "Senha revogada. Solicite uma nova.";
  return "";
}

$("entrar").onclick = async () => {
  const falha = await carregar();
  if (falha && !(DATA && PUB)) { $("m1").textContent = "Não foi possível carregar: " + falha + ". Se estiver offline, abra o site online ao menos uma vez."; return; }
  const erro = await validar($("senha").value);
  $("m1").textContent = erro;
  if (erro) return;
  $("s1").hidden = true; $("s2").hidden = false; $("s3").hidden = false;
  const ufs = [...new Set(DATA.escolas.map(e => e.estado))].sort();
  $("uf").innerHTML = '<option value="">Selecione</option>' + ufs.map(u => `<option>${esc(u)}</option>`).join("");
  $("esc").innerHTML = '<option value="">Selecione o estado primeiro</option>';
};

$("uf").onchange = () => {
  $("s4").hidden = true;
  const l = DATA.escolas.map((e, i) => [e, i]).filter(([e]) => e.estado === $("uf").value)
    .sort((a, b) => a[0].escola.localeCompare(b[0].escola, "pt"));
  $("esc").innerHTML = '<option value="">Selecione</option>' +
    l.map(([e, i]) => `<option value="${i}">${esc(e.escola)} — ${esc(e.municipio)}</option>`).join("");
};

$("esc").onchange = () => {
  if ($("esc").value === "") { $("s4").hidden = true; return; }
  SEL = DATA.escolas[+$("esc").value];   // todos os cursos da escola entram automaticamente
  $("resumo").innerHTML = `<dl>
    <dt>Estado</dt><dd>${esc(SEL.estado)}</dd>
    <dt>Município</dt><dd>${esc(SEL.municipio)}</dd>
    <dt>Escola</dt><dd>${esc(SEL.escola)}</dd>
    <dt>Cursos</dt><dd><ul>${SEL.cursos.map(c => `<li>${esc(c.nome)} (${c.qtd})</li>`).join("")}</ul></dd>
    <dt>Formados</dt><dd>${SEL.qtd}</dd>
    <dt>Período</dt><dd>${SEL.inicio} a ${SEL.fim}</dd></dl>`;
  $("s4").hidden = false;
};

$("cpf").oninput = e => {
  const d = e.target.value.replace(/\D/g, "").slice(0, 11);
  e.target.value = d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

const juntar = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " e " + a.at(-1);

$("gerar").onclick = async () => {
  const nome = $("nome").value.trim(), cargo = $("cargo").value.trim(), cpf = $("cpf").value;
  if (!nome || !cargo || cpf.replace(/\D/g, "").length !== 11 || !$("end").value.trim()) { $("m4").textContent = "Preencha nome, cargo, CPF (11 dígitos) e endereço da escola."; return; }
  const cs = SEL.cursos, t = SEL;
  $("m4").textContent = "";
  try {
    const buf = await fetch("modelo.docx").then(r => r.arrayBuffer());
    const Docx = window.docxtemplater || window.Docxtemplater || window.DocxTemplater;
    if (!Docx || !window.PizZip) throw new Error("bibliotecas não carregadas (" + [!Docx && "docxtemplater", !window.PizZip && "PizZip"].filter(Boolean).join(", ") + "). Recarregue com Ctrl+Shift+R.");
    const doc = new Docx(new window.PizZip(buf), {paragraphLoop: true, linebreaks: true});
    doc.render({requerente: nome.toUpperCase(), cargo: cargo.toUpperCase(), cpf,
      data: new Date().toLocaleDateString("pt-BR", {day: "numeric", month: "long", year: "numeric"}),
      escola: SEL.escola, municipio: SEL.municipio, estado: SEL.estado, endereco: $("end").value.trim(),
      qtd: t.qtd, inicio: t.inicio, fim: t.fim,
      cursos: cs, cursos_texto: juntar(cs.map(c => c.frase))});
    const blob = doc.getZip().generate({type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Atestado_${SEL.escola.replace(/[^\w]+/g, "_")}.docx`;
    a.click(); URL.revokeObjectURL(a.href);
  } catch (e) { $("m4").textContent = "Não foi possível gerar o atestado: " + e.message; }
};

$("corrigir").onclick = () => {
  const cs = SEL.cursos, t = SEL;
  const corpo = `Escola: ${SEL.escola}\nMunicípio/Estado: ${SEL.municipio} / ${SEL.estado}\nFormados: ${t.qtd}\nPeríodo: ${t.inicio} a ${t.fim}\nCursos: ${juntar(cs.map(c => c.nome))}\n\nDado a corrigir e valor correto:\n`;
  location.href = `mailto:${EMAIL}?subject=${encodeURIComponent("Correção de dados – " + SEL.escola)}&body=${encodeURIComponent(corpo)}`;
};
