"use strict";
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const K_C="pvt.classes", K_S="pvt.session", K_H="pvt.history", K_B="pvt.backup", K_M="pvt.map";
const MATCH_WINDOW = 45000;

/* ============ Données ============ */
let classes = load(K_C, null);
if(!classes){
  const old = load("pvt.roster", null);
  classes = {};
  if(old){
    Object.keys(old).forEach(c=>{
      classes[c] = {names:String(old[c]).split("\n").map(x=>x.trim()).filter(Boolean), cfg:defaultCfg("formatif")};
    });
  }
  save(K_C, classes);
}
let history = load(K_H, []);
let sess = load(K_S, null);
let merged=null, scanner=null, curPoste="A", arb={}, adj={}, sumOrder=null;
let draft=null, grid=null, gridInfo=null, editing=null, drawGen=0;

const clsNames = () => Object.keys(classes);
const cfgOf = c => (classes[c] && classes[c].cfg) || defaultCfg("formatif");
const namesOf = c => (classes[c] && classes[c].names) || [];
const photosOf = c => (classes[c] && classes[c].photos) || {};
/* Vignette d'élève. Absente = case hachurée, pour que les colonnes restent alignées. */
function avatar(c, n, gr){
  const p = photosOf(c)[n], k = "ava" + (gr ? " gr" : "");
  return p ? `<img class="${k}" src="${esc(p)}" alt="">` : `<span class="${k} vide"></span>`;
}

/* ============ Onglets ============ */
$$(".tabs button[data-t]").forEach(b=>b.addEventListener("click",()=>{
  $$(".tabs button[data-t]").forEach(x=>x.classList.toggle("on",x===b));
  $$(".screen").forEach(x=>x.classList.remove("on"));
  $(b.dataset.t).classList.add("on");
  if(b.dataset.t==="#t-suivi") paintAnnual();
  if(b.dataset.t==="#t-classes") cstep("#c-list");
  window.scrollTo(0,0);
}));
function step(id){
  ["#step-start","#step-codes","#step-recv","#step-sum"].forEach(x=>$(x).style.display="none");
  $(id).style.display="block"; window.scrollTo(0,0);
}
function cstep(id){
  ["#c-list","#c-source","#c-map","#c-edit","#c-model","#c-cfg"].forEach(x=>$(x).style.display="none");
  $(id).style.display="block";
  if(id==="#c-list") paintClassList();
  window.scrollTo(0,0);
}
function goTab(sel){
  $$(".tabs button[data-t]").forEach(x=>x.classList.toggle("on", x.dataset.t===sel));
  $$(".screen").forEach(x=>x.classList.toggle("on", "#"+x.id===sel));
}

/* ============ Sélecteurs de classe ============ */
function fillClassSelects(){
  const opts = clsNames().map(c=>`<option>${esc(c)}</option>`).join("");
  ["#cls","#cls2"].forEach(sel=>{ const v=$(sel).value; $(sel).innerHTML=opts; if(v && classes[v]) $(sel).value=v; });
  fillObsSelects();
}
function roleCounts(c){
  const n={}; namesOf(c).forEach(x=>n[x]=0);
  history.filter(h=>h.cls===c).forEach(h=>{
    if(n[h.obsA]!==undefined) n[h.obsA]++;
    if(n[h.obsB]!==undefined) n[h.obsB]++;
  });
  return n;
}
function fillObsSelects(){
  drawGen++;                       // annule une animation de tirage en cours
  const c=$("#cls").value, l=namesOf(c), n=roleCounts(c);
  const o = l.map(x=>`<option value="${esc(x)}">${esc(x)}${n[x]?` — ${n[x]}×`:""}</option>`).join("");
  $("#obsA").innerHTML=o; $("#obsB").innerHTML=o;
  if(l.length>1) $("#obsB").selectedIndex=1;
  $("#open").disabled = l.length < 3;
  $("#draw-info").textContent="";
}
/* Tirage pondéré : le poids s'effondre avec le nombre de tours déjà faits,
   et un malus s'applique aux deux observateurs de la séance précédente. */
function drawObservers(c){
  const names=namesOf(c), cnt=roleCounts(c), cfg=cfgOf(c);
  const hs=history.filter(h=>h.cls===c);
  const last = hs.length ? [hs[hs.length-1].obsA, hs[hs.length-1].obsB] : [];
  const expo = cfg.tirage==="hasard" ? 3 : 6;
  const pen  = cfg.tirage==="hasard" ? 0.25 : 0.15;
  const pool=names.slice();
  const w=pool.map(n=>Math.pow(1/(1+(cnt[n]||0)), expo) * (last.includes(n)?pen:1));
  const out=[];
  for(let k=0;k<2 && pool.length;k++){
    const tot=w.reduce((a,b)=>a+b,0);
    let r=Math.random()*tot, i=0;
    for(;i<pool.length;i++){ r-=w[i]; if(r<=0) break; }
    if(i>=pool.length) i=pool.length-1;
    out.push(pool[i]); pool.splice(i,1); w.splice(i,1);
  }
  return out;
}
/* Le tirage est entièrement décidé avant que l'animation démarre : celle-ci
   ne fait que le révéler en ralentissant. Elle ne retire jamais au sort. */
function spinDraw(names, picked, done){
  const A=$("#obsA"), B=$("#obsB"), btn=$("#draw"), gen=drawGen;
  const direct = names.length < 4 ||
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches);
  if(direct){ A.value=picked[0]; B.value=picked[1]; done(); return; }
  const autre = ex => { let n; do{ n=names[Math.floor(Math.random()*names.length)]; }while(n===ex); return n; };
  btn.disabled=true;
  $("#open").disabled=true;        // pas d'ouverture sur un nom de passage
  $("#draw-info").textContent="Tirage en cours…";
  let delay=50, figeA=false;
  (function tick(){
    if(gen!==drawGen){ btn.disabled=false; return; }   // classe changée : fillObsSelects a repris la main
    if(!figeA) A.value=autre(B.value);
    B.value=autre(A.value);
    delay*=1.18;
    if(delay>140 && !figeA){ figeA=true; A.value=picked[0]; }
    if(delay>290){
      B.value=picked[1];
      btn.disabled=false; $("#open").disabled = names.length<3;
      done(); return;
    }
    setTimeout(tick, delay);
  })();
}
$("#draw").addEventListener("click",()=>{
  const c=$("#cls").value, d=drawObservers(c), cnt=roleCounts(c);
  if(d.length<2) return;
  spinDraw(namesOf(c), d, ()=>{
    const jamais=Object.values(cnt).filter(v=>!v).length;
    $("#draw-info").textContent =
      `${d[0]} (${cnt[d[0]]||0} fois) et ${d[1]} (${cnt[d[1]]||0} fois). ` +
      (jamais ? `${jamais} élève${jamais>1?"s n'ont":" n'a"} jamais observé.` : "Toute la classe est passée au moins une fois.");
  });
});
$("#cls").addEventListener("change", fillObsSelects);

/* ============ Liste des classes ============ */
function paintClassList(){
  const cs = clsNames();
  $("#clslist").innerHTML = cs.length
    ? cs.map(c=>{
        const n=namesOf(c).length, m=MODELES[cfgOf(c).modele]||MODELES.formatif;
        const nb=history.filter(h=>h.cls===c).length;
        return `<button class="r" data-c="${esc(c)}" style="width:100%;text-align:left">
          <span class="nm">${esc(c)}<br><span class="pill">${esc(m.nom)}</span></span>
          <span class="n dim">${n} él.</span><span class="n dim">${nb} séa.</span></button>`;
      }).join("")
    : `<div class="r none"><span class="nm">Aucune classe pour l'instant.</span></div>`;
  $$("#clslist .r[data-c]").forEach(b=>b.addEventListener("click",()=>openCfg(b.dataset.c)));
}
$("#c-new").addEventListener("click",()=>{ draft=null; editing=null; $("#c-err").textContent=""; cstep("#c-source"); });
["#c-cancel1","#c-cancel2","#c-cancel3","#c-cancel4"].forEach(id=>$(id).addEventListener("click",()=>cstep("#c-list")));

/* ============ Import de fichier ============ */
$("#c-file").addEventListener("change", async e=>{
  const f=e.target.files[0]; if(!f) return;
  $("#c-err").textContent="";
  try{
    grid = /\.(csv|tsv|txt)$/i.test(f.name) ? readCsvText(await f.text()) : await readXlsx(f);
    if(!grid.length) throw new Error("Le fichier est vide.");
    gridInfo = analyseGrid(grid);
    draft = {name: sniffClassName(grid, gridInfo.head) || f.name.replace(/\.[^.]+$/,"").replace(/[_]+/g," ").trim(), names:[]};
    paintMap();
    cstep("#c-map");
  }catch(err){ $("#c-err").textContent = err.message || "Fichier illisible."; }
  e.target.value="";
});
function paintMap(){
  const H=gridInfo.headers, saved=load(K_M,null);
  const opt=(sel,extra)=>H.map((h,i)=>`<option value="${i}"${i===sel?" selected":""}>${esc(h||("Colonne "+(i+1)))}</option>`).join("")+(extra||"");
  $("#m-name").innerHTML  = opt(gridInfo.guessName);
  $("#m-first").innerHTML = `<option value="-1"${gridInfo.guessFirst<0?" selected":""}>Aucune — nom et prénom réunis</option>` + opt(gridInfo.guessFirst);
  if(saved && saved.fmt) $("#m-fmt").value = saved.fmt;
  $("#c-map-sub").textContent = `${gridInfo.rows.length} lignes détectées, en-tête ligne ${gridInfo.head+1}.`;
  previewMap();
}
function previewMap(){
  const iN=+$("#m-name").value, iF=+$("#m-first").value, fmt=$("#m-fmt").value;
  const names = buildNames(gridInfo.rows, iN, iF, fmt);
  draft.names = names;
  $("#c-preview").innerHTML = names.length
    ? `<strong>${names.length} élèves</strong><p class="sub" style="margin:6px 0 0;font-size:14.5px">${names.slice(0,3).map(esc).join(" · ")}${names.length>3?" · …":""}</p>`
    : `<p class="err" style="margin:0">Aucun nom lisible avec ces colonnes.</p>`;
  $("#c-map-ok").disabled = !names.length;
}
["#m-name","#m-first","#m-fmt"].forEach(id=>$(id).addEventListener("change", previewMap));
$("#c-map-ok").addEventListener("click",()=>{
  save(K_M,{fmt:$("#m-fmt").value});
  $("#c-name").value = draft.name;
  $("#c-lst").value = draft.names.join("\n");
  $("#c-edit-h").textContent = "Vérifier la liste";
  cstep("#c-edit");
});

