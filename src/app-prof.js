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
let merged=null, scanner=null, curPoste="A", arb={};
let draft=null, grid=null, gridInfo=null, editing=null;

const clsNames = () => Object.keys(classes);
const cfgOf = c => (classes[c] && classes[c].cfg) || defaultCfg("formatif");
const namesOf = c => (classes[c] && classes[c].names) || [];

/* ============ Onglets ============ */
$$(".tabs button").forEach(b=>b.addEventListener("click",()=>{
  $$(".tabs button").forEach(x=>x.classList.toggle("on",x===b));
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
  $$(".tabs button").forEach(x=>x.classList.toggle("on", x.dataset.t===sel));
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
$("#draw").addEventListener("click",()=>{
  const c=$("#cls").value, d=drawObservers(c), cnt=roleCounts(c);
  if(d.length<2) return;
  $("#obsA").value=d[0]; $("#obsB").value=d[1];
  const jamais=Object.values(cnt).filter(v=>!v).length;
  $("#draw-info").textContent =
    `${d[0]} (${cnt[d[0]]||0} fois) et ${d[1]} (${cnt[d[1]]||0} fois). ` +
    (jamais ? `${jamais} élève${jamais>1?"s n'ont":" n'a"} jamais observé.` : "Toute la classe est passée au moins une fois.");
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
    classes[draft.name]={names:draft.names, cfg:defaultCfg(b.dataset.m)};
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
  paintTypes(); toggleObj();
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
$("#cfg-back").addEventListener("click",()=>cstep("#c-list"));
$("#cfg-del").addEventListener("click",()=>{
  const nb=history.filter(h=>h.cls===cfgCls).length;
  if(!confirm(`Supprimer « ${cfgCls} »${nb?` et ses ${nb} séances enregistrées`:""} ? Cette action est définitive.`)) return;
  delete classes[cfgCls];
  history = history.filter(h=>h.cls!==cfgCls);
  save(K_C,classes); save(K_H,history); fillClassSelects(); cstep("#c-list");
});

/* ============ Séance ============ */
$("#open").addEventListener("click",()=>{
  const cls=$("#cls").value;
  if($("#obsA").value===$("#obsB").value){ alert("Les deux observateurs doivent être deux élèves différents."); return; }
  const cfg=cfgOf(cls);
  sess={cls, date:today(), names:namesOf(cls).slice(), cap:cfg.cap, types:cfg.types.map(t=>({...t})),
        A:{token:token6(), obs:$("#obsA").value, rep:null},
        B:{token:token6(), obs:$("#obsB").value, rep:null}};
  save(K_S,sess); showCodes();
});
function payloadFor(p){
  return encSession({token:sess[p].token, poste:p, cls:sess.cls, date:sess.date,
                     cap:sess.cap, types:sess.types, names:sess.names});
}
function showCodes(){
  $("#codes-sub").textContent=`${sess.cls} · ${frDate(sess.date)}`;
  const cnt=roleCounts(sess.cls);
  $("#duo").innerHTML=["A","B"].map(p=>`
    <div class="one">
      <div class="hd"><span class="poste">Poste ${p}</span>
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
$("#to-recv").addEventListener("click", showRecv);
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
  merged=mergeSession(); arb={};
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
    if(obs.includes(n)) return cr;
    const base = merged.conf[i] + soloPart(i, mode);
    return sess.cap ? Math.min(base, sess.cap) : base;
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
  const rows=sess.names.map((n,i)=>({n,i,c:merged.conf[i],s:merged.solo[i],r:ret[i],
                                     k:merged.cConf[i]+merged.cSolo[i], a:absSet.has(i), o:obs.includes(n), d:arb[i]||''}))
    .sort((a,b)=>b.r-a.r||a.n.localeCompare(b.n,"fr"));
  $("#sum-tbl").innerHTML=
    `<div class="r head"><span class="nm">Élève</span><span class="n">Conf.</span><span class="n">Isolés</span><span class="n">Retenu</span></div>`+
    rows.map(o=>`<div class="r${o.k||o.o?"":" none"}">
      <span class="nm">${esc(o.n)}${o.o?' <span class="pill ok">obs.</span>':""}${o.a?' <span class="pill solo">abs.</span>':""}${o.d==="drop"?' <span class="pill solo">isolés écartés</span>':o.d==="keep"?' <span class="pill ok">arbitré</span>':""}</span>
      <span class="n ${o.c?"":"dim"}">${o.o?"—":o.c}</span>
      <span class="n ${o.s?"":"dim"}">${o.o?"—":o.s}</span>
      <span class="n ${o.r?"hi":"dim"}">${o.a?"—":o.r}</span></div>`).join("");
}
$("#keep").addEventListener("change", ()=>{ paintArb(); drawSumTable(); });

$("#validate").addEventListener("click",()=>{
  const mode=$("#keep").value, ret=retained(mode);
  history.push({cls:sess.cls, date:sess.date, mode, obsA:sess.A.obs, obsB:sess.B.obs,
                conv:merged.conv, names:sess.names.slice(), pts:ret,
                conf:merged.conf, solo:merged.solo, abs:merged.abs, arb:{...arb}});
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
      <span class="nm">${esc(o.n)}${o.miss>0?` <span class="pill">${o.miss} abs.</span>`:""}</span>
      <span class="n ${o.r?"":"dim"}">${o.r}</span>
      <span class="n ${o.p?"hi":"dim"}">${o.p}</span>
      ${showR?`<span class="n" style="width:auto;min-width:70px">${esc(o.x.v)}${o.x.u}</span>`:""}</div>`).join("");

  const last=load(K_B,null), days=last?Math.floor((Date.now()-last)/86400000):null;
  $("#backup-warn").innerHTML = !history.length ? ""
    : (days===null||days>=14)
      ? `<div class="warnbox"><strong>Sauvegarde ${days===null?"jamais faite":"vieille de "+days+" jours"}.</strong> Exportez maintenant : sept jours sans ouvrir cette page suffisent à effacer les données.</div>`
      : `<p class="sub" style="font-size:14px">Dernière sauvegarde il y a ${days} jour${days>1?"s":""}.</p>`;
}
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
