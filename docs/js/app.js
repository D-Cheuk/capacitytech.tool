const EMAIL = "contato@rbcip.org";   // destino dos pedidos de correção
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx-1Chm36ZMPJuGz-Qkjp_JOSqz_aJiV2CvId4vZjIFCMlBVcoPl6oZPfR2lt1QakmL/exec";               // cole aqui a URL do Google Apps Script (app da Web)
const REQUERENTE = "Representante Legal";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const $ = i => document.getElementById(i);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const u8 = s => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
const b64 = u => { let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
const juntar = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " e " + a.at(-1);
let DATA, PUB, SEL, TOKEN, MODELO;

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
  TOKEN = $("senha").value.trim();
  $("s1").hidden = true; $("s3").hidden = false;
  const ufs = [...new Set(DATA.escolas.map(e => e.estado))].sort();
  $("uf").innerHTML = '<option value="">Selecione</option>' + ufs.map(u => `<option>${esc(u)}</option>`).join("");
  $("esc").innerHTML = '<option value="">Selecione o estado primeiro</option>';
};

$("uf").onchange = () => {
  SEL = null; $("todas").checked = false; $("esc").disabled = false;
  $("tw").hidden = !$("uf").value;
  const l = DATA.escolas.map((e, i) => [e, i]).filter(([e]) => e.estado === $("uf").value)
    .sort((a, b) => a[0].escola.localeCompare(b[0].escola, "pt"));
  $("esc").innerHTML = '<option value="">Selecione</option>' +
    l.map(([e, i]) => `<option value="${i}">${esc(e.escola)} — ${esc(e.municipio)}</option>`).join("");
  mostrar();
};
$("todas").onchange = () => { $("esc").disabled = $("todas").checked; mostrar(); };
$("esc").onchange = () => { SEL = $("esc").value === "" ? null : DATA.escolas[+$("esc").value]; mostrar(); };

const lista = () => $("todas").checked ? DATA.escolas.filter(e => e.estado === $("uf").value) : (SEL ? [SEL] : []);

function mostrar() {
  $("m4").textContent = "";
  const l = lista();
  if (!l.length) { $("s4").hidden = true; return; }

  if ($("todas").checked) {
    // 1. Soma o total de formados de todas as escolas do estado
    const totalAlunos = l.reduce((soma, escola) => soma + (Number(escola.qtd) || 0), 0);

    // 2. Agrupa e soma a quantidade de cada curso em nível estadual
    const cursosEstado = {};
    l.forEach(escola => {
      if (escola.cursos) {
        escola.cursos.forEach(curso => {
          cursosEstado[curso.nome] = (cursosEstado[curso.nome] || 0) + (Number(curso.qtd) || 0);
        });
      }
    });

    // Transforma o objeto consolidado em uma lista HTML (<li>)
    const cursosHtml = Object.entries(cursosEstado)
      .map(([nome, qtd]) => `<li>${esc(nome)} (${qtd})</li>`)
      .join("");

    $("resumo").innerHTML = `
      <dl>
        <dt>Estado</dt><dd>${esc($("uf").value)}</dd>
        <dt>Escolas</dt><dd>${l.length} (um atestado por escola, reunidos em .zip)</dd>
        <dt>Cursos</dt><dd><ul>${cursosHtml || "<li>Nenhum curso encontrado</li>"}</ul></dd>
        <dt>Formados</dt><dd>${totalAlunos}</dd>
      </dl>`;
  } else {
    // Exibição normal para uma única escola selecionada
    $("resumo").innerHTML = `
      <dl>
        <dt>Estado</dt><dd>${esc(SEL.estado)}</dd>
        <dt>Município</dt><dd>${esc(SEL.municipio)}</dd>
        <dt>Escola</dt><dd>${esc(SEL.escola)}</dd>
        <dt>Cursos</dt><dd><ul>${SEL.cursos.map(c => `<li>${esc(c.nome)} (${c.qtd})</li>`).join("")}</ul></dd>
        <dt>Formados</dt><dd>${SEL.qtd}</dd>
        <dt>Período</dt><dd>${SEL.inicio} a ${SEL.fim}</dd>
      </dl>`;
  }

  $("s4").hidden = false;
}

async function modelo() {
  if (MODELO) return MODELO;
  const resp = await fetch("modelo.docx");
  if (!resp.ok) throw new Error(`modelo.docx não encontrado na pasta docs (erro ${resp.status}).`);
  const buf = await resp.arrayBuffer();
  if (new Uint8Array(buf.slice(0, 2)).join() !== "80,75") throw new Error("modelo.docx não é um arquivo Word válido.");
  return (MODELO = buf);
}