$("#cfg-edit-list").addEventListener("click",()=>{
  editing=cfgCls; draft={name:cfgCls, names:namesOf(cfgCls).slice()};
  $("#c-name").value=cfgCls; $("#c-lst").value=draft.names.join("\n");
  $("#c-edit-h").textContent="Modifier "+cfgCls;
  cstep("#c-edit");
});
$("#c-manual").addEventListener("click",()=>{
  editing=null; draft={name:"",names:[]};
  $("#c-name").value=""; $("#c-lst").value="";
  $("#c-edit-h").textContent="Nouvelle classe";
  cstep("#c-edit");
});
$("#c-edit-ok").addEventListener("click",()=>{
  const n=$("#c-name").value.trim();
  const l=$("#c-lst").value.split("\n").map(x=>x.trim()).filter(Boolean);
  if(!n){ alert("Donnez un nom à la classe."); return; }
  if(l.length<3){ alert("Il faut au moins trois élèves."); return; }
  if(editing){
    const old=editing, gone=namesOf(old).filter(x=>!l.includes(x));
    if(gone.length && !confirm(`${gone.length} élève(s) retiré(s) de la liste. Leurs séances déjà enregistrées sont conservées mais n'apparaîtront plus. Continuer ?`)) return;
    classes[old].names=l;
    if(n!==old){
      classes[n]=classes[old]; delete classes[old];
      history.forEach(h=>{ if(h.cls===old) h.cls=n; });
      save(K_H,history);
    }
    save(K_C,classes); fillClassSelects(); editing=null; openCfg(n); return;
  }
  draft={name:n, names:l};
  paintModels(); cstep("#c-model");
});

/* ============ Modèles ============ */
function paintModels(){
  $("#c-models").innerHTML = Object.keys(MODELES).map(k=>{
    const m=MODELES[k];
    return `<button class="card" data-m="${k}" style="width:100%;text-align:left;display:block">
      <strong>${esc(m.nom)}</strong>
      <p class="sub" style="margin:4px 0 0;font-size:14.5px">${esc(m.desc)}</p></button>`;
  }).join("");
  $$("#c-models .card").forEach(b=>b.addEventListener("click",()=>{
    if(classes[draft.name] && !confirm(`La classe « ${draft.name} » existe déjà. La remplacer ?`)) return;
    // remplacer la liste ne doit pas faire refaire le trombinoscope : photos et
    // compteur de vérifications restent, rattachés par nom
    const avant = classes[draft.name] || {};
    classes[draft.name]={names:draft.names, cfg:defaultCfg(b.dataset.m)};
    if(avant.photos) classes[draft.name].photos = avant.photos;
    if(avant.verif)  classes[draft.name].verif  = avant.verif;
    save(K_C,classes); fillClassSelects();
    openCfg(draft.name);
  }));
}

/* ============ Réglages d'une classe ============ */
let cfgCls=null, cfgWork=null;
function openCfg(c){
  cfgCls=c; cfgWork=JSON.parse(JSON.stringify(cfgOf(c)));
  $("#c-cfg-h").textContent=c;
  const nb=history.filter(h=>h.cls===c).length;
  $("#c-cfg-sub").textContent = `${namesOf(c).length} élèves · ${nb} séance${nb>1?"s":""} enregistrée${nb>1?"s":""}`;
  $("#cfg-cap").innerHTML = ["0","6","8","10","12","15"].map(v=>
    `<option value="${v}"${+v===cfgWork.cap?" selected":""}>${v==="0"?"Aucun plafond":v+" points"}</option>`).join("");
  $("#cfg-credit").innerHTML = ["0","3","4","5","6","8"].map(v=>
    `<option value="${v}"${+v===cfgWork.credit?" selected":""}>${v==="0"?"Aucun crédit":v+" points de base"}</option>`).join("");
  $("#cfg-solo").value=cfgWork.solo; $("#cfg-absent").value=cfgWork.absent;
  $("#cfg-tirage").value=cfgWork.tirage||"equite";
  $("#cfg-resti").value=cfgWork.resti; $("#cfg-obj").value=cfgWork.objectif;
  paintTypes(); toggleObj(); photoState();
  $("#cfg-photo-err").textContent="";
  cstep("#c-cfg");
}
function toggleObj(){ $("#cfg-obj-wrap").style.display = $("#cfg-resti").value==="none" ? "none" : "block"; }
$("#cfg-resti").addEventListener("change", toggleObj);
function paintTypes(){
  $("#cfg-types").innerHTML =
    `<div class="r head"><span class="nm">Type d'intervention</span><span class="n">Points</span><span class="n"></span></div>` +
    cfgWork.types.map((t,i)=>`
      <div class="r">
        <span class="nm"><input type="text" value="${esc(t.l)}" data-f="l" data-i="${i}" style="border:none;padding:0;background:none;font-weight:600"></span>
        <span class="n"><input type="text" inputmode="numeric" value="${t.w}" data-f="w" data-i="${i}" style="border:none;padding:0;background:none;text-align:right;width:40px"></span>
        <span class="n"><button data-del="${i}" style="color:var(--warn);font-weight:700">×</button></span>
      </div>`).join("");
  $$("#cfg-types input").forEach(inp=>inp.addEventListener("input",()=>{
    const t=cfgWork.types[+inp.dataset.i];
    if(inp.dataset.f==="w"){ const v=parseInt(inp.value,10); t.w = isNaN(v)?1:Math.max(1,Math.min(20,v)); }
    else t.l = inp.value;
  }));
  $$("#cfg-types button[data-del]").forEach(b=>b.addEventListener("click",()=>{
    if(cfgWork.types.length<=2){ alert("Il faut garder au moins deux types."); return; }
    cfgWork.types.splice(+b.dataset.del,1); paintTypes();
  }));
}
$("#cfg-addtype").addEventListener("click",()=>{
  if(cfgWork.types.length>=10){ alert("Dix types au maximum : au-delà, le relevé devient trop lent en classe."); return; }
  cfgWork.types.push({l:"Nouveau type", d:"", w:1}); paintTypes();
});
$("#cfg-save").addEventListener("click",()=>{
  cfgWork.cap=+$("#cfg-cap").value; cfgWork.solo=$("#cfg-solo").value;
  cfgWork.absent=$("#cfg-absent").value; cfgWork.credit=+$("#cfg-credit").value;
  cfgWork.tirage=$("#cfg-tirage").value;
  cfgWork.resti=$("#cfg-resti").value;
  cfgWork.objectif=Math.max(1, parseInt($("#cfg-obj").value,10)||12);
  cfgWork.types = cfgWork.types.filter(t=>t.l.trim());
  classes[cfgCls].cfg = cfgWork;
  save(K_C,classes); fillClassSelects(); cstep("#c-list");
});
/* ============ Photos de la classe ============
   Elles vivent dans classes[cls].photos, donc elles partent dans la sauvegarde
   et en reviennent. Vers les observateurs, elles ne voyagent qu'assemblées en
   planche et découpées en fragments QR, à l'ouverture d'une séance. */
const PHOTO_FMT = "participation-photos-v1";
const PHOTO_W = 96, PHOTO_H = 128;   // double de la cellule de planche : net sur écran Retina
let photoFor = null;                  // élève dont on remplace la photo
function photoState(){
  const ph = photosOf(cfgCls), noms = namesOf(cfgCls), n = Object.keys(ph).length;
  $("#cfg-photo-grid").innerHTML = noms.map((x,i)=>
    `<button data-p="${i}">${avatar(cfgCls,x)}<span class="nmp">${esc(x)}</span></button>`).join("");
  $$("#cfg-photo-grid button[data-p]").forEach(b=>b.addEventListener("click",()=>{
    photoFor = noms[+b.dataset.p]; $("#cfg-photo-one").click();
  }));
  if(!n){ $("#cfg-photo-etat").textContent = "Aucune photo pour cette classe."; return; }
  const avec = noms.filter(x=>ph[x]).length;
  const orph = Object.keys(ph).filter(x=>!noms.includes(x));
  $("#cfg-photo-etat").innerHTML =
    `<strong>${avec} élève${avec>1?"s":""} sur ${noms.length}</strong> avec photo.` +
    (avec<noms.length ? `<br>${noms.length-avec} sans photo.` : "") +
    (orph.length ? `<br>${orph.length} photo${orph.length>1?"s":""} non rattachée${orph.length>1?"s":""} : ${orph.map(esc).join(", ")}.` : "");
}
/* Réduit une image au format vignette 3:4, recadrée au centre, un peu vers le haut
   pour ne pas couper le front. Quelques Ko par élève au lieu de plusieurs Mo. */
