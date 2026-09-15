/* ===== Lecture de tableurs sans aucune bibliothèque =====
   xlsx : le fichier est une archive zip ; on l'ouvre avec DecompressionStream
   (natif Safari 16.4+) et on lit le XML avec DOMParser.
   csv  : analyseur conforme RFC 4180, séparateur détecté automatiquement. */

async function inflateRaw(bytes){
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEOCD(u8){
  const max = Math.min(u8.length, 66000);
  for(let i=u8.length-22; i>=u8.length-max && i>=0; i--){
    if(u8[i]===0x50 && u8[i+1]===0x4b && u8[i+2]===0x05 && u8[i+3]===0x06) return i;
  }
  return -1;
}

async function unzip(buf){
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  const eocd = findEOCD(u8);
  if(eocd < 0) throw new Error("Ce fichier n'est pas un classeur Excel valide.");
  const count = dv.getUint16(eocd+10, true);
  let p = dv.getUint32(eocd+16, true);
  const out = {};
  const dec = new TextDecoder("utf-8");
  for(let i=0;i<count;i++){
    if(dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p+10, true);
    const csize  = dv.getUint32(p+20, true);
    const nlen   = dv.getUint16(p+28, true);
    const elen   = dv.getUint16(p+30, true);
    const clen   = dv.getUint16(p+32, true);
    const lho    = dv.getUint32(p+42, true);
    const name   = dec.decode(u8.subarray(p+46, p+46+nlen));
    p += 46 + nlen + elen + clen;
    if(!/^(xl\/worksheets\/|xl\/workbook\.xml|xl\/sharedStrings\.xml)/.test(name)) continue;
    const ln = dv.getUint16(lho+26, true), le = dv.getUint16(lho+28, true);
    const start = lho + 30 + ln + le;
    const raw = u8.subarray(start, start + csize);
    out[name] = method === 0 ? raw : await inflateRaw(raw);
  }
  return out;
}

const colIndex = ref => {
  const m = /^([A-Z]+)/.exec(ref||"");
  if(!m) return 0;
  let n=0; for(const c of m[1]) n = n*26 + (c.charCodeAt(0)-64);
  return n-1;
};

async function readXlsx(file){
  if(typeof DecompressionStream === "undefined")
    throw new Error("Ce navigateur ne sait pas ouvrir les fichiers Excel. Exportez en CSV.");
  const files = await unzip(await file.arrayBuffer());
  const dec = new TextDecoder("utf-8");
  const P = new DOMParser();

  let shared = [];
  if(files["xl/sharedStrings.xml"]){
    const d = P.parseFromString(dec.decode(files["xl/sharedStrings.xml"]), "application/xml");
    shared = Array.from(d.getElementsByTagName("si")).map(si=>
      Array.from(si.getElementsByTagName("t"))
        .filter(t=>t.parentNode.nodeName!=="rPh")
        .map(t=>t.textContent).join(""));
  }

  const sheets = Object.keys(files).filter(k=>k.startsWith("xl/worksheets/")).sort();
  if(!sheets.length) throw new Error("Aucune feuille trouvée dans ce classeur.");
  const d = P.parseFromString(dec.decode(files[sheets[0]]), "application/xml");

  const grid = [];
  Array.from(d.getElementsByTagName("row")).forEach(row=>{
    const cells = [];
    Array.from(row.getElementsByTagName("c")).forEach(c=>{
      const j = colIndex(c.getAttribute("r"));
      const t = c.getAttribute("t");
      let v = "";
      if(t === "inlineStr"){
        v = Array.from(c.getElementsByTagName("t")).map(x=>x.textContent).join("");
      }else{
        const node = c.getElementsByTagName("v")[0];
        const raw = node ? node.textContent : "";
        v = (t === "s") ? (shared[+raw] ?? "") : raw;
      }
      cells[j] = String(v).trim();
    });
    grid.push(Array.from(cells, x => x === undefined ? "" : x));
  });
  return grid;
}

function readCsvText(txt){
  txt = txt.replace(/^\uFEFF/, "");
  const head = txt.slice(0, 4000);
  const sep = [";", ",", "\t"].map(s=>[s, (head.split(s).length)])
                              .sort((a,b)=>b[1]-a[1])[0][0];
  const grid=[]; let row=[], cell="", q=false;
  for(let i=0;i<txt.length;i++){
    const c = txt[i];
    if(q){
      if(c === '"'){ if(txt[i+1] === '"'){ cell+='"'; i++; } else q=false; }
      else cell += c;
    }else if(c === '"'){ q = true; }
    else if(c === sep){ row.push(cell.trim()); cell=""; }
    else if(c === "\n"){ row.push(cell.trim()); grid.push(row); row=[]; cell=""; }
    else if(c !== "\r"){ cell += c; }
  }
  if(cell || row.length){ row.push(cell.trim()); grid.push(row); }
  return grid;
}

/* --- Repérage de la ligne d'en-tête et des colonnes utiles --- */
const HEAD_NAME  = /^(nom|nom de l'?[ée]l[èe]ve|nom pr[ée]nom|nom et pr[ée]nom|[ée]l[èe]ve|name)$/i;
const HEAD_FIRST = /^(pr[ée]nom|first ?name)$/i;

function analyseGrid(grid){
  let head = -1;
  for(let i=0;i<Math.min(grid.length, 30); i++){
    if((grid[i]||[]).some(c=>HEAD_NAME.test(c) || HEAD_FIRST.test(c))){ head = i; break; }
  }
  if(head < 0){
    // pas d'en-tête : première ligne non vide
    head = grid.findIndex(r=>r.some(c=>c));
    return {head, headers:[], rows:grid.slice(head), guessName:0, guessFirst:-1, noHeader:true};
  }
  const headers = grid[head].map(c=>c||"");
  const rows = grid.slice(head+1).filter(r=>r.some(c=>c));
  let guessName  = headers.findIndex(c=>HEAD_NAME.test(c));
  let guessFirst = headers.findIndex(c=>HEAD_FIRST.test(c));
  if(guessName < 0) guessName = 0;
  return {head, headers, rows, guessName, guessFirst, noHeader:false};
}

/* --- « MARTIN LE GOFF Camille » -> {nom, prenom} --- */
function isUpperTok(t){
  const l = Array.from(t).filter(c=>c.toLowerCase()!==c.toUpperCase());
  return l.length>0 && l.every(c=>c===c.toUpperCase());
}
function splitFullName(s){
  const toks = String(s||"").replace(/\s+/g," ").trim().split(" ");
  if(toks.length < 2) return {nom:toks[0]||"", prenom:""};
  let k=0; while(k<toks.length && isUpperTok(toks[k])) k++;
  if(k===0 || k===toks.length) k = 1;            // tout en capitales ou aucune : nom = 1er mot
  return {nom:toks.slice(0,k).join(" "), prenom:toks.slice(k).join(" ")};
}
function titleCase(s){
  return String(s||"").toLowerCase().replace(/(^|[\s'\-])([\p{L}])/gu,(m,a,b)=>a+b.toUpperCase());
}
function buildNames(rows, iName, iFirst, mode){
  const out=[];
  rows.forEach(r=>{
    const a=(r[iName]||"").trim();
    if(!a && iFirst<0) return;
    let nom, prenom;
    if(iFirst>=0){ nom=a; prenom=(r[iFirst]||"").trim(); }
    else ({nom,prenom} = splitFullName(a));
    if(!nom && !prenom) return;
    const N = titleCase(nom), P = titleCase(prenom);
    let s;
    if(mode==="prenom") s = P || N;
    else if(mode==="prenom-initiale") s = (P||N) + (P && N ? " " + N.charAt(0) + "." : "");
    else if(mode==="nom-prenom") s = (nom.toUpperCase() + " " + P).trim();
    else s = (P + " " + N).trim();
    if(s) out.push(s.replace(/\s+/g," "));
  });
  return out;
}

/* ===== Trombinoscope PDF d'École Directe, sans bibliothèque =====
   Le PDF (produit par WinDev) pose chaque photo, un JPEG de 96×128, dans une
   grille de cinq colonnes, et écrit le nom dessous : « NOM Prénom » sur une
   ligne, ou NOM puis Prénom sur deux lignes quand c'est trop long.
   On lit la structure du PDF, on décompresse le contenu des pages avec
   DecompressionStream, on note où chaque image et chaque texte sont posés, et
   on rattache à chaque photo le texte écrit juste en dessous.
   Les élèves sans photo reçoivent tous la même silhouette, un seul objet posé
   plusieurs fois : toute image qui revient plus d'une fois est écartée. */

class PNom{ constructor(n){ this.n = n; } }
class PRef{ constructor(r){ this.r = r; } }
class PStr{ constructor(s){ this.s = s; } }
class POp { constructor(o){ this.o = o; } }
const P_WS = " \t\n\r\f\0", P_DELIM = "()<>[]{}/%";

const latin1 = u8 => {
  let s = "";
  for(let i=0; i<u8.length; i+=8192) s += String.fromCharCode.apply(null, u8.subarray(i, i+8192));
  return s;
};

/* Lecteur d'objets PDF, qui sert aussi pour les flux de contenu des pages
   (les opérateurs y sortent en POp). */
function pdfLexer(s, i){
  const reg = c => c !== undefined && !P_WS.includes(c) && !P_DELIM.includes(c);
  function skip(){
    for(;;){
      while(i < s.length && P_WS.includes(s[i])) i++;
      if(s[i] !== "%") return;
      while(i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
    }
  }
  function value(){
    skip();
    if(i >= s.length) return undefined;
    const c = s[i];
    if(c === "/"){
      const j = ++i; while(reg(s[i])) i++;
      return new PNom(s.slice(j, i).replace(/#([0-9a-fA-F]{2})/g, (m,h)=>String.fromCharCode(parseInt(h,16))));
    }
    if(c === "<" && s[i+1] === "<"){
      i += 2; const d = {};
      for(;;){
        skip();
        if(i >= s.length) return d;
        if(s[i] === ">"){ i += 2; return d; }
        const k = value(), v = value();
        if(k instanceof PNom) d[k.n] = v;
      }
    }
    if(c === "<"){
      const j = s.indexOf(">", i);
      let h = s.slice(i+1, j < 0 ? s.length : j).replace(/[^0-9a-fA-F]/g, "");
      i = j < 0 ? s.length : j + 1;
      if(h.length % 2) h += "0";
      let o = ""; for(let k=0; k<h.length; k+=2) o += String.fromCharCode(parseInt(h.substr(k,2),16));
      return new PStr(o);
    }
    if(c === "("){
      i++; let o = "", depth = 1;
      while(i < s.length){
        const ch = s[i++];
        if(ch === "\\"){
          const e = s[i++];
          if(e >= "0" && e <= "7"){
            let oct = e; while(oct.length < 3 && s[i] >= "0" && s[i] <= "7") oct += s[i++];
            o += String.fromCharCode(parseInt(oct,8) & 255);
          }
          else if(e === "\r"){ if(s[i] === "\n") i++; }
          else if(e !== "\n") o += ({n:"\n", r:"\r", t:"\t", b:"\b", f:"\f"})[e] ?? e;
        }
        else if(ch === "("){ depth++; o += ch; }
        else if(ch === ")"){ if(--depth === 0) break; o += ch; }
        else o += ch;
      }
      return new PStr(o);
    }
    if(c === "["){
      i++; const a = [];
      for(;;){ skip(); if(i >= s.length || s[i] === "]"){ i++; return a; } a.push(value()); }
    }
    if(!reg(c)){ i++; return new POp(c); }
    const j = i; while(reg(s[i])) i++;
    const t = s.slice(j, i);
    if(/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)){
      const m = /^\s+\d+\s+R(?=[\s\/<>\[\]()%]|$)/.exec(s.substr(i, 24));   // « 12 0 R »
      if(m && /^\d+$/.test(t)){ i += m[0].length; return new PRef(+t); }
      return +t;
    }
    if(t === "true") return true;
    if(t === "false") return false;
    if(t === "null") return null;
    return new POp(t);
  }
  return {value, skip, get pos(){ return i; }, set pos(v){ i = v; }};
}

/* Décompression zlib. Quelques octets parasites après la fin des données sont
   courants dans les PDF : on garde ce qui a été lu plutôt que tout refuser. */
async function pdfInflate(u8){
  const r = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const parts = []; let n = 0;
  try{ for(;;){ const {done, value} = await r.read(); if(done) break; parts.push(value); n += value.length; } }
  catch(e){ if(!n) throw e; }
  const out = new Uint8Array(n); let k = 0;
  parts.forEach(p=>{ out.set(p, k); k += p.length; });
  return out;
}

function pdfDoc(u8){
  const s = latin1(u8);
  const debut = s.indexOf("%PDF");
  if(debut < 0 || debut > 1024) throw new Error("Ce fichier n'est pas un PDF.");
  if(/\/Encrypt[\s\/<]/.test(s)) throw new Error("Ce PDF est protégé : l'application ne peut pas le lire.");
  const objs = {}, L = pdfLexer(s, 0), re = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while((m = re.exec(s))){
    L.pos = re.lastIndex;
    let v; try{ v = L.value(); }catch(e){ continue; }
    L.skip();
    let st = null;
    if(s.startsWith("stream", L.pos)){
      let a = L.pos + 6; if(s[a] === "\r") a++; if(s[a] === "\n") a++;
      const e = s.indexOf("endstream", a);
      st = {a, e: e < 0 ? s.length : e};
      re.lastIndex = st.e;                       // ne pas chercher d'objets dans les octets d'une image
    }else re.lastIndex = L.pos;
    objs[+m[1]] = {v, st};
  }
  const get = x => { let k = 0; while(x instanceof PRef && k++ < 32){ const o = objs[x.r]; x = o ? o.v : null; } return x; };
  const dict = x => { x = get(x); return x && x.constructor === Object ? x : null; };

  /* Données d'un flux, filtres Flate appliqués ; s'arrête sur un JPEG. */
  async function stream(ref){
    const o = ref instanceof PRef && objs[ref.r];
    if(!o || !o.st) return null;
    const d = o.v || {}, len = get(d.Length);
    let end;
    if(typeof len === "number" && len >= 0 && o.st.a + len <= s.length) end = o.st.a + len;
    else { end = o.st.e; while(end > o.st.a && (s[end-1] === "\n" || s[end-1] === "\r")) end--; }
    let bytes = u8.subarray(o.st.a, end);
    let f = get(d.Filter);
    f = f == null ? [] : Array.isArray(f) ? f.map(get) : [f];
    for(const x of f){
      const n = x && x.n;
      if(n === "FlateDecode" || n === "Fl") bytes = await pdfInflate(bytes);
      else if(n === "DCTDecode" || n === "DCT") return {bytes, dict:d, jpeg:true};
      else return null;                          // filtre non pris en charge
    }
    return {bytes, dict:d, jpeg:false};
  }

  const pages = [];
  function walk(node, res, depth){
    const n = dict(node);
    if(!n || depth > 32) return;
    const r = n.Resources !== undefined ? dict(n.Resources) : res;
    const kids = get(n.Kids);
    if(Array.isArray(kids)) kids.forEach(k=>walk(k, r, depth+1));
    else pages.push({node:n, res:r});
  }
  const cat = Object.values(objs).map(o=>o.v).find(v=>v && v.constructor === Object && get(v.Type) && get(v.Type).n === "Catalog");
  if(cat) walk(cat.Pages, null, 0);
  if(!pages.length){
    Object.values(objs).forEach(o=>{
      const v = o.v;
      if(v && v.constructor === Object && get(v.Type) && get(v.Type).n === "Page") pages.push({node:v, res:dict(v.Resources)});
    });
  }
  if(!pages.length){
    if(/\/ObjStm\b/.test(s)) throw new Error("Ce PDF utilise une structure compressée que l'application ne sait pas lire.");
    throw new Error("Aucune page lisible dans ce PDF.");
  }

  async function content(node){
    let c = node.Contents;
    if(c instanceof PRef && Array.isArray(get(c))) c = get(c);
    const parts = [];
    for(const ref of (Array.isArray(c) ? c : [c])){
      const d = await stream(ref);
      if(d) parts.push(latin1(d.bytes));
    }
    return parts.join("\n");
  }
  return {get, dict, stream, pages, content};
}

/* --- Texte : du code des caractères au texte lisible --- */
const GLYPH_ACC = {acute:"́", grave:"̀", circumflex:"̂", dieresis:"̈",
                   cedilla:"̧", tilde:"̃", ring:"̊"};
function glyphChar(n){
  if(n.length === 1) return n;
  let m = /^uni([0-9A-Fa-f]{4})$/.exec(n);
  if(m) return String.fromCharCode(parseInt(m[1],16));
  m = /^([A-Za-z])(acute|grave|circumflex|dieresis|cedilla|tilde|ring)$/.exec(n);
  if(m) return (m[1] + GLYPH_ACC[m[2]]).normalize("NFC");
  return ({space:" ", hyphen:"-", quotesingle:"'", quoteright:"'", period:".",
           AE:"Æ", ae:"æ", OE:"Œ", oe:"œ", germandbls:"ß"})[n] ?? null;
}
function parseCMap(t){
  const map = {}, hex = h => h.replace(/[^0-9a-fA-F]/g, "");
  const uni = h => {
    h = hex(h);
    if(h.length <= 2) return h ? String.fromCharCode(parseInt(h,16)) : "";
    let o = ""; for(let k=0; k+4<=h.length; k+=4) o += String.fromCharCode(parseInt(h.substr(k,4),16));
    return o;
  };
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(t);
  const bytes = cs ? Math.max(1, cs[1].length/2) : 1;
  for(const b of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for(const m of b[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]*)>/g))
      map[parseInt(hex(m[1]),16)] = uni(m[2]);
  for(const b of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for(const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F\s]+>|\[[^\]]*\])/g)){
      const lo = parseInt(m[1],16), hi = Math.min(parseInt(m[2],16), lo + 65535);
      if(m[3][0] === "["){
        const a = [...m[3].matchAll(/<([0-9a-fA-F\s]+)>/g)];
        for(let c=lo; c<=hi && c-lo<a.length; c++) map[c] = uni(a[c-lo][1]);
      }else{
        const h = hex(m[3]), pre = h.length > 4 ? uni(h.slice(0,-4)) : "", base = parseInt(h.slice(-4),16);
        for(let c=lo; c<=hi; c++) map[c] = pre + String.fromCharCode(base + c - lo);
      }
    }
  return {bytes, map};
}
async function pdfFont(doc, ref){
  const f = doc.dict(ref) || {};
  if(f.ToUnicode instanceof PRef){
    const d = await doc.stream(f.ToUnicode);
    if(d){
      const {bytes, map} = parseCMap(latin1(d.bytes));
      return str=>{
        let o = "";
        for(let k=0; k+bytes<=str.length; k+=bytes){
          let c = 0; for(let b=0; b<bytes; b++) c = c*256 + str.charCodeAt(k+b);
          o += map[c] ?? "";
        }
        return o;
      };
    }
  }
  const sub = doc.get(f.Subtype);
  if(sub && sub.n === "Type0") return ()=>"";   // codes sur deux octets sans table : illisible
  let enc = doc.get(f.Encoding), base = "windows-1252";
  const diff = {};
  const encDict = enc && enc.constructor === Object ? enc : null;
  const baseNom = encDict ? doc.get(encDict.BaseEncoding) : enc;
  if(baseNom instanceof PNom && baseNom.n === "MacRomanEncoding") base = "macintosh";
  if(encDict){
    let code = 0;
    (doc.get(encDict.Differences) || []).forEach(x=>{
      if(typeof x === "number") code = x;
      else if(x instanceof PNom){ const ch = glyphChar(x.n); if(ch != null) diff[code] = ch; code++; }
    });
  }
  let tab;
  try{ tab = new TextDecoder(base).decode(Uint8Array.from({length:256}, (_,i)=>i)); }
  catch(e){ tab = new TextDecoder("windows-1252").decode(Uint8Array.from({length:256}, (_,i)=>i)); }
  return str=>{ let o = ""; for(let k=0; k<str.length; k++){ const c = str.charCodeAt(k) & 255; o += diff[c] ?? tab[c]; } return o; };
}

/* --- Contenu d'une page : où sont posés les images et les textes --- */
const M_ID = [1,0,0,1,0,0];
const mmul = (a, b) => [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2],
                        a[2]*b[1]+a[3]*b[3], a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5]];
async function pdfRun(doc, text, res, ctm0, out, depth){
  const L = pdfLexer(text, 0), pile = [], polices = {};
  let ops = [], ctm = ctm0.slice(), tm = M_ID, tlm = M_ID, TL = 0, font = null, fsize = 1;
  const resDict = k => (res && doc.dict(res[k])) || {};
  const police = nom => polices[nom] || (polices[nom] = pdfFont(doc, resDict("Font")[nom]));
  const nums = a => a.map(x=>typeof x === "number" ? x : 0);
  const saut = (tx, ty) => { tlm = mmul([1,0,0,1,tx,ty], tlm); tm = tlm; };
  async function montre(items){
    if(!font) return;
    const dec = await police(font);
    let t = "";
    items.forEach(x=>{
      if(x instanceof PStr) t += dec(x.s);
      else if(typeof x === "number" && x < -250) t += " ";   // grand écart dans un TJ : une espace
    });
    const m = mmul(tm, ctm);
    out.txt.push({x:m[4], y:m[5], s:t, size:Math.abs(fsize) * (Math.hypot(m[0], m[1]) || 1)});
  }
  for(;;){
    const v = L.value();
    if(v === undefined) break;
    if(!(v instanceof POp)){ ops.push(v); continue; }
    const a = ops; ops = [];
    switch(v.o){
      case "q": pile.push(ctm); break;
      case "Q": ctm = pile.pop() || ctm; break;
      case "cm": if(a.length >= 6) ctm = mmul(nums(a.slice(-6)), ctm); break;
      case "BT": tm = tlm = M_ID; break;
      case "Tf": if(a[0] instanceof PNom){ font = a[0].n; fsize = +a[1] || 1; } break;
      case "TL": TL = +a[0] || 0; break;
      case "Td": saut(+a[0] || 0, +a[1] || 0); break;
      case "TD": TL = -(+a[1] || 0); saut(+a[0] || 0, +a[1] || 0); break;
      case "Tm": if(a.length >= 6){ tlm = nums(a.slice(-6)); tm = tlm; } break;
      case "T*": saut(0, -TL); break;
      case "Tj": await montre([a[0]]); break;
      case "'": saut(0, -TL); await montre([a[0]]); break;
      case '"': saut(0, -TL); await montre([a[2]]); break;
      case "TJ": if(Array.isArray(a[0])) await montre(a[0]); break;
      case "ID": {                                 // image en ligne : sauter ses octets
        const k = text.slice(L.pos).search(/\sEI(?=\s|$)/);
        L.pos = k < 0 ? text.length : L.pos + k + 3;
        break;
      }
      case "Do": {
        if(!(a[0] instanceof PNom)) break;
        const ref = resDict("XObject")[a[0].n], x = doc.dict(ref);
        if(!x) break;
        const sub = doc.get(x.Subtype);
        if(sub && sub.n === "Image"){
          const px = [[0,0],[1,0],[0,1],[1,1]].map(([u,w])=>ctm[0]*u + ctm[2]*w + ctm[4]);
          const py = [[0,0],[1,0],[0,1],[1,1]].map(([u,w])=>ctm[1]*u + ctm[3]*w + ctm[5]);
          out.imgs.push({ref, x0:Math.min(...px), x1:Math.max(...px), y0:Math.min(...py), y1:Math.max(...py),
                         w:doc.get(x.Width), h:doc.get(x.Height)});
        }else if(sub && sub.n === "Form" && depth < 4){
          const d = await doc.stream(ref);
          const fm = doc.get(x.Matrix);
          if(d) await pdfRun(doc, latin1(d.bytes), doc.dict(x.Resources) || res,
                             mmul(Array.isArray(fm) && fm.length === 6 ? nums(fm) : M_ID, ctm), out, depth+1);
        }
        break;
      }
    }
  }
}

/* Renvoie {titre, eleves:[{nom, blob, w, h, silhouette}]}, élèves dans l'ordre de lecture.
   Le titre est le premier texte en gros caractères (« Classe : … ») : il sert à
   signaler un trombinoscope qui ne correspond pas à la classe. */
async function readTrombiPdf(file){
  if(typeof DecompressionStream === "undefined")
    throw new Error("Ce navigateur ne sait pas lire les PDF. Mettez l'iPad à jour (iOS 16.4 ou plus).");
  const doc = pdfDoc(new Uint8Array(await file.arrayBuffer()));
  const lus = [];
  let titre = "";
  for(let p=0; p<doc.pages.length; p++){
    const out = {imgs:[], txt:[]};
    await pdfRun(doc, await doc.content(doc.pages[p].node), doc.pages[p].res, M_ID, out, 0);
    if(!titre){
      const t = out.txt.find(t=>t.size >= 13 && t.s.trim());
      if(t) titre = t.s.replace(/\s+/g, " ").trim();
    }
    const vues = out.imgs.filter(im=>im.x1 - im.x0 >= 15 && im.y1 - im.y0 >= 15);
    const lignes = vues.map(()=>[]);
    out.txt.forEach((t, k)=>{
      const s = t.s.replace(/\s+/g, " ").trim();
      if(!s) return;
      const centre = t.x + s.length * t.size * 0.26;   // largeur estimée : le nom est centré sous la photo
      let best = -1, bd = Infinity;
      vues.forEach((im, j)=>{
        const dy = im.y0 - t.y;                        // le texte est sous le bas de l'image
        if(dy <= 0 || dy > 50) return;
        const d = Math.abs(centre - (im.x0 + im.x1)/2);
        if(d < bd && d < Math.max(60, im.x1 - im.x0)){ bd = d; best = j; }
      });
      if(best >= 0) lignes[best].push({s, y:t.y, k});
    });
    vues.forEach((im, j)=>{
      const nom = lignes[j]
        .sort((a,b)=> b.y - a.y > 1.5 ? 1 : a.y - b.y > 1.5 ? -1 : a.k - b.k)
        .map(l=>l.s).join(" ");
      lus.push({page:p, x:im.x0, y:im.y1, ref:im.ref, w:im.w, h:im.h, nom});
    });
  }
  const data = {};
  for(const l of lus){
    const r = l.ref instanceof PRef ? l.ref.r : -1;
    if(!(r in data)) data[r] = await doc.stream(l.ref);
  }
  // une même image posée plusieurs fois, même objet ou mêmes octets : c'est la silhouette
  const cle = l => { const d = data[l.ref instanceof PRef ? l.ref.r : -1]; return d ? d.bytes.length + ":" + hash36(latin1(d.bytes)) : "?"; };
  const vus = {};
  lus.forEach(l=>{ l.cle = cle(l); vus[l.cle] = (vus[l.cle] || 0) + 1; });
  lus.sort((a,b)=> a.page - b.page || (Math.abs(a.y - b.y) > 5 ? b.y - a.y : a.x - b.x));
  const eleves = lus.filter(l=>l.nom).map(l=>{
    const d = data[l.ref instanceof PRef ? l.ref.r : -1];
    return {nom:l.nom, w:l.w, h:l.h, silhouette: vus[l.cle] > 1,
            blob: d && d.jpeg ? new Blob([d.bytes], {type:"image/jpeg"}) : null};
  });
  return {titre, eleves};
}

/* --- Métadonnées de l'entête École Directe --- */
function sniffClassName(grid, head){
  for(let i=0;i<head;i++){
    for(const c of (grid[i]||[])){
      const m = /classe\s*:\s*(.+)/i.exec(c||"");
      if(m) return m[1].trim();
    }
  }
  return "";
}
