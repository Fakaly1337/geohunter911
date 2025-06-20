// ==UserScript==
// @name         PlonkIT HUD (GeoGuessr + OpenGuessr) – stable
// @namespace    Fakaly1337
// @version      2025-06-22stable
// @description  Kontinent / Land / State / Stadt + Yandex-Minimap (auto-refresh)
// @match        https://www.geoguessr.com/*
// @match        https://openguessr.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  /* ── Basics ─────────────────────────────────────────────── */
  const KEY = 'pk.8a4add797b142c1faca647ddf8d6b000';
  const api = {
    geo: p => `https://us1.locationiq.com/v1/${p}&key=${KEY}`,
    map: (lat, lon, z) =>
      `https://static-maps.yandex.ru/1.x/?ll=${lon},${lat}&z=${z}&size=500,300&l=map&pt=${lon},${lat},pm2rdm&lang=en_US`
  };

  /* Quick continent boxes (keine Genauigkeit, nur Fallback) */
  const CONT = [
    ['North America',  7, 85, -170, -30],
    ['South America', -60, 15, -90,  -30],
    ['Europe',        35, 72, -25,   45],
    ['Africa',       -35, 37, -20,   52],
    ['Asia',          -1, 81,  25,  180],
    ['Oceania',      -50,  0, 100,  180],
    ['Antarctica',   -90,-60,-180,  180]
  ];
  const ISO_FIX = { 'Hong Kong':'HK','Macau':'MO','Åland Islands':'AX','Kosovo':'XK' };

  const pos   = {lat:0, lon:0};
  let   zoom  = 13;
  const cache = {rev:{}, cont:{}, cen:{}};
  const ui    = {};

  const getJSON = u => new Promise(r =>
    GM_xmlhttpRequest({url:u,onload:x=>r(JSON.parse(x.responseText)),onerror:()=>r(null)}));

  const roughCont = (lat,lon)=>{
    for(const [n,la1,la2,lo1,lo2] of CONT)
      if(lat>=la1&&lat<=la2&&lon>=lo1&&lon<=lo2) return n;
    return lat>=0?'Europe':'Africa';
  };

  const dir = (aLat,aLon,bLat,bLon,e)=>{const dLat=bLat-aLat,dLon=bLon-aLon;
    return (Math.abs(dLat)>e?(dLat>0?'N':'S'):'')+(Math.abs(dLon)>e?(dLon>0?'E':'W'):'')||'Ctr';};

  /* HUD ------------------------------------------------------ */
  const line = t=>{const d=document.createElement('div');
    d.textContent=t;d.style.cssText='color:#fff;background:rgba(0,0,0,.7);padding:5px 8px;border-radius:4px;margin:2px 0;font:14px/1 Arial';
    ui.box.appendChild(d);return d;};

  function buildHUD(){
    ui.box=Object.assign(document.createElement('div'),{style:'position:fixed;top:50px;left:10px;z-index:9999'});
    ui.cont=line('Continent: N/A'); ui.country=line('Country:   N/A');
    ui.state=line('State:     N/A'); ui.city=line('City:      N/A');

    const w=Object.assign(document.createElement('div'),{style:'position:relative;margin-top:4px'});
    ui.map=Object.assign(document.createElement('img'),{style:'display:block;width:500px;height:300px;border:2px solid #333;border-radius:6px'});
    w.appendChild(ui.map);
    ['+','−'].forEach((s,i)=>{
      const b=Object.assign(document.createElement('div'),{textContent:s,
        style:`position:absolute;top:8px;right:${i?40:8}px;width:24px;height:24px;line-height:24px;text-align:center;background:rgba(0,0,0,.7);color:#fff;border-radius:3px;cursor:pointer`});
      b.onclick=()=>{zoom=Math.min(20,Math.max(1,zoom+(s==='+'?1:-1))); ui.map.src=api.map(pos.lat,pos.lon,zoom);};
      w.appendChild(b);
    });
    ui.box.appendChild(w);document.body.appendChild(ui.box);
    ui.map.src=api.map(0,0,zoom);
  }

  /* Koordinaten übernehmen + Refresh ------------------------- */
  const setPos=(lat,lon)=>{pos.lat=lat;pos.lon=lon;refresh();};

  /* Reverse + HUD ------------------------------------------- */
  async function refresh(){
    if(!pos.lat) return;
    const key=`${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
    let rev=cache.rev[key];
    if(!rev){
      rev=await getJSON(api.geo(`reverse.php?lat=${pos.lat}&lon=${pos.lon}&format=json&normalizeaddress=1`));
      if(rev?.address) cache.rev[key]=rev; else return;
    }
    const a=rev.address;
    const country=a.country||a.country_name||'';
    const state=a.state||a.region||a.province||a.state_district||a.county||'';
    const city=a.city||a.town||a.village||a.municipality||a.hamlet||a.locality||'';

    let iso=(a.country_code||'').toUpperCase();
    if(!iso&&ISO_FIX[country]) iso=ISO_FIX[country];

    if(!iso){cache.cont.__tmp=roughCont(pos.lat,pos.lon); iso='__tmp';}

    if(!cache.cont[iso]||cache.cont[iso]==='N/A'){
      const r=await getJSON(`https://restcountries.com/v3.1/alpha/${iso}`);
      const cont=r?.[0]?.continents?.[0]||roughCont(pos.lat,pos.lon);
      if(cont) cache.cont[iso]=cont;           // nur speichern wenn Wert da
    }
    const continent=cache.cont[iso]||roughCont(pos.lat,pos.lon);

    ui.cont.textContent   =`Continent: ${continent}`;
    ui.country.textContent=`Country:   ${country||'N/A'}`;
    ui.state.textContent  =`State:     ${state||'N/A'}`;
    ui.city.textContent   =`City:      ${city||'N/A'}`;
    ui.map.src=api.map(pos.lat,pos.lon,zoom);
  }

  /* Parsing -------------------------------------------------- */
  const parse=txt=>{let m;if((m=txt.match(/-?\d+\.\d+,-?\d+\.\d+/)))return m[0].split(',').map(Number);
    if((m=txt.match(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/)))return[+m[1],+m[2]];
    if((m=txt.match(/"lat":\s*(-?\d+\.\d+).*?"lng":\s*(-?\d+\.\d+)/)))return[+m[1],+m[2]];};

  const hook=txt=>{const c=parse(txt);c&&setPos(c[0],c[1]);};

  /* XHR + fetch hooks GeoGuessr -------------------------------- */
  XMLHttpRequest.prototype.open=new Proxy(XMLHttpRequest.prototype.open,{
    apply(o,xhr,args){const[m,u]=args;
      if(m==='POST'&&u.includes('MapsJsInternalService'))xhr.addEventListener('load',()=>hook(xhr.responseText));
      return o.apply(xhr,args);} });

  const _f=window.fetch;
  window.fetch=function(...a){
    return _f.apply(this,a).then(r=>{
      if(r.url.includes('MapsJsInternalService')||r.url.includes('/maps/'))
        r.clone().text().then(hook).catch(()=>{});
      return r;
    });
  };

  /* OpenGuessr polling --------------------------------------- */
  if(location.hostname.includes('openguessr.com')){
    setInterval(()=>{
      const ifr=document.getElementById('PanoramaIframe'); if(!ifr||!ifr.src) return;
      let loc='';try{const u=new URL(ifr.src);
        loc=u.searchParams.get('location')||u.searchParams.get('viewpoint')||'';
        if(!loc){const m=ifr.src.match(/(?:location|viewpoint)=([^&]+)/);if(m)loc=decodeURIComponent(m[1]);}}catch{}
      if(loc){const[lat,lon]=loc.split(/[ ,]/).map(Number);if(!isNaN(lat)&&!isNaN(lon))setPos(lat,lon);}
    },1000);
  }

  /* Init ------------------------------------------------------ */
  document.body?buildHUD():addEventListener('DOMContentLoaded',buildHUD);
})();
