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

/* --- QR de séance : jeton + poste + classe + date + liste ---
   Le champ « planche » reste dans le format, toujours vide : les photos ne partent
   plus vers les observateurs, et le garder évite de casser la lecture entre deux versions. */
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

/* Empreinte courte d'une chaîne : sert à reconnaître une image déjà vue dans le
   trombinoscope PDF (les silhouettes des élèves sans photo). */
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

/* --- Lecteur QR via caméra ---
   iOS coupe la caméra quand l'iPad se verrouille ou qu'on change d'application,
   sans que la page le sache : le flux est mort mais le lecteur se croit actif.
   D'où la vérification à chaque démarrage, et l'arrêt franc en arrière-plan.
   iPadOS suspend aussi la caméra quand Safari partage l'écran avec une autre
   application (Split View, Slide Over, Stage Manager) : la pastille reste
   allumée, l'image reste noire. On le détecte et on le dit.

   Zoom : celui de l'objectif quand Safari le permet, sinon un zoom numérique —
   on agrandit l'image à l'écran et on n'analyse que le centre. On demande une
   image en haute définition pour que ce recadrage garde assez de détails.
   Un passage sur deux, on regarde en plus le centre de plus près : un code
   tenu un peu loin se lit sans toucher au zoom. */
const SCAN_MAX = 1024;   // côté maximal de l'image confiée à jsQR
const SCAN_COUPE = "iOS a coupé la caméra juste après l'avoir ouverte. Utilisez « Photographier le QR code » : l'appareil photo de l'iPad fait le même travail, avec son zoom.";
const SCAN_PAUSE = "iPadOS a suspendu la caméra. Cela arrive quand Safari partage l'écran avec une autre application (Split View, Slide Over, Stage Manager) : passez Safari en plein écran, puis touchez de nouveau le bouton.";
function makeScanner(video, canvas, onFound, onError, opts){
  opts = opts || {};
  const continu = !!opts.continu;              // ramasser plusieurs codes sans s'arrêter
  const onStop = opts.onStop || (()=>{});
  const zin = opts.zoom || null;               // curseur <input type="range">
  const zctl = zin && zin.closest(".zoomctl"), zout = zctl && zctl.querySelector("output");
  const box = video.parentElement;
  let stream=null, track=null, raf=null, running=false, starting=false;
  let zoom=1, native=null, pass=0, frames=0, watch=null, relance=false;
  const ctx = canvas.getContext("2d",{willReadFrequently:true});

  function alive(){
    return !!(track && track.readyState==="live" && !track.muted && !video.paused);
  }
  async function open(){
    const base = {facingMode:"environment"};
    try{ return await navigator.mediaDevices.getUserMedia({video:{...base, width:{ideal:1920}, height:{ideal:1080}}}); }
    catch(e){
      if(e && /Overconstrained|ConstraintNotSatisfied/.test(e.name)) return navigator.mediaDevices.getUserMedia({video:base});
      throw e;
    }
  }
  async function start(){
    if(starting) return;
    if(running){ if(alive()) return; stop(); }
    starting = true;
    try{ stream = await open(); }
    catch(e){
      starting = false;
      onError(`Caméra indisponible (${e && e.name || "erreur"}). Vérifiez l'autorisation dans Réglages › Safari › Appareil photo, fermez les autres onglets ou applications qui utilisent la caméra, ou utilisez le repli texte.`);
      onStop();
      return;
    }
    starting = false;
    track = stream.getVideoTracks()[0];
    const t0 = Date.now();
    track.addEventListener("ended",()=>{
      if(!running) return;
      stop();
      if(Date.now()-t0 < 5000 && !relance){ relance = true; start(); return; }
      onError(SCAN_COUPE); onStop();
    });
    track.addEventListener("mute",()=>{ if(running) onError(SCAN_PAUSE); });
    track.addEventListener("unmute",()=>{ if(running) onError(""); });
    video.setAttribute("playsinline","");
    video.muted = true;
    video.autoplay = true;      // démarre seule dès que l'image arrive, même si play() échoue
    video.srcObject = stream;
    running = true; frames = 0;
    lancer(stream);
    setupZoom();
    if(track.muted) onError(SCAN_PAUSE);
    clearTimeout(watch);
    watch = setTimeout(()=>{        // caméra ouverte mais aucune image : dire ce qu'on voit
      if(!running || frames) return;
      onError(track.muted ? SCAN_PAUSE :
        `La caméra est ouverte mais ne renvoie aucune image (vidéo ${video.readyState}, piste ${track.readyState}, ` +
        `${video.videoWidth}×${video.videoHeight}). Utilisez « Photographier le QR code », ou fermez les autres onglets qui utilisent la caméra et passez Safari en plein écran.`);
    }, 4000);
    loop();
  }

  /* Juste après l'autorisation de la caméra, iOS interrompt souvent le premier
     play() (AbortError) alors que le flux est bon : on réessaie au lieu de tout
     couper. L'attente de 4 s plus bas dit ce qu'il en est si rien ne vient. */
  async function lancer(s){
    for(let k=0; k<6; k++){
      if(stream !== s || !running) return;
      try{ await video.play(); return; }
      catch(e){ await new Promise(r=>setTimeout(r, 200 + 200*k)); }
    }
  }
  function setupZoom(){
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    native = (caps.zoom && caps.zoom.max > caps.zoom.min) ? {min:caps.zoom.min, max:caps.zoom.max} : null;
    if(zin){
      zin.min = 1; zin.max = native ? Math.min(native.max/native.min, 8) : 4; zin.step = 0.1;
      zctl.hidden = false;
    }
    setZoom(zoom);
  }
  function setZoom(z){
    const max = native ? Math.min(native.max/native.min, 8) : 4;
    zoom = Math.min(max, Math.max(1, +z || 1));
    if(zin) zin.value = zoom;
    if(zout) zout.textContent = zoom.toFixed(1).replace(".", ",") + "×";
    if(!running) return;
    if(native){
      video.style.transform = "";
      track.applyConstraints({advanced:[{zoom: native.min*zoom}]})
        .catch(()=>{ native = null; setZoom(zoom); });   // refusé : zoom numérique
    }else{
      video.style.transform = zoom > 1 ? `scale(${zoom})` : "";
    }
  }
  if(zin) zin.addEventListener("input", ()=>setZoom(zin.value));
  // pincer l'image pour zoomer, comme dans l'appareil photo
  let pinch = null;
  const ecart = t => Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY);
  box.addEventListener("touchstart", e=>{
    if(e.touches.length===2 && running) pinch = {d:ecart(e.touches), z:zoom};
  }, {passive:true});
  box.addEventListener("touchmove", e=>{
    if(!pinch || e.touches.length!==2) return;
    e.preventDefault();
    setZoom(pinch.z * ecart(e.touches) / pinch.d);
  }, {passive:false});
  box.addEventListener("touchend", e=>{ if(e.touches.length<2) pinch = null; });

  function decode(w, h){
    const z = (native ? 1 : zoom) * ((pass++ % 2) ? 2 : 1);
    const sw = w/z, sh = h/z, k = Math.min(1, SCAN_MAX/Math.max(sw, sh));
    const dw = Math.round(sw*k), dh = Math.round(sh*k);
    if(canvas.width!==dw || canvas.height!==dh){ canvas.width=dw; canvas.height=dh; }
    ctx.drawImage(video, (w-sw)/2, (h-sh)/2, sw, sh, 0, 0, dw, dh);
    return jsQR(ctx.getImageData(0,0,dw,dh).data, dw, dh, {inversionAttempts:"dontInvert"});
  }
  function loop(){
    if(!running) return;
    const w = video.videoWidth, h = video.videoHeight;
    if(video.readyState >= video.HAVE_CURRENT_DATA && w && h){
      if(!frames++) onError("");
      const res = decode(w, h);
      if(res && res.data){
        if(continu){ onFound(res.data); }
        else { stop(); onFound(res.data); return; }
      }
    }
    raf = requestAnimationFrame(loop);
  }
  function stop(){
    running=false;
    clearTimeout(watch);
    if(raf) cancelAnimationFrame(raf);
    if(stream) stream.getTracks().forEach(t=>t.stop());
    stream=null; track=null;
    video.srcObject=null;
    video.style.transform="";
    if(zctl) zctl.hidden = true;
  }
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden && running){ stop(); onStop(); }
  });
  return {start(){ relance = false; return start(); }, stop, get running(){ return running; }};
}