async function gerarDocx(e) {
  const Docx = window.docxtemplater || window.Docxtemplater || window.DocxTemplater;
  if (!Docx || !window.PizZip) throw new Error("bibliotecas não carregadas. Recarregue com Ctrl+Shift+R.");
  const doc = new Docx(new window.PizZip(await modelo()), {paragraphLoop: true, linebreaks: true});
  doc.render({requerente: REQUERENTE, escola: e.escola, municipio: e.municipio, estado: e.estado,
    qtd: e.qtd, inicio: e.inicio, fim: e.fim, cursos: e.cursos, cursos_texto: juntar(e.cursos.map(c => c.frase)),
    data: new Date().toLocaleDateString("pt-BR", {day: "numeric", month: "long", year: "numeric"})});
  return doc.getZip().generate({type: "uint8array"});
}

async function gerarPdf(bytes) {
  if (!SCRIPT_URL) throw new Error("PDF ainda não configurado (SCRIPT_URL vazio). Use o .docx.");
  if (!navigator.onLine) throw new Error("O PDF exige internet. Use o .docx.");
  const r = await fetch(SCRIPT_URL, {method: "POST", body: JSON.stringify({token: TOKEN, docx: b64(bytes)})});
  const j = await r.json();
  if (!j.ok) throw new Error(j.erro || "falha na conversão");
  return Uint8Array.from(atob(j.pdf), c => c.charCodeAt(0));
}

function salvar(dados, nome, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(dados instanceof Blob ? dados : new Blob([dados], {type: tipo}));
  a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function gerar(fmt) {
  const l = lista(), usados = new Set(), arqs = [], falhas = [];
  if (!l.length) return;
  const nomeArq = e => {
    const n = `Atestado_${e.escola}_${e.municipio}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_").slice(0, 80);
    let k = n, i = 2; while (usados.has(k)) k = n + "_" + i++; usados.add(k); return k;
  };
  $("bpdf").disabled = $("bdocx").disabled = true;
  for (let i = 0; i < l.length; i++) {
    $("m4").textContent = `Gerando ${i + 1} de ${l.length}...`;
    try {
      const d = await gerarDocx(l[i]), n = nomeArq(l[i]);
      arqs.push(fmt === "pdf" ? [n + ".pdf", await gerarPdf(d)] : [n + ".docx", d]);
    } catch (e) {
      falhas.push(`${l[i].escola} (${l[i].municipio}): ${e.message}`);
      if (!arqs.length && falhas.length >= 3) break;   // falha geral: não insistir
    }
  }
  $("bpdf").disabled = $("bdocx").disabled = false;
  if (!arqs.length) { $("m4").textContent = "Não foi possível gerar: " + falhas[0]; return; }
  if (l.length === 1) salvar(arqs[0][1], arqs[0][0], fmt === "pdf" ? "application/pdf" : DOCX_MIME);
  else {
    const z = new window.PizZip();
    arqs.forEach(([n, d]) => z.file(n, d));
    salvar(z.generate({type: "blob", compression: "DEFLATE"}), `Atestados_${$("uf").value.replace(/\W+/g, "_")}.zip`);
  }
  $("m4").textContent = falhas.length ? `Concluído: ${arqs.length} gerados, ${falhas.length} com falha:\n` + falhas.join("\n") : "Concluído.";
  $("m4").style.whiteSpace = "pre-line";
}
$("bpdf").onclick = () => gerar("pdf");
$("bdocx").onclick = () => gerar("docx");

$("corrigir").onclick = () => {
  const l = lista(), e = l[0];
  const corpo = l.length === 1
    ? `Escola: ${e.escola}\nMunicípio/Estado: ${e.municipio} / ${e.estado}\nFormados: ${e.qtd}\nPeríodo: ${e.inicio} a ${e.fim}\nCursos: ${juntar(e.cursos.map(c => c.nome))}\n\nDado a corrigir e valor correto:\n`
    : `Estado: ${$("uf").value}\nEscola:\n\nDado a corrigir e valor correto:\n`;
  location.href = `mailto:${EMAIL}?subject=${encodeURIComponent("Correção de dados – " + (l.length === 1 ? e.escola : $("uf").value))}&body=${encodeURIComponent(corpo)}`;
};

