#!/usr/bin/env python3
"""Ferramenta do criador.  Uso:
  python tool.py keygen                         # 1x: cria o par de chaves
  python tool.py build fonte.csv [--ver-min 1]  # gera docs/data.json
  python tool.py token [--dias 7] [--ver 1]     # imprime uma senha nova
"""
import argparse, base64, json, re, struct, sys, time, unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

BASE = Path(__file__).resolve().parent
DOCS = BASE.parent / "docs"
KEY = BASE / "private_key.pem"  # NUNCA subir ao GitHub
CATALOGO = BASE / "catalogo.json"  # {"curso na planilha": {"nome": "...", "topicos": [...]}}
def norm(s):
    """Chave de comparação: sem acentos, sem caracteres invisíveis, sem maiúsculas, espaços únicos."""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(ch for ch in s if unicodedata.category(ch) not in ("Mn", "Cf"))
    return " ".join(s.casefold().split())


b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def keygen():
    if KEY.exists():
        sys.exit("Chave já existe. Apagá-la invalida todas as senhas emitidas.")
    k = ec.generate_private_key(ec.SECP256R1())
    KEY.write_bytes(k.private_bytes(serialization.Encoding.PEM,
                                    serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption()))
    pub = k.public_key().public_bytes(serialization.Encoding.X962,
                                      serialization.PublicFormat.UncompressedPoint)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "pubkey.json").write_text(json.dumps({"pub": b64(pub)}))
    print("Chaves criadas. Guarde private_key.pem fora do repositório.")


def pubkey():
    """Recria docs/pubkey.json a partir da chave privada existente."""
    k = serialization.load_pem_private_key(KEY.read_bytes(), None)
    pub = k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "pubkey.json").write_text(json.dumps({"pub": b64(pub)}))
    print("pubkey.json gravado em", DOCS)


def token(dias, ver):
    k = serialization.load_pem_private_key(KEY.read_bytes(), None)
    msg = struct.pack(">IH", int(time.time()) + dias * 86400, ver)  # validade + versão
    r, s = decode_dss_signature(k.sign(msg, ec.ECDSA(hashes.SHA256())))
    print(b64(msg + r.to_bytes(32, "big") + s.to_bytes(32, "big")))


def pdate(v):
    """Sempre dia/mês/ano. Aceita data real (Sheets/Excel), texto com/sem hora e serial."""
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    if isinstance(v, (datetime, pd.Timestamp)):
        return v.date()
    if isinstance(v, (int, float)):
        return (datetime(1899, 12, 30) + timedelta(days=float(v))).date()
    s = str(v).strip()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    iso = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    try:
        if m:
            d, mo, y = map(int, m.groups())
        elif iso:
            y, mo, d = map(int, iso.groups())
        else:
            return None
        return date(y, mo, d)
    except ValueError:
        return None


def load(path):
    p = Path(path)
    if p.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(p, dtype=object)
    else:
        df = pd.read_csv(p, sep=None, engine="python", dtype=str, encoding="utf-8-sig")
    df.columns = [c.strip().upper() for c in df.columns]
    return df


def build(src, ver_min):
    df = load(src)
    need = ["ID", "ESTADO", "MUNICÍPIO", "ESCOLA", "CURSO", "DATA DE ADESÃO", "DATA DE CONCLUSÃO DO CURSO"]
    miss = [c for c in need if c not in df.columns]
    if miss:
        sys.exit(f"Colunas ausentes: {miss}")
    df = df[need].dropna(subset=["ESTADO", "MUNICÍPIO", "ESCOLA", "CURSO"]).copy()
    for c in ["ESTADO", "MUNICÍPIO", "ESCOLA", "CURSO"]:
        df[c] = df[c].astype(str).str.split().str.join(" ")
    df["ESTADO"] = df["ESTADO"].str.replace(r",\s*Brasil$", "", regex=True)
    for c in ["ESTADO", "MUNICÍPIO", "ESCOLA", "CURSO"]:   # chaves de agrupamento sem acento/caixa/invisíveis
        df["K_" + c] = df[c].map(norm)
    df["ADE"] = df["DATA DE ADESÃO"].map(pdate)
    df["CON"] = df["DATA DE CONCLUSÃO DO CURSO"].map(pdate)

    ruins = df[df.ADE.isna() | df.CON.isna()]
    if len(ruins):
        print(f"AVISO: {len(ruins)} matrículas sem data válida foram ignoradas.")
        df = df.drop(ruins.index)
    if df["ID"].duplicated().any():
        print(f"AVISO: {df['ID'].duplicated().sum()} IDs repetidos (contados como matrículas distintas).")

    cat = {norm(k): v for k, v in json.loads(CATALOGO.read_text(encoding="utf-8")).items()} \
        if CATALOGO.exists() else {}
    faltam, escolas = set(), []
    fmt = lambda d: d.strftime("%d/%m/%Y")
    for _, g in df.groupby(["K_ESTADO", "K_MUNICÍPIO", "K_ESCOLA"]):  # chave: estado+município+escola
        uf, mun, esc = g.ESTADO.iloc[0], g["MUNICÍPIO"].iloc[0], g.ESCOLA.iloc[0]
        cursos = []
        for ck, gc in g.groupby("K_CURSO"):
            cur = gc.CURSO.iloc[0]
            c = cat.get(ck)
            if c is None:
                faltam.add(cur)
            c = c or {}
            nome = c.get("nome", cur)
            cursos.append({"nome": nome, "frase": c.get("frase", nome.lower()),
                           "topicos": c.get("topicos", []), "qtd": len(gc),
                           "inicio": fmt(gc.ADE.min()), "fim": fmt(gc.CON.max())})
        escolas.append({"estado": uf, "municipio": mun, "escola": esc, "qtd": len(g),
                        "inicio": fmt(g.ADE.min()), "fim": fmt(g.CON.max()), "cursos": cursos})
    if faltam:
        print("AVISO: cursos fora do catálogo (usado o nome da planilha):")
        for f in sorted(faltam):
            print("  -", repr(f))

    DOCS.mkdir(exist_ok=True)
    out = {"ver_min": ver_min, "gerado": datetime.now().strftime("%d/%m/%Y %H:%M"), "escolas": escolas}
    (DOCS / "data.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {len(escolas)} escolas, {sum(e['qtd'] for e in escolas)} matrículas -> docs/data.json")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("keygen")
    sp.add_parser("pubkey")
    b = sp.add_parser("build"); b.add_argument("fonte"); b.add_argument("--ver-min", type=int, default=1)
    t = sp.add_parser("token"); t.add_argument("--dias", type=int, default=7); t.add_argument("--ver", type=int, default=1)
    a = ap.parse_args()
    {"keygen": keygen, "pubkey": pubkey, "build": lambda: build(a.fonte, a.ver_min),
     "token": lambda: token(a.dias, a.ver)}[a.cmd]()