function shrinkPhoto(file){
  return new Promise((res, rej)=>{
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = ()=>{
      const cv = document.createElement("canvas"); cv.width = PHOTO_W; cv.height = PHOTO_H;
      const r = Math.max(PHOTO_W/im.naturalWidth, PHOTO_H/im.naturalHeight);
      const w = im.naturalWidth*r, h = im.naturalHeight*r;
      const cx = cv.getContext("2d");
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, PHOTO_W, PHOTO_H);
      cx.drawImage(im, (PHOTO_W-w)/2, (PHOTO_H-h)*0.3, w, h);
      URL.revokeObjectURL(url);
      res(cv.toDataURL("image/jpeg", 0.72));
    };
    im.onerror = ()=>{ URL.revokeObjectURL(url); rej(new Error(`Image illisible : ${file.name || "photo"}`)); };
    im.src = url;
  });
}
/* Enregistre les photos modifiées, ou remet les anciennes si le stockage est plein. */
function storePhotos(ph){
  const avant = classes[cfgCls].photos;
  classes[cfgCls].photos = ph;
  if(save(K_C, classes)) return true;
  if(avant) classes[cfgCls].photos = avant; else delete classes[cfgCls].photos;
  return false;
}
/* ---- Rapprochement approché d'un texte lu et d'un nom de la liste ----
   Sans accents ni casse, mots dans n'importe quel ordre, et tolérant aux
   caractères manquants ou mal lus : « B RANGER lise » ressemble encore à
   « Élise Béranger ». Deux mesures, on garde la meilleure :
   - mot à mot : chaque mot de l'un rapproché du mot le plus proche de l'autre
     (distance d'édition), pondéré par la longueur ; une initiale (« Marie D. »)
     vaut un mot entier si elle en est la première lettre ;
   - nom collé : les lettres mises bout à bout, dans tous les ordres des mots,
     pour le cas où un caractère illisible a coupé un mot en deux.
   Le score va de 0 à 1. */
const SEUIL_PROPOSE = 0.6, SEUIL_SUR = 0.85, MARGE_SUR = 0.08;
const mots = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase()
  .split(/[^a-z0-9]+/).filter(Boolean);
