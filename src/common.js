/* ===== Noyau partagé : barème, encodage des charges QR ===== */
"use strict";

const DEFAULT_TYPES = [
  {l:"Réponse courte",           d:"Un mot, un nombre, une valeur", w:1},
  {l:"Question pertinente",      d:"Fait avancer la classe",        w:2},
  {l:"Aide un camarade",         d:"Reformule, dépanne, explique",  w:2},
  {l:"Hypothèse ou proposition", d:"Compte même si c'est faux",     w:3},
  {l:"Raisonnement développé",   d:"Justifie, relie, argumente",    w:3},
  {l:"Passage au tableau",       d:"Prend en charge devant tous",   w:4}
];

const MODELES = {
  formatif:{nom:"Formatif seul",     resti:"none",    solo:"all" , cap:8,  objectif:12, credit:5,
            desc:"Aucune note. Un profil de participation pour l'élève et pour vous."},
  bonus:   {nom:"Bonus sur moyenne", resti:"bonus",   solo:"all" , cap:8,  objectif:12, credit:5,
            desc:"De 0 à +1 point sur la moyenne. Ne peut jamais pénaliser."},
  echelle: {nom:"Échelle à 4 niveaux",resti:"echelle",solo:"all" , cap:8,  objectif:12, credit:5,
            desc:"Insuffisant / fragile / satisfaisant / très bonne maîtrise."},
  note:    {nom:"Note sur 20",       resti:"note",    solo:"all" , cap:10, objectif:16, credit:6,
            desc:"Conversion par objectif fixe, jamais par rapport à la classe."}
};

function defaultCfg(modele){
  const m = MODELES[modele] || MODELES.formatif;
  return {modele, types:DEFAULT_TYPES.map(t=>({...t})), cap:m.cap, solo:m.solo,
          absent:"skip", tirage:"equite", credit:m.credit, resti:m.resti, objectif:m.objectif};
}


const b36 = n => Math.max(0,Math.round(n)).toString(36);
const p36 = s => parseInt(s,36)||0;

/* --- QR de séance : jeton + poste + classe + date + planche + liste --- */
function encSession(s){
  const ty = s.types.map(t=>[t.w, t.l, t.d||""].join("*")).join("~");
  return ["PVS3", s.token, s.poste, s.cls, s.date, s.cap||0, ty, s.pack||"", s.names.join("~")].join("|");
}
function decSession(txt){
  const p = String(txt||"").trim().split("|");
  if(p[0]==="PVS2") throw new Error("Ce code vient d'une version plus ancienne de l'application professeur.");
  if(p[0]!=="PVS3" || p.length<9) throw new Error("Ce code n'est pas un code de séance valide.");
  return {token:p[1], poste:p[2], cls:p[3], date:p[4], cap:+p[5]||0,
          types:p[6].split("~").filter(Boolean).map(x=>{const a=x.split("*");return {w:+a[0],l:a[1],d:a[2]||""}}),
          pack:p[7]||"",
          names:p.slice(8).join("|").split("~").filter(Boolean)};
}

/* --- Planche de photos, découpée en fragments QR ---
   Une seule image JPEG pour toute la classe : un en-tête au lieu de vingt et un.
   900 caractères par fragment maintient chaque QR en version 22 (105 modules),
   la densité qui se lit déjà correctement d'un iPad à l'autre. */
const PHOTO_CHUNK = 900;
function encPhotoFrames(pack, b64){
  const n = Math.ceil(b64.length / PHOTO_CHUNK), out = [];
  for(let i=0; i<n; i++)
    out.push(["PVP1", pack, i+1, n, b64.substr(i*PHOTO_CHUNK, PHOTO_CHUNK)].join("|"));
  return out;
}
function decPhotoFrame(txt){
  const p = String(txt||"").trim().split("|");
  if(p[0]!=="PVP1" || p.length<5) return null;
  const i = +p[2], n = +p[3];
  if(!(i>=1 && n>=1 && i<=n)) return null;
  return {pack:p[1], i, n, data:p.slice(4).join("|")};
}
/* Empreinte courte d'une planche : permet à l'observateur de savoir s'il a
   déjà la bonne, et d'ignorer un fragment venu d'une autre classe. */
