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