/* Repli quand le flux vidéo ne tient pas (iOS le coupe parfois, surtout depuis
   l'écran d'accueil) : une photo prise avec l'appareil photo de l'iPad, qui a son
   propre zoom, décodée ici. Plusieurs tailles et le centre, du plus probable au moins. */
async function decodeQRFile(file){
  const url = URL.createObjectURL(file);
  try{
    const im = await new Promise((res, rej)=>{
      const i = new Image(); i.onload = ()=>res(i); i.onerror = ()=>rej(new Error("Photo illisible.")); i.src = url;
    });
    const W = im.naturalWidth, H = im.naturalHeight;
    const cv = document.createElement("canvas"), cx = cv.getContext("2d",{willReadFrequently:true});
    for(const [part, cote] of [[1,1600],[1,1000],[0.6,1200],[0.4,1000],[1,2400]]){
      const sw = W*part, sh = H*part, k = Math.min(1, cote/Math.max(sw, sh));
      cv.width = Math.round(sw*k); cv.height = Math.round(sh*k);
      cx.drawImage(im, (W-sw)/2, (H-sh)/2, sw, sh, 0, 0, cv.width, cv.height);
      const r = jsQR(cx.getImageData(0,0,cv.width,cv.height).data, cv.width, cv.height, {inversionAttempts:"attemptBoth"});
      if(r && r.data) return r.data;
    }
    throw new Error("Aucun QR code lisible sur cette photo. Rapprochez-vous ou zoomez, en gardant l'iPad bien en face de l'écran.");
  }finally{ URL.revokeObjectURL(url); }
}