function hash36(s){
  let h = 2166136261 >>> 0;
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36).toUpperCase().padStart(6,"0").slice(-6);
}

/* --- QR de relevé : jeton + départ + évènements --- */
function encReport(r){
  const ev = r.ev.map(e=>[b36(e.s), e.y, b36(Math.round((e.t-r.start)/1000))].join(".")).join(";");
  return ["PVR2", r.token, b36(Math.round(r.start/1000)), ev, (r.abs||[]).map(b36).join(";")].join("|");
}
function decReport(txt){
  const p = String(txt||"").trim().split("|");
  if(p[0]!=="PVR2" || p.length<5) throw new Error("Ce code n'est pas un relevé de séance valide.");
  const start = p36(p[2])*1000;
  const ev = p[3] ? p[3].split(";").filter(Boolean).map(x=>{
    const a=x.split(".");
    return {s:p36(a[0]), y:+a[1], t:start+p36(a[2])*1000};
  }) : [];
  const abs = p[4] ? p[4].split(";").filter(Boolean).map(p36) : [];
  return {token:p[1], start, ev, abs};
}

/* --- Divers --- */
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function token6(){
  const a=new Uint8Array(5); crypto.getRandomValues(a);
  return Array.from(a).map(x=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x%32]).join("");
}
function today(){const d=new Date();return d.toISOString().slice(0,10)}
function frDate(iso){
  const [y,m,d]=iso.split("-");
  return `${d}/${m}/${y}`;
}
const load=(k,f)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch(e){return f}};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}};

/* --- Rendu d'un QR dans un conteneur --- */
function drawQR(el, text, px){
  let ok=false;
  for(let t=4;t<=40 && !ok;t++){
    try{
      const q = qrcode(t,"L"); q.addData(text); q.make();
      const n = q.getModuleCount();
      const cell = Math.max(2, Math.floor(px/n));
      el.innerHTML = q.createSvgTag({cellSize:cell, margin:cell*2, scalable:false});
      const svg = el.querySelector("svg");
      if(svg){ svg.style.width="100%"; svg.style.height="auto"; svg.style.display="block"; }
      ok=true;
    }catch(e){}
  }
  if(!ok) el.innerHTML = '<p class="err">Relevé trop volumineux pour un QR code. Utilisez le repli texte.</p>';
  return ok;
}

/* --- Lecteur QR via caméra --- */
function makeScanner(video, canvas, onFound, onError, opts){
  const continu = !!(opts && opts.continu);   // ramasser plusieurs codes sans s'arrêter
  let stream=null, raf=null, running=false;
  const ctx = canvas.getContext("2d",{willReadFrequently:true});
  async function start(){
    if(running) return;
    try{
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
    }catch(e){
      onError("Caméra indisponible. Vérifiez l'autorisation dans Safari, ou utilisez le repli texte.");
      return;
    }
    video.srcObject = stream;
    video.setAttribute("playsinline","");
    await video.play().catch(()=>{});
    running = true;
    loop();
  }
  function loop(){
    if(!running) return;
    if(video.readyState === video.HAVE_ENOUGH_DATA){
      const w = video.videoWidth, h = video.videoHeight;
      if(w && h){
        canvas.width=w; canvas.height=h;
        ctx.drawImage(video,0,0,w,h);
        const img = ctx.getImageData(0,0,w,h);
        const res = jsQR(img.data, w, h, {inversionAttempts:"dontInvert"});
        if(res && res.data){
          if(continu){ onFound(res.data); }
          else { stop(); onFound(res.data); return; }
        }
      }
    }
    raf = requestAnimationFrame(loop);
  }
  function stop(){
    running=false;
    if(raf) cancelAnimationFrame(raf);
    if(stream) stream.getTracks().forEach(t=>t.stop());
    stream=null;
  }
  return {start, stop};
}
