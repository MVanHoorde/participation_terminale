#!/usr/bin/env python3
"""Assemble les pages autonomes à partir de src/ et vendor/.

    python3 build.py

Produit A01-professeur.html et A01-observateur.html à la racine du dépôt.
Ces deux fichiers sont générés : ne jamais les modifier à la main, toute
correction se fait dans src/ puis on relance ce script.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent
SRC, VEN = ROOT / "src", ROOT / "vendor"

def read(p):
    if not p.exists():
        sys.exit(f"fichier manquant : {p}")
    return p.read_text(encoding="utf-8")

css = read(SRC / "common.css")
com = read(SRC / "common.js")
imp = read(SRC / "import.js")
app = read(SRC / "app-prof.js")
qrg = read(VEN / "qrcode.min.js")
jsq = read(VEN / "jsQR.min.js")

qrg += "\n;if(typeof qrcode==='undefined'&&typeof window!=='undefined'&&window.qrcode){var qrcode=window.qrcode;}\n"
# Indispensable : sans cela les prénoms accentués sont encodés en latin-1
# et jsQR renvoie une chaîne vide. Panne totale et silencieuse.
qrg += ";qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];\n"
jsq += "\n;if(typeof jsQR==='undefined'&&typeof window!=='undefined'&&window.jsQR){var jsQR=window.jsQR;}\n"

for src, dst in [("observateur.src.html", "A01-observateur.html"),
                 ("professeur.src.html",  "A01-professeur.html")]:
    h = read(SRC / src)
    subs = [("/*__CSS__*/", css), ("/*__COMMON__*/", com),
            ("/*__QRGEN__*/", qrg), ("/*__JSQR__*/", jsq)]
    if "/*__APP__*/" in h:
        subs.append(("/*__APP__*/", imp + "\n" + app))
    for marker, payload in subs:
        if marker not in h:
            sys.exit(f"marqueur {marker} absent de {src}")
        h = h.replace(marker, payload)
    (ROOT / dst).write_text(h, encoding="utf-8")
    print(f"{dst}  {len(h)//1024} Ko")