function lev(a, b){
  if(a === b) return 0;
  let prev = Array.from({length:b.length+1}, (_,j)=>j);
  for(let i=1; i<=a.length; i++){
    const cur = [i];
    for(let j=1; j<=b.length; j++)
      cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1]===b[j-1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function tokSim(x, y){
  if(x === y) return 1;
  const [c, l] = x.length < y.length ? [x, y] : [y, x];
  if(c.length === 1) return l[0] === c ? 1 : 0;
  return Math.max(0, 1 - lev(x, y)/l.length);
}
function permutations(t){
  if(t.length <= 1 || t.length > 4) return [t];
  return t.flatMap((x,i)=>permutations([...t.slice(0,i), ...t.slice(i+1)]).map(p=>[x, ...p]));
}
function nameScore(txt, nom){
  const A = mots(txt), B = mots(nom);
  if(!A.length || !B.length) return 0;
  const couvre = (X, Y) => {
    let s = 0, w = 0;
    X.forEach(x=>{ s += Math.max(...Y.map(y=>tokSim(x, y))) * x.length; w += x.length; });
    return s / w;
  };
  const parMots = 0.6*couvre(B, A) + 0.4*couvre(A, B);
  const ja = A.join("");
  let colle = 0;
  for(const p of permutations(B)){
    const jb = p.join("");
    colle = Math.max(colle, 1 - lev(ja, jb)/Math.max(ja.length, jb.length));
  }
  return Math.max(parMots, colle);
}
/* Attribution de toute une série de textes : les meilleures ressemblances
   d'abord, chaque élève au plus une fois. Un rattachement est « sûr » s'il est
   net et qu'aucun autre élève, ni aucun autre texte, n'en est presque aussi proche. */
function assignNames(textes, noms){
  const S = textes.map(t=>noms.map(n=>nameScore(t, n)));
  const paires = [];
  S.forEach((r,i)=>r.forEach((s,j)=>{ if(s >= SEUIL_PROPOSE) paires.push([s,i,j]); }));
  paires.sort((a,b)=>b[0]-a[0]);
  const res = textes.map(()=>null), pris = new Set();
  paires.forEach(([s,i,j])=>{
    if(res[i] || pris.has(j)) return;
    pris.add(j);
    const autreEleve = Math.max(0, ...S[i].filter((_,k)=>k!==j));
    const autreTexte = Math.max(0, ...S.map((r,k)=>k!==i ? r[j] : 0));
    res[i] = {eleve:noms[j], score:s,
              sur: s >= SEUIL_SUR && s - autreEleve >= MARGE_SUR && s - autreTexte >= MARGE_SUR};
  });
  return res;
}
/* Pour des fichiers isolés, sans écran de vérification : seulement les rattachements sûrs. */
const matchFile = (fname, noms) => matchName(fname.replace(/\.[^.]+$/,""), noms);
function matchName(txt, noms){
  const r = assignNames([txt], noms)[0];
  return r && r.sur ? r.eleve : null;
}
$("#cfg-photo-one").addEventListener("change", async e=>{
  const f = e.target.files[0], nom = photoFor; e.target.value = ""; photoFor = null;
  if(!f || !nom) return;
  $("#cfg-photo-err").textContent = "";
  try{
    const ph = {...photosOf(cfgCls), [nom]: await shrinkPhoto(f)};
    if(!storePhotos(ph)) throw new Error("Stockage saturé : la photo n'a pas pu être enregistrée.");
    photoState();
  }catch(err){ $("#cfg-photo-err").textContent = err.message || "Image illisible."; }
});
$("#cfg-photo-imgs").addEventListener("change", async e=>{
  const files = Array.from(e.target.files); e.target.value = "";
  if(!files.length) return;
  $("#cfg-photo-err").textContent = "";
  const pdf = files.find(f=>f.type==="application/pdf" || /\.pdf$/i.test(f.name));
  if(pdf){ openTrombi(pdf); return; }
  const noms = namesOf(cfgCls), ph = {...photosOf(cfgCls)}, rates = [];
  let pris = 0;
  for(const f of files){
    const nom = matchFile(f.name, noms);
    if(!nom){ rates.push(f.name); continue; }
    try{ ph[nom] = await shrinkPhoto(f); pris++; }catch(err){ rates.push(f.name); }
  }
  if(pris && !storePhotos(ph)){ $("#cfg-photo-err").textContent = "Stockage saturé : les photos n'ont pas pu être enregistrées."; return; }
  photoState();
  if(rates.length) $("#cfg-photo-err").textContent =
    `${pris} photo${pris>1?"s":""} ajoutée${pris>1?"s":""}. Non rattaché${rates.length>1?"s":""} à un élève : ${rates.join(", ")}. ` +
    `Renommez ces fichiers comme dans la liste, ou touchez l'élève ci-dessus pour choisir sa photo.`;
});
/* ---- Trombinoscope PDF d'École Directe ----
   La lecture propose un rattachement, le professeur le vérifie avant que rien
   ne soit enregistré. Les silhouettes des élèves sans photo sont écartées. */
let trombi = null;
const blobUrl = b => new Promise((res, rej)=>{
  const r = new FileReader(); r.onload = ()=>res(r.result); r.onerror = rej; r.readAsDataURL(b);
});
async function openTrombi(file){
  $("#cfg-photo-err").textContent = "Lecture du trombinoscope…";
  try{
    const {titre, eleves:lus} = await readTrombiPdf(file);
    if(!lus.length) throw new Error("Aucune photo avec un nom trouvée dans ce PDF.");
    const noms = namesOf(cfgCls);
    // tous les noms du PDF entrent dans l'attribution, silhouettes comprises :
    // sinon un élève sans photo pourrait se voir attribuer la photo d'un homonyme
    const att = assignNames(lus.map(l=>l.nom), noms);
    const trouves = att.filter(Boolean).length;
    trombi = {photos:[], sans:[], titre,
              horsListe: lus.filter((l,i)=>!att[i]).map(l=>l.nom),
              absentsPdf: noms.filter(n=>!att.some(a=>a && a.eleve===n)),
              total: lus.length, trouves,
              // moins d'un nom sur deux reconnu : ce n'est vraisemblablement pas cette classe
              autreClasse: trouves < lus.length/2};
    for(let i=0; i<lus.length; i++){
      const l = lus[i], a = att[i];
      let src = null;
      if(!l.silhouette && l.blob){
        try{ src = (l.w===PHOTO_W && l.h===PHOTO_H) ? await blobUrl(l.blob) : await shrinkPhoto(l.blob); }catch(err){}
      }
      if(!src){ trombi.sans.push(a ? a.eleve : l.nom); continue; }
      trombi.photos.push({nom:l.nom, src, eleve: a ? a.eleve : null, score: a ? a.score : 0,
                          aVerifier: !!a && !a.sur});
    }
    if(!trombi.photos.length) throw new Error("Ce PDF ne contient que des silhouettes : aucune vraie photo à importer.");
    $("#cfg-photo-err").textContent = "";
    paintTrombi();
    $("#trombi").classList.add("on"); window.scrollTo(0,0);
  }catch(err){ $("#cfg-photo-err").textContent = err.message || "PDF illisible."; }
}
function paintTrombi(){
  const noms = namesOf(cfgCls), P = trombi.photos, T = trombi;
  const sur = P.filter(p=>p.eleve && !p.aVerifier).length, douteux = P.filter(p=>p.aVerifier).length;
  $("#trombi-sub").textContent = `${cfgCls} · ${P.length} photo${P.length>1?"s":""} lue${P.length>1?"s":""} · ` +
    `${sur} rattachée${sur>1?"s":""} avec certitude` + (douteux ? ` · ${douteux} à vérifier` : "");
  const liste = a => a.map(esc).join(", ");
  $("#trombi-alerte").innerHTML = T.autreClasse
    ? `<div class="warnbox"><strong>Ce trombinoscope ne semble pas être celui de « ${esc(cfgCls)} ».</strong>
        Seul${T.trouves>1?"s":""} ${T.trouves} nom${T.trouves>1?"s":""} du PDF sur ${T.total} ressemble${T.trouves>1?"nt":""} à un élève de la liste.
        ${T.titre ? `Le PDF porte le titre « ${esc(T.titre)} ».` : ""}
        Vérifiez la classe choisie avant d'enregistrer.</div>`
    : (T.horsListe.length || T.absentsPdf.length)
      ? `<div class="warnbox">` +
        (T.horsListe.length ? `<strong>Dans le PDF, introuvable${T.horsListe.length>1?"s":""} dans votre liste :</strong> ${liste(T.horsListe)}.<br>` : "") +
        (T.absentsPdf.length ? `<strong>Dans votre liste, absent${T.absentsPdf.length>1?"s":""} du PDF :</strong> ${liste(T.absentsPdf)}.` : "") +
        `</div>`
      : "";
  const etat = p => !p.eleve ? "var(--warn)" : p.aVerifier ? "var(--amber)" : "";
  $("#trombi-tbl").innerHTML = P.map((p,k)=>`<div class="r">
      <img class="ava" src="${esc(p.src)}" alt="">
      <span class="nm" style="white-space:normal;display:flex;flex-direction:column;gap:4px">
        <span class="sub" style="margin:0;font-size:13px;font-weight:500">Lu dans le PDF : ${esc(p.nom)}
          <span data-v="${k}" class="pill" style="color:var(--amber);${p.aVerifier?"":"display:none"}">à vérifier · ressemblance ${Math.round(p.score*100)} %</span></span>
        <select data-t="${k}" style="padding:8px 10px;border-color:${etat(p)}">
          <option value="">— Ne pas utiliser —</option>
          ${noms.map(n=>`<option${n===p.eleve?" selected":""}>${esc(n)}</option>`).join("")}
        </select></span></div>`).join("");
  $$("#trombi-tbl select").forEach(s=>s.addEventListener("change",()=>{
    const p = P[+s.dataset.t];
    p.eleve = s.value || null;
    p.aVerifier = false;                         // choisi à la main : c'est tranché
    s.style.borderColor = etat(p);
    $(`#trombi-tbl [data-v="${s.dataset.t}"]`).style.display = "none";
    checkTrombi();
  }));
  checkTrombi();
}
function checkTrombi(){
  const noms = namesOf(cfgCls), P = trombi.photos, ph = photosOf(cfgCls);
  const choisis = P.map(p=>p.eleve).filter(Boolean);
  const doubles = [...new Set(choisis.filter((n,i)=>choisis.indexOf(n)!==i))];
  const reste = noms.filter(n=>!choisis.includes(n) && !ph[n]);
  $("#trombi-sans").innerHTML =
    (trombi.sans.length ? `Sans photo dans École Directe : ${trombi.sans.map(esc).join(", ")}.<br>` : "") +
    (reste.length ? `<strong>Toujours sans photo après cet import : ${reste.map(esc).join(", ")}.</strong>` : "Tous les élèves auront une photo.");
  $("#trombi-err").textContent = doubles.length ? `Choisi pour deux photos : ${doubles.join(", ")}.` : "";
  $("#trombi-ok").disabled = !!doubles.length || !choisis.length;
}
$("#trombi-ok").addEventListener("click",()=>{
  const reste = trombi.photos.filter(p=>p.eleve && p.aVerifier).length;
  if(trombi.autreClasse && !confirm(`Ce trombinoscope ne semble pas être celui de « ${cfgCls} ». Enregistrer quand même ?`)) return;
  if(reste && !confirm(`${reste} rattachement${reste>1?"s":""} marqué${reste>1?"s":""} « à vérifier » n'${reste>1?"ont":"a"} pas été confirmé${reste>1?"s":""}. Enregistrer quand même ?`)) return;
  const ph = {...photosOf(cfgCls)};
  let n = 0;
  trombi.photos.forEach(p=>{ if(p.eleve){ ph[p.eleve] = p.src; n++; } });
  if(!storePhotos(ph)){ $("#trombi-err").textContent = "Stockage saturé : les photos n'ont pas pu être enregistrées."; return; }
  trombi = null;
  $("#trombi").classList.remove("on");
  photoState();
  $("#cfg-photo-err").textContent = `${n} photo${n>1?"s":""} enregistrée${n>1?"s":""}.`;
});
$("#trombi-close").addEventListener("click",()=>{ trombi = null; $("#trombi").classList.remove("on"); });

$("#cfg-photo-file").addEventListener("change", async e=>{
  const f = e.target.files[0]; if(!f) return;
  $("#cfg-photo-err").textContent = "";
  try{
    const d = JSON.parse(await f.text());
    if(d.format !== PHOTO_FMT || !d.photos) throw new Error("Ce fichier n'est pas un fichier photos de cette application.");
    const noms = namesOf(cfgCls), ph = {};
    let pris = 0;
    Object.keys(d.photos).forEach(k=>{
      const v = d.photos[k];
      // on n'accepte que des images en ligne : jamais une URL distante ni un javascript:
      if(typeof v !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return;
      ph[k] = v; if(noms.includes(k)) pris++;
    });
    if(!pris) throw new Error(`Aucun nom de ce fichier ne correspond aux élèves de « ${cfgCls} ».`);
    if(!storePhotos(ph)) throw new Error("Stockage saturé : les photos n'ont pas pu être enregistrées.");
    photoState(); paintClassList();
  }catch(err){ $("#cfg-photo-err").textContent = err.message || "Fichier illisible."; }
  e.target.value = "";
});
$("#cfg-photo-exp").addEventListener("click",()=>{
  const ph = photosOf(cfgCls);
  if(!Object.keys(ph).length){ $("#cfg-photo-err").textContent = "Aucune photo à exporter."; return; }
  const txt = JSON.stringify({format:PHOTO_FMT, classe:cfgCls, cree:new Date().toISOString(), photos:ph});
  const url = URL.createObjectURL(new Blob([txt],{type:"application/json"}));
  const a = document.createElement("a"); a.href = url;
  a.download = `participation-photos-${cfgCls.replace(/[^\p{L}\p{N}]+/gu,"-")}-${today()}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
});
$("#cfg-photo-del").addEventListener("click",()=>{
  if(!Object.keys(photosOf(cfgCls)).length) return;
  if(!confirm(`Retirer les photos de « ${cfgCls} » ? Le fichier photos exporté permet de les remettre.`)) return;
  delete classes[cfgCls].photos; save(K_C, classes); photoState(); paintClassList();
});

$("#cfg-back").addEventListener("click",()=>cstep("#c-list"));
$("#cfg-del").addEventListener("click",()=>{
  const nb=history.filter(h=>h.cls===cfgCls).length;
  if(!confirm(`Supprimer « ${cfgCls} »${nb?` et ses ${nb} séances enregistrées`:""} ? Cette action est définitive.`)) return;
  delete classes[cfgCls];
  history = history.filter(h=>h.cls!==cfgCls);
  save(K_C,classes); save(K_H,history); fillClassSelects(); cstep("#c-list");
});

/* ============ Séance ============ */
/* Planche de photos : une seule image JPEG, cellules de 48x64, sept par ligne,
   dans l'ordre exact de la liste. L'observateur n'a besoin que de l'indice. */
const CELL_W = 48, CELL_H = 64, CELL_COLS = 7;
function buildSheet(cls, names){
  const ph = photosOf(cls);
  if(!names.some(n=>ph[n])) return Promise.resolve(null);
  const rows = Math.ceil(names.length / CELL_COLS);
  const cv = document.createElement("canvas");
  cv.width = CELL_COLS*CELL_W; cv.height = rows*CELL_H;
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0,0,cv.width,cv.height);
  return Promise.all(names.map((n,i)=>new Promise(res=>{
    const src = ph[n]; if(!src) return res();
    const im = new Image();
    im.onload = ()=>{ cx.drawImage(im, (i%CELL_COLS)*CELL_W, Math.floor(i/CELL_COLS)*CELL_H, CELL_W, CELL_H); res(); };
    im.onerror = res;
    im.src = src;
  }))).then(()=>cv.toDataURL("image/jpeg", 0.55));
}
$("#open").addEventListener("click", async ()=>{
  const cls=$("#cls").value;
  if($("#obsA").value===$("#obsB").value){ alert("Les deux observateurs doivent être deux élèves différents."); return; }
  const cfg=cfgOf(cls);
  const btn=$("#open"); btn.disabled=true; btn.textContent="Préparation…";
  let sheet=null;
  try{ sheet = await buildSheet(cls, namesOf(cls)); }catch(e){ sheet=null; }
  btn.disabled=false; btn.textContent="Ouvrir la séance";
  sess={cls, date:today(), names:namesOf(cls).slice(), cap:cfg.cap, types:cfg.types.map(t=>({...t})),
        sheet, pack: sheet ? hash36(sheet) : "",
        A:{token:token6(), obs:$("#obsA").value, rep:null},
        B:{token:token6(), obs:$("#obsB").value, rep:null}};
  if(!save(K_S,sess)){ alert("Stockage saturé : la séance n'a pas pu être ouverte."); return; }
  showCodes();
});
function payloadFor(p){
  return encSession({token:sess[p].token, poste:p, cls:sess.cls, date:sess.date,
                     cap:sess.cap, types:sess.types, pack:sess.pack, names:sess.names});
}

/* ---- Émission de la planche : les fragments défilent en boucle, les deux
   observateurs visent l'écran en même temps et les ramassent au passage. ---- */
let psendTimer=null;
function openPhotoSend(){
  if(!sess || !sess.sheet) return;
  const b64 = sess.sheet.slice(sess.sheet.indexOf(",")+1);
  const txts = encPhotoFrames(sess.pack, b64);
  $("#psend-lbl").textContent = `Photos de ${sess.cls}`;
  $("#psend-info").textContent = `Préparation des ${txts.length} fragments…`;
  $("#psend-qr").innerHTML = "";
  $("#psend").classList.add("on");
  setTimeout(()=>{
    let type = 0;                       // même version pour tous : longueur identique
    for(let t=4; t<=40 && !type; t++){
      try{ const q=qrcode(t,"L"); q.addData(txts[0]); q.make(); type=t; }catch(e){}
    }
    if(!type){ $("#psend-info").textContent = "Fragment trop volumineux pour un QR code."; return; }
    const svgs = txts.map(t=>{
      const q=qrcode(type,"L"); q.addData(t); q.make();
      const cell=Math.max(2, Math.floor(520/q.getModuleCount()));
      return q.createSvgTag({cellSize:cell, margin:cell*2, scalable:false});
    });
    let k=0;
    const tick=()=>{
      $("#psend-qr").innerHTML = svgs[k];
      const svg=$("#psend-qr").querySelector("svg");
      if(svg){ svg.style.width="100%"; svg.style.height="auto"; svg.style.display="block"; }
      $("#psend-info").textContent =
        `Fragment ${k+1} sur ${svgs.length} · les deux observateurs visent l'écran jusqu'à ce que leur barre soit pleine`;
      k=(k+1)%svgs.length;
    };
    tick(); psendTimer=setInterval(tick, 250);
  }, 30);
}
function closePhotoSend(){
  clearInterval(psendTimer); psendTimer=null;
  $("#psend-qr").innerHTML="";
  $("#psend").classList.remove("on");
}
$("#send-photos").addEventListener("click", openPhotoSend);
$("#psend-close").addEventListener("click", closePhotoSend);
function showCodes(){
  $("#codes-sub").textContent=`${sess.cls} · ${frDate(sess.date)}`;
  const cnt=roleCounts(sess.cls);
  $("#duo").innerHTML=["A","B"].map(p=>`
    <div class="one">
      <div class="hd">${avatar(sess.cls,sess[p].obs)}<span class="poste">Poste ${p}</span>
        <span class="nmx">${esc(sess[p].obs)}</span></div>
      <div class="qrbox" id="qr-${p}"></div>
      <p class="sub" style="margin:6px 0 0;font-size:13px">${(cnt[sess[p].obs]||0)} passage${(cnt[sess[p].obs]||0)>1?"s":""} avant aujourd'hui</p>
    </div>`).join("");
  ["A","B"].forEach(p=>{
    const t=payloadFor(p);
    drawQR($("#qr-"+p), t, 520);
    $("#raw-"+p).value=t;
    $("#qr-"+p).addEventListener("click",()=>{
      $("#zoom-lbl").textContent=`Poste ${p} — ${sess[p].obs}`;
      drawQR($("#zoom-qr"), t, 900);
      $("#zoom").classList.add("on");
    });
  });
  $("#send-photos").style.display = sess.pack ? "block" : "none";
  $("#no-photos").style.display = sess.pack ? "none" : "block";
  step("#step-codes");
}
$("#zoom-close").addEventListener("click",()=>$("#zoom").classList.remove("on"));
$("#redraw").addEventListener("click",()=>{
  const d=drawObservers(sess.cls);
  if(d.length<2) return;
  sess.A.obs=d[0]; sess.B.obs=d[1];
  sess.A.token=token6(); sess.B.token=token6();
  save(K_S,sess); showCodes();
});
$("#cancel-sess").addEventListener("click",()=>{
  if(!confirm("Annuler cette séance ?")) return;
  sess=null; localStorage.removeItem(K_S); step("#step-start");
});
$("#to-recv").addEventListener("click", ()=>{ closePhotoSend(); showRecv(); });
$("#back-codes").addEventListener("click",()=>{ if(scanner) scanner.stop(); showCodes(); });

function showRecv(){ refreshRecv(); step("#step-recv"); }
function refreshRecv(){
  const a=!!sess.A.rep, b=!!sess.B.rep;
  $("#recv-sub").innerHTML=`${esc(sess.cls)} · ${frDate(sess.date)}<br>`+
    `<span class="pill ${a?"ok":""}">Poste A ${a?"reçu":"en attente"}</span> `+
    `<span class="pill ${b?"ok":""}">Poste B ${b?"reçu":"en attente"}</span>`;
  $("#to-sum").disabled=!(a||b);
  $("#to-sum").textContent=(a&&b)?"Voir la synthèse":"Voir la synthèse (un seul relevé)";
}
function takeReport(txt){
  let r; try{ r=decReport(txt); }catch(e){ $("#recv-err").textContent=e.message; return false; }
  const p=(r.token===sess.A.token)?"A":(r.token===sess.B.token)?"B":null;
  if(!p){ $("#recv-err").textContent="Ce relevé ne correspond à aucun code émis pour cette séance."; return false; }
  if(sess[p].rep){ $("#recv-err").textContent=`Le relevé du poste ${p} a déjà été reçu.`; return false; }
  sess[p].rep=r; save(K_S,sess); $("#recv-err").textContent=""; refreshRecv(); return true;
}
scanner=makeScanner($("#vid"),$("#cnv"),t=>{
  takeReport(t);
  if(!(sess.A.rep&&sess.B.rep)) scanner.start();
  else $("#scan-go").textContent="Les deux relevés sont reçus";
}, m=>{ $("#recv-err").textContent=m; });
$("#scan-go").addEventListener("click",()=>{ $("#recv-err").textContent=""; scanner.start(); $("#scan-go").textContent="Recherche du QR code…"; });
$("#paste-go").addEventListener("click",()=>{ if(takeReport($("#paste-r").value)) $("#paste-r").value=""; });

/* ============ Roue de vérification des prises de notes ============
   Accessible à tout moment depuis la barre du haut, avec partout la même règle :
   les observateurs et les absents connus sont hors du tirage — les premiers ont
   déjà travaillé, les seconds ne sont pas là. Ce qui change selon le moment,
   c'est seulement ce qu'on sait déjà :
   - séance ouverte : ses observateurs, et les absents des relevés déjà reçus ;
   - séance de la classe choisie validée aujourd'hui : ses observateurs et absents ;
   - sinon : toute la classe. */
let wheelRot = 0, wheelTimer = null, wheelCls = null, wheelCands = [];
function verifCounts(c){ return (classes[c] && classes[c].verif) || {}; }
function wheelContext(){
  if(sess){
    const abs = new Set();
    ["A","B"].forEach(p=>{ if(sess[p].rep) (sess[p].rep.abs||[]).forEach(i=>abs.add(i)); });
    return {cls:sess.cls, names:sess.names, obs:[sess.A.obs, sess.B.obs], abs, src:"séance en cours"};
  }
  const cls = $("#cls").value;
  if(!cls || !classes[cls]) return null;
  const hs = history.filter(h=>h.cls===cls), h = hs[hs.length-1];
  if(h && h.date===today())
    return {cls, names:h.names, obs:[h.obsA, h.obsB], abs:new Set(h.abs||[]), src:"séance validée aujourd'hui"};
  return {cls, names:namesOf(cls), obs:[], abs:new Set(), src:null};
}
/* Comme pour les observateurs : celui qu'on a le moins vérifié passe devant. */
function pickVerif(cands){
  const v = verifCounts(wheelCls);
  const w = cands.map(o=>Math.pow(1/(1+(v[o.n]||0)), 3));
  const tot = w.reduce((a,b)=>a+b,0);
  let r = Math.random()*tot, i = 0;
  for(; i<cands.length; i++){ r -= w[i]; if(r<=0) break; }
  return Math.min(i, cands.length-1);
}
function wheelSvg(cands){
  const N = cands.length, R = 150, cx = 160, cy = 160;
  const teintes = ["#D6E8E6","#EFF3F3","#C8DEDB","#F7FAFA"];
  const petit = N > 15;
  let out = `<svg viewBox="0 0 320 320" style="width:100%;height:auto;display:block">`;
  cands.forEach((o,k)=>{
    const a0 = (k/N)*2*Math.PI - Math.PI/2, a1 = ((k+1)/N)*2*Math.PI - Math.PI/2;
    const x0 = cx+R*Math.cos(a0), y0 = cy+R*Math.sin(a0);
    const x1 = cx+R*Math.cos(a1), y1 = cy+R*Math.sin(a1);
    const grand = (a1-a0) > Math.PI ? 1 : 0;
    out += `<path d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${grand},1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${teintes[k%4]}" stroke="#fff" stroke-width="1.5"/>`;
    const am = (a0+a1)/2, tr = R*0.63;
    const tx = cx+tr*Math.cos(am), ty = cy+tr*Math.sin(am);
    out += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${(am*180/Math.PI).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" font-size="${petit?9.5:12}" font-weight="600" fill="#15242B" text-anchor="middle" dominant-baseline="middle">${esc(o.n)}</text>`;
  });
  out += `<circle cx="${cx}" cy="${cy}" r="15" fill="#fff" stroke="#C7D1D4" stroke-width="1.5"/></svg>`;
  return out;
}
const calme = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches);
function openWheel(){
  const ctx = wheelContext();
  if(!ctx){ alert("Créez d'abord une classe."); return; }
  // les candidats sont figés à l'ouverture : un relevé reçu entre-temps ne doit
  // pas décaler les parts sous l'aiguille
  wheelCls = ctx.cls;
  wheelCands = ctx.names.map((n,i)=>({n,i})).filter(o=>!ctx.obs.includes(o.n) && !ctx.abs.has(o.i));
  if(!wheelCands.length){ alert("Personne à vérifier : tous les élèves sont observateurs ou absents."); return; }
  const ecart = [];
  if(ctx.obs.length) ecart.push("observateurs");
  if(ctx.abs.size) ecart.push(`${ctx.abs.size} absent${ctx.abs.size>1?"s":""}`);
  wheelRot = 0;
  $("#wheel-lbl").textContent = `Vérification des prises de notes · ${ctx.cls}`;
  $("#wheel-disc").className = "disc";
  $("#wheel-disc").style.transform = "rotate(0deg)";
  $("#wheel-disc").innerHTML = wheelSvg(wheelCands);
  $("#wheel-res").innerHTML = `<p class="sub" style="margin:0">${wheelCands.length} élève${wheelCands.length>1?"s":""} dans la roue` +
    (ecart.length ? ` · ${ecart.join(" et ")} écartés (${ctx.src})` : " · toute la classe, aucune séance en cours") + `</p>`;
  $("#wheel-go").disabled = false;
  $("#wheel-go").textContent = "Tourner";
  $("#wheel").classList.add("on");
}
function spinWheel(){
  const cands = wheelCands;
  if(!cands.length) return;
  const k = pickVerif(cands);                 // décidé avant de tourner
  const N = cands.length;
  const disc = $("#wheel-disc");
  const doux = !calme();
  $("#wheel-go").disabled = true;
  $("#wheel-go").textContent = "…";
  $("#wheel-res").innerHTML = "";
  wheelRot += (doux ? 360*4 : 0) + (360 - ((wheelRot + (k+0.5)*360/N) % 360));
  disc.className = "disc" + (doux ? " tourne" : "");
  disc.style.transform = `rotate(${wheelRot}deg)`;
  fireworks(3300);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(()=>revealWheel(cands[k].n), doux ? 3500 : 0);
}
function revealWheel(nom){
  const v = verifCounts(wheelCls), deja = v[nom] || 0;
  $("#wheel-res").innerHTML =
    `${avatar(wheelCls, nom, true)}<div class="qui">${esc(nom)}</div>` +
    `<p class="sub" style="margin:0;font-size:14px">${deja ? `déjà vérifié ${deja} fois cette année` : "jamais vérifié cette année"}</p>`;
  if(!classes[wheelCls].verif) classes[wheelCls].verif = {};
  classes[wheelCls].verif[nom] = deja + 1;
  save(K_C, classes);
  fxBouquet();
  $("#wheel-go").disabled = false;
  $("#wheel-go").textContent = "Tourner à nouveau";
}
function closeWheel(){ clearTimeout(wheelTimer); fxStop(); $("#wheel").classList.remove("on"); }

/* ---- Feu d'artifice pendant que la roue tourne ----
   Purement décoratif, dessiné sur un canevas transparent posé par-dessus la roue,
   qui laisse passer le toucher. Rien du tout si l'iPad demande moins d'animations. */
const FX_COUL = ["#F2B705","#0E9F94","#E4572E","#7B61FF","#2E86DE","#E84393","#43B929"];
const FX_G = 0.12;                              // gravité, en px par image²
let fxParts = [], fxRaf = 0, fxLast = 0, fxUntil = 0, fxNext = 0;
const fxCoul = () => FX_COUL[Math.floor(Math.random()*FX_COUL.length)];
function fxCanvas(){
  const cv = $("#wheel-fx"), d = window.devicePixelRatio || 1, w = innerWidth, h = innerHeight;
  if(cv.width !== Math.round(w*d) || cv.height !== Math.round(h*d)){ cv.width = Math.round(w*d); cv.height = Math.round(h*d); }
  const cx = cv.getContext("2d"); cx.setTransform(d,0,0,d,0,0);
  return {cx, w, h};
}
function fxRocket(w, h){
  const monte = h*(0.35 + 0.35*Math.random());  // hauteur d'éclatement
  fxParts.push({x:w*(0.1+0.8*Math.random()), y:h+4, vx:(Math.random()-0.5)*1.4,
                vy:-Math.sqrt(2*FX_G*monte), fusee:true, c:fxCoul(), r:2.2, t:0, max:1e9});
}
function fxBurst(x, y, n, force){
  const c1 = fxCoul(), c2 = fxCoul();
  for(let i=0; i<n; i++){
    const a = Math.random()*2*Math.PI, v = force*(0.35 + 0.65*Math.random());
    fxParts.push({x, y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, c:Math.random()<0.7?c1:c2,
                  r:1.6 + Math.random()*1.4, t:0, max:45 + Math.random()*35});
  }
}
function fxLoop(now){
  const {cx, w, h} = fxCanvas();
  const k = Math.min(3, (now - fxLast)/16.7) || 1; fxLast = now;
  if(now < fxUntil && now >= fxNext){ fxRocket(w, h); fxNext = now + 220 + Math.random()*320; }
  // estompe l'image précédente plutôt que l'effacer : les étincelles laissent une traîne
  cx.globalCompositeOperation = "destination-out";
  cx.fillStyle = "rgba(0,0,0,.26)"; cx.fillRect(0, 0, w, h);
  cx.globalCompositeOperation = "source-over";
  const nes = [];
  fxParts = fxParts.filter(p=>{
    p.t += k; p.x += p.vx*k; p.y += p.vy*k;
    if(p.fusee){
      p.vy += FX_G*k;
      if(p.vy >= -0.8){ nes.push(p); return false; }
    }else{
      p.vy += FX_G*0.45*k; p.vx *= Math.pow(0.975, k); p.vy *= Math.pow(0.975, k);
      if(p.t >= p.max) return false;
    }
    cx.globalAlpha = p.fusee ? 1 : Math.max(0, 1 - p.t/p.max);
    cx.fillStyle = p.c;
    cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 2*Math.PI); cx.fill();
    return true;
  });
  cx.globalAlpha = 1;
  nes.forEach(p=>fxBurst(p.x, p.y, 55, 4.2));
  if(now >= fxUntil && !fxParts.length){ cx.clearRect(0, 0, w, h); fxRaf = 0; return; }
  fxRaf = requestAnimationFrame(fxLoop);
}
function fxRun(){ if(!fxRaf){ fxLast = performance.now(); fxRaf = requestAnimationFrame(fxLoop); } }
function fireworks(ms){
  if(calme()) return;
  fxUntil = performance.now() + ms; fxNext = 0;
  fxRun();
}
/* Le bouquet final, au moment où le nom apparaît. */
function fxBouquet(){
  if(calme()) return;
  const w = innerWidth, h = innerHeight;
  [[0.22,0.28],[0.5,0.16],[0.78,0.28]].forEach(([x,y])=>fxBurst(w*x, h*y, 80, 5.5));
  fxRun();
}
function fxStop(){
  cancelAnimationFrame(fxRaf); fxRaf = 0; fxParts = []; fxUntil = 0;
  const {cx, w, h} = fxCanvas(); cx.clearRect(0, 0, w, h);
}
$("#wheel-nav").addEventListener("click", openWheel);
$("#wheel-go").addEventListener("click", spinWheel);
$("#wheel-close").addEventListener("click", closeWheel);

/* ============ Fusion ============ */
function mergeSession(){
  const W = sess.types.map(t=>t.w);
  const A = sess.A.rep ? sess.A.rep.ev.slice() : [];
  const B = sess.B.rep ? sess.B.rep.ev.slice() : [];
  const usedB=new Array(B.length).fill(false);
  const conf=sess.names.map(()=>0), solo=sess.names.map(()=>0);
  const cConf=sess.names.map(()=>0), cSolo=sess.names.map(()=>0);
  let pairs=0;
  A.forEach(a=>{
    let best=-1,bd=Infinity;
    B.forEach((b,j)=>{ if(usedB[j]||b.s!==a.s) return;
      const d=Math.abs(b.t-a.t); if(d<=MATCH_WINDOW && d<bd){ bd=d; best=j; } });
    if(best>=0){ usedB[best]=true; pairs++;
      const w=Math.max(W[a.y]||0, W[B[best].y]||0);
      if(conf[a.s]!==undefined){ conf[a.s]+=w; cConf[a.s]++; }
    }else if(solo[a.s]!==undefined){ solo[a.s]+=W[a.y]||0; cSolo[a.s]++; }
  });
  B.forEach((b,j)=>{ if(!usedB[j]&&solo[b.s]!==undefined){ solo[b.s]+=W[b.y]||0; cSolo[b.s]++; } });

  const absSet=new Set([...(sess.A.rep?sess.A.rep.abs||[]:[]), ...(sess.B.rep?sess.B.rep.abs||[]:[])]);
  const both=!!(sess.A.rep&&sess.B.rep);
  const conv= both ? ((A.length+B.length)?Math.round(200*pairs/(A.length+B.length)):0) : null;
  return {conf,solo,cConf,cSolo,pairs,nA:A.length,nB:B.length,conv,both,abs:Array.from(absSet)};
}
$("#to-sum").addEventListener("click",()=>{
  if(scanner) scanner.stop();
  merged=mergeSession(); arb={}; adj={}; sumOrder=null;
  $("#keep").value=cfgOf(sess.cls).solo;
  paintSummary(); step("#step-sum");
});
function creditFor(){
  const cfg=cfgOf(sess.cls);
  if(!cfg.credit) return 0;
  const f = merged.conv===null ? 0.75 : (0.5 + merged.conv/200);
  return Math.round(cfg.credit*f);
}
function soloPart(i, mode){
  if(arb[i]==="drop") return 0;
  if(arb[i]==="keep") return merged.solo[i];
  return mode==="conf" ? 0 : mode==="half" ? Math.round(merged.solo[i]/2) : merged.solo[i];
}
function retained(mode){
  const cr=creditFor(), obs=[sess.A.obs, sess.B.obs];
  return sess.names.map((n,i)=>{
    let base;
    if(obs.includes(n)) base = cr;
    else {
      const brut = merged.conf[i] + soloPart(i, mode);
      base = sess.cap ? Math.min(brut, sess.cap) : brut;
    }
    // la correction manuelle passe apres le plafond : c'est un choix du professeur
    return Math.max(0, base + (adj[i]||0));
  });
}
/* Écart marqué : un observateur a vu nettement plus que l'autre sur cet élève. */
function toArbitrate(){
  if(!merged.both) return [];
  const obs=[sess.A.obs,sess.B.obs];
  return sess.names.map((n,i)=>({n,i,solo:merged.solo[i],conf:merged.conf[i]}))
    .filter(o=>!obs.includes(o.n) && o.solo>=3 && o.solo>o.conf)
    .sort((a,b)=>b.solo-a.solo);
}
function paintArb(){
  const list=toArbitrate();
  if(!list.length){ $("#arb-card").innerHTML=""; return; }
  $("#arb-card").innerHTML=`<div class="card">
    <strong>${list.length} écart${list.length>1?"s":""} à trancher</strong>
    <p class="sub" style="margin:4px 0 12px;font-size:14.5px">Un seul observateur a relevé ces interventions. Le plus souvent l'autre a simplement décroché — mais c'est à vous de décider.</p>
    ${list.map(o=>{
      const d=arb[o.i]||"", tot=o.conf+soloPart(o.i,$("#keep").value);
      return `<div class="r" style="padding:9px 0;border-bottom:1px solid var(--line)">
        <span class="nm">${esc(o.n)}<br><span class="sub" style="font-size:13px">${o.conf} confirmé${o.conf>1?"s":""} · ${o.solo} isolé${o.solo>1?"s":""} → ${tot} retenus</span></span>
        <button data-k="${o.i}" class="pill ${d==="keep"?"ok":""}" style="padding:7px 11px">Retenir</button>
        <button data-d="${o.i}" class="pill ${d==="drop"?"solo":""}" style="padding:7px 11px">Écarter</button>
      </div>`;}).join("")}
  </div>`;
  $$("#arb-card button[data-k]").forEach(b=>b.addEventListener("click",()=>{
    arb[+b.dataset.k] = arb[+b.dataset.k]==="keep" ? "" : "keep"; paintArb(); drawSumTable(); }));
  $$("#arb-card button[data-d]").forEach(b=>b.addEventListener("click",()=>{
    arb[+b.dataset.d] = arb[+b.dataset.d]==="drop" ? "" : "drop"; paintArb(); drawSumTable(); }));
}
function paintSummary(){
  const m=merged;
  $("#sum-sub").textContent=`${sess.cls} · ${frDate(sess.date)} · postes tenus par ${sess.A.obs} et ${sess.B.obs}`;
  const cr=creditFor();
  const absTxt = m.abs.length ? `<br>${m.abs.length} élève${m.abs.length>1?"s":""} signalé${m.abs.length>1?"s":""} absent${m.abs.length>1?"s":""} : séance neutralisée pour eux.` : "";
  if(m.both){
    const q=m.conv>=70?"Les deux relevés concordent bien."
          :m.conv>=45?"Concordance moyenne : regardez les points isolés de près."
                     :"Concordance faible. Un des deux observateurs a peut-être décroché.";
    $("#conv-card").innerHTML=`
      <div class="row"><strong class="grow">Convergence des observateurs</strong><span class="big">${m.conv}%</span></div>
      <div class="gauge"><i style="width:${m.conv}%"></i></div>
      <p class="sub" style="margin:6px 0 0;font-size:14px">${m.pairs} interventions vues par les deux · ${m.nA} relevées par A · ${m.nB} par B. ${q}
      ${cr?`<br>Crédit accordé à chaque observateur : ${cr} points.`:""}${absTxt}</p>`;
  }else{
    $("#conv-card").innerHTML=`<p class="err" style="margin:0">Un seul relevé reçu : aucune convergence calculable, tous les points sont isolés.</p>
      <p class="sub" style="margin:6px 0 0;font-size:14px">${cr?`Crédit observateur ramené à ${cr} points.`:""}${absTxt}</p>`;
  }
  paintArb(); drawSumTable();
}
function drawSumTable(){
  const mode=$("#keep").value, ret=retained(mode), absSet=new Set(merged.abs);
  const obs=[sess.A.obs,sess.B.obs];
  // l'ordre est fige a l'entree : sinon les lignes sautent sous le doigt
  if(!sumOrder) sumOrder = sess.names.map((n,i)=>i)
    .sort((a,b)=>ret[b]-ret[a] || sess.names[a].localeCompare(sess.names[b],"fr"));
  const rows = sumOrder.map(i=>({n:sess.names[i], i, c:merged.conf[i], s:merged.solo[i], r:ret[i],
                                 k:merged.cConf[i]+merged.cSolo[i], a:absSet.has(i),
                                 o:obs.includes(sess.names[i]), d:arb[i]||'', j:adj[i]||0}));
  $("#sum-tbl").innerHTML=
    `<div class="r head"><span class="nm">Élève</span><span class="n">Conf.</span><span class="n">Isolés</span><span class="n" style="width:auto">Retenu</span></div>`+
    rows.map(o=>`<div class="r${o.k||o.o||o.j?"":" none"}">
      ${avatar(sess.cls,o.n)}
      <span class="nm">${esc(o.n)}${o.o?' <span class="pill ok">obs.</span>':""}${o.a?' <span class="pill solo">abs.</span>':""}${o.d==="drop"?' <span class="pill solo">isolés écartés</span>':o.d==="keep"?' <span class="pill ok">arbitré</span>':""}${o.j?` <span class="pill ok">${o.j>0?"+":""}${o.j}</span>`:""}</span>
      <span class="n ${o.c?"":"dim"}">${o.o?"—":o.c}</span>
      <span class="n ${o.s?"":"dim"}">${o.o?"—":o.s}</span>
      <span class="ctrl">
        <button class="adj" data-moins="${o.i}" ${o.a?"disabled":""}>−</button>
        <span class="v" style="color:${o.r?"var(--teal)":"inherit"}">${o.a?"—":o.r}</span>
        <button class="adj" data-plus="${o.i}" ${o.a?"disabled":""}>+</button>
      </span></div>`).join("");
  $$("#sum-tbl .adj").forEach(b=>b.addEventListener("click",()=>{
    const plus = b.dataset.plus !== undefined;
    const i = +(plus ? b.dataset.plus : b.dataset.moins);
    adj[i] = (adj[i]||0) + (plus ? 1 : -1);
    if(!adj[i]) delete adj[i];
    drawSumTable();
  }));
}
$("#keep").addEventListener("change", ()=>{ paintArb(); drawSumTable(); });

$("#validate").addEventListener("click",()=>{
  const mode=$("#keep").value, ret=retained(mode);
  history.push({cls:sess.cls, date:sess.date, mode, obsA:sess.A.obs, obsB:sess.B.obs,
                conv:merged.conv, names:sess.names.slice(), pts:ret,
                conf:merged.conf, solo:merged.solo, abs:merged.abs, arb:{...arb}, adj:{...adj}});
  if(!save(K_H,history)){ alert("Enregistrement impossible : stockage saturé."); return; }
  sess=null; localStorage.removeItem(K_S); merged=null;
  step("#step-start"); fillClassSelects();
  alert("Séance enregistrée.");
});
$("#discard").addEventListener("click",()=>{
  if(!confirm("Abandonner cette séance sans l'enregistrer ?")) return;
  sess=null; localStorage.removeItem(K_S); step("#step-start");
});

/* ============ Suivi annuel ============ */
function annualFor(c){
  const cfg=cfgOf(c), names=namesOf(c), hs=history.filter(h=>h.cls===c);
  const tot=names.map(()=>0), pres=names.map(()=>0), roles={};
  hs.forEach(h=>{
    const absSet=new Set(h.abs||[]);
    h.names.forEach((n,i)=>{
      const k=names.indexOf(n); if(k<0) return;
      if(absSet.has(i)){ if(cfg.absent==="zero"){ pres[k]++; } return; }
      tot[k]+=h.pts[i]||0; pres[k]++;
    });
    roles[h.obsA]=(roles[h.obsA]||0)+1; roles[h.obsB]=(roles[h.obsB]||0)+1;
  });
  // ramené au nombre de séances de la classe, pour ne pas pénaliser les absences
  const N=hs.length;
  const norm=names.map((n,i)=> pres[i] ? Math.round(tot[i]*N/pres[i]) : 0);
  return {cfg,names,hs,tot,pres,norm,roles,N};
}
function restitution(cfg, pts){
  const r = cfg.objectif ? pts/cfg.objectif : 0;
  if(cfg.resti==="note")    return {v:(Math.min(20, Math.round(r*20*10)/10)).toFixed(1).replace(".",","), u:"/20"};
  if(cfg.resti==="bonus")   return {v:"+"+(Math.min(1, Math.round(r*10)/10)).toFixed(1).replace(".",","), u:"pt"};
  if(cfg.resti==="echelle") return {v:["Insuffisant","Fragile","Satisfaisant","Très bonne maîtrise"][r>=.8?3:r>=.5?2:r>=.25?1:0], u:""};
  return null;
}
function paintAnnual(){
  const c=$("#cls2").value;
  if(!c){ $("#annual").innerHTML=`<div class="r none"><span class="nm">Créez d'abord une classe.</span></div>`; $("#suivi-sub").textContent=""; return; }
  const A=annualFor(c);
  const conv=A.hs.filter(h=>h.conv!=null);
  $("#suivi-sub").textContent = A.N
    ? `${A.N} séance${A.N>1?"s":""} · modèle « ${(MODELES[A.cfg.modele]||MODELES.formatif).nom} »`+
      (conv.length?` · convergence moyenne ${Math.round(conv.reduce((s,h)=>s+h.conv,0)/conv.length)}%`:"")
    : "Aucune séance enregistrée pour cette classe.";
  const showR = A.cfg.resti!=="none" && A.N;
  const rows=A.names.map((n,i)=>({n,p:A.norm[i],r:A.roles[n]||0,
                                  x:showR?restitution(A.cfg,A.norm[i]):null,
                                  miss:A.N-A.pres[i]}))
    .sort((a,b)=>b.p-a.p||a.n.localeCompare(b.n,"fr"));
  $("#annual").innerHTML=
    `<div class="r head"><span class="nm">Élève</span><span class="n">Rôles</span><span class="n">Points</span>${showR?'<span class="n">Bilan</span>':""}</div>`+
    rows.map(o=>`<div class="r${o.p?"":" none"}">
      ${avatar(c,o.n)}
      <span class="nm">${esc(o.n)}${o.miss>0?` <span class="pill">${o.miss} abs.</span>`:""}</span>
      <span class="n ${o.r?"":"dim"}">${o.r}</span>
      <span class="n ${o.p?"hi":"dim"}">${o.p}</span>
      ${showR?`<span class="n" style="width:auto;min-width:70px">${esc(o.x.v)}${o.x.u}</span>`:""}</div>`).join("");

  paintSeances(c);
  const last=load(K_B,null), days=last?Math.floor((Date.now()-last)/86400000):null;
  $("#backup-warn").innerHTML = !history.length ? ""
    : (days===null||days>=14)
      ? `<div class="warnbox"><strong>Sauvegarde ${days===null?"jamais faite":"vieille de "+days+" jours"}.</strong> Exportez maintenant : sept jours sans ouvrir cette page suffisent à effacer les données.</div>`
      : `<p class="sub" style="font-size:14px">Dernière sauvegarde il y a ${days} jour${days>1?"s":""}.</p>`;
}
/* ---- Reprise d'une seance deja enregistree ----
   On corrige les points retenus, jamais le releve des observateurs : conf et
   solo restent intacts, l'ecart est isole dans adj et reste donc reversible. */
let corrH = null, corrPts = null;
function paintSeances(c){
  const hs = history.map((h,k)=>({h,k})).filter(o=>o.h.cls===c).reverse();
  $("#seances").innerHTML = hs.length
    ? hs.map(o=>`<div class="r">
        <span class="nm">${frDate(o.h.date)}<br><span class="sub" style="font-size:13px">${esc(o.h.obsA)} et ${esc(o.h.obsB)}${o.h.conv!=null?` · ${o.h.conv}%`:""}</span></span>
        <button class="pill ok" data-corr="${o.k}" style="padding:8px 12px">Corriger</button>
      </div>`).join("")
    : `<div class="r none"><span class="nm">Aucune séance enregistrée.</span></div>`;
  $$("#seances button[data-corr]").forEach(b=>b.addEventListener("click",()=>openCorr(+b.dataset.corr)));
}
function openCorr(k){
  corrH = k; corrPts = history[k].pts.slice();
  const h = history[k];
  $("#corr-h").textContent = `Séance du ${frDate(h.date)}`;
  $("#corr-sub").textContent = `${h.cls} · postes tenus par ${h.obsA} et ${h.obsB}`;
  drawCorr();
  $("#corr").classList.add("on"); window.scrollTo(0,0);
}
function drawCorr(){
  const h = history[corrH], absSet = new Set(h.abs||[]);
  $("#corr-tbl").innerHTML =
    `<div class="r head"><span class="nm">Élève</span><span class="n">Relevé</span><span class="n" style="width:auto">Retenu</span></div>`+
    h.names.map((n,i)=>{
      const brut = (h.pts[i]||0) - ((h.adj&&h.adj[i])||0);
      const ecart = corrPts[i] - brut;
      return `<div class="r">
        ${avatar(h.cls,n)}
        <span class="nm">${esc(n)}${absSet.has(i)?' <span class="pill solo">abs.</span>':""}${ecart?` <span class="pill ok">${ecart>0?"+":""}${ecart}</span>`:""}</span>
        <span class="n dim">${brut}</span>
        <span class="ctrl">
          <button class="adj" data-cm="${i}">−</button>
          <span class="v" style="color:${corrPts[i]?"var(--teal)":"inherit"}">${corrPts[i]}</span>
          <button class="adj" data-cp="${i}">+</button>
        </span></div>`;
    }).join("");
  $$("#corr-tbl .adj").forEach(b=>b.addEventListener("click",()=>{
    const plus = b.dataset.cp !== undefined;
    const i = +(plus ? b.dataset.cp : b.dataset.cm);
    corrPts[i] = Math.max(0, corrPts[i] + (plus ? 1 : -1));
    drawCorr();
  }));
}
$("#corr-save").addEventListener("click",()=>{
  const h = history[corrH], a = {};
  h.names.forEach((n,i)=>{
    const brut = (h.pts[i]||0) - ((h.adj&&h.adj[i])||0);   // releve d'origine, hors corrections
    const d = corrPts[i] - brut;
    if(d) a[i] = d;
  });
  const avantPts = h.pts, avantAdj = h.adj;
  h.adj = a; h.pts = corrPts.slice();
  if(!save(K_H,history)){
    h.pts = avantPts; h.adj = avantAdj;
    alert("Enregistrement impossible : stockage saturé."); return;
  }
  $("#corr").classList.remove("on");
  paintAnnual();
});
$("#corr-close").addEventListener("click",()=>$("#corr").classList.remove("on"));

$("#cls2").addEventListener("change", paintAnnual);

$("#export").addEventListener("click",()=>{
  const txt=JSON.stringify({format:"participation-v2", exporte:new Date().toISOString(), classes, history},null,2);
  const url=URL.createObjectURL(new Blob([txt],{type:"application/json"}));
  const a=document.createElement("a"); a.href=url;
  a.download=`participation-sauvegarde-${today()}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
  save(K_B,Date.now()); paintAnnual();
});
$("#restore").addEventListener("change", async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const d=JSON.parse(await f.text());
    if(!/^participation-v[12]$/.test(d.format||"")) throw new Error("bad");
    if(!confirm("Remplacer toutes les données de cet appareil par cette sauvegarde ?")) return;
    if(d.classes){ classes=d.classes; }
    else if(d.roster){ classes={}; Object.keys(d.roster).forEach(c=>{
      classes[c]={names:String(d.roster[c]).split("\n").map(x=>x.trim()).filter(Boolean), cfg:defaultCfg("formatif")}; }); }
    history=d.history||[];
    save(K_C,classes); save(K_H,history);
    fillClassSelects(); paintAnnual(); paintClassList(); alert("Sauvegarde restaurée.");
  }catch(err){ alert("Fichier de sauvegarde illisible."); }
  e.target.value="";
});

/* ============ Bilans élèves ============ */
$("#bilans").addEventListener("click",()=>{
  const c=$("#cls2").value; if(!c) return;
  const A=annualFor(c);
  if(!A.N){ $("#bilan-out").innerHTML=`<p class="sub">Aucune séance à résumer.</p>`; return; }
  const seances=A.names.map(()=>0), parType={};
  A.hs.forEach(h=>h.names.forEach((n,i)=>{ const k=A.names.indexOf(n); if(k>=0 && h.pts[i]) seances[k]++; }));
  $("#bilan-out").innerHTML=`<p class="sub" style="margin-top:14px">${A.names.length} bilans, un par élève. À coller dans un message Pronote individuel.</p>`+
    A.names.map((n,i)=>{
      const r=A.cfg.resti!=="none"?restitution(A.cfg,A.norm[i]):null;
      const t=`Participation orale — ${c}\n${n}\n\n`+
        `Séances observées : ${A.N}. Tu es intervenu(e) lors de ${seances[i]} d'entre elles.\n`+
        (A.N-A.pres[i]>0?`Absences : ${A.N-A.pres[i]} (neutralisées dans le calcul).\n`:"")+
        `Points de participation : ${A.norm[i]} (objectif de la période : ${A.cfg.objectif}).\n`+
        (r?`Bilan : ${r.v}${r.u}\n`:"")+
        `\nCe relevé est établi par tes camarades observateurs et validé par le professeur à chaque séance.`;
      return `<div class="bilan"><h3>${esc(n)}</h3><textarea readonly spellcheck="false">${esc(t)}</textarea></div>`;
    }).join("");
});

/* ============ Démarrage ============ */
fillClassSelects(); paintClassList();
if(sess){ if(sess.A.rep||sess.B.rep) showRecv(); else showCodes(); }
paintAnnual();
