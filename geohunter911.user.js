// ==UserScript==
// @name         PlonkIT compact (GeoGuessr + OpenGuessr) – auto
// @namespace    Fakaly1337
// @version      2025-06-22c
// @description  HUD: Kontinent / Land / Bundesstaat / Stadt + Minikarte (automatische Aktualisierung)
// @match        https://www.geoguessr.com/*
// @match        https://openguessr.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  /* ── API-Wrapper ───────────────────────────────────────────── */
  const LQ_KEY = 'pk.8a4add797b142c1faca647ddf8d6b000';
  const api = {
    geo: p => `https://us1.locationiq.com/v1/${p}&key=${LQ_KEY}`,
    map: (lat, lon, z) =>
      `https://static-maps.yandex.ru/1.x/?ll=${lon},${lat}&z=${z}&size=500,300&l=map&pt=${lon},${lat},pm2rdm&lang=en_US`
  };

  /* ── Fallback-Tabellen ─────────────────────────────────────── */
  const ISO_FALLBACK = { 'Hong Kong':'HK', 'Macau':'MO', 'Åland Islands':'AX', 'Kosovo':'XK' };
  const roughContinent = (lat, lon) => {
    if (lat < -60) return 'Antarctica';
    if (lon >= -170 && lon <= -30) return lat >= 15 ? 'North America' : 'South America';
    if (lon > 30 && lon < 150)      return lat <  0 ? 'Oceania'       : 'Asia';
    if (lon >= -30 && lon <= 30)    return lat >= 0 ? 'Europe'        : 'Africa';
    return lat >= 0 ? 'Asia' : 'Africa';
  };

  /* ── State ─────────────────────────────────────────────────── */
  const pos   = { lat: 0, lon: 0 };
  let   zoom  = 13;
  const cache = { rev:{}, cen:{}, cont:{} };
  const ui    = {};

  /* ── Utility ──────────────────────────────────────────────── */
  const jFetch = url => new Promise(r =>
    GM_xmlhttpRequest({ url, onload: x => r(JSON.parse(x.responseText)), onerror: () => r(null) })
  );

  const centroid = async q =>
    (cache.cen[q] ??= (await jFetch(api.geo(`search.php?q=${encodeURIComponent(q)}&format=json&limit=1`)))?.[0] || null);

  const dir = (aLat,aLon,bLat,bLon,e=0.05)=>{
    const dLat=bLat-aLat,dLon=bLon-aLon;
    return (Math.abs(dLat)>e?(dLat>0?'N':'S'):'')+(Math.abs(dLon)>e?(dLon>0?'E':'W'):'')||'Ctr';
  };

  const drawMap = () => ui.map.src = api.map(pos.lat, pos.lon, zoom);

  /* ── HUD-Setter ───────────────────────────────────────────── */
  function setPos(lat, lon){
    if(Math.abs(lat-pos.lat)<1e-6&&Math.abs(lon-pos.lon)<1e-6) return;
    pos.lat=lat; pos.lon=lon; refresh();
  }

  /* ── Haupt-Refresh ────────────────────────────────────────── */
  async function refresh(){
    if(!pos.lat) return;

    /* Reverse-Cache (10-m Raster) */
    const key=`${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
    let rev=cache.rev[key];
    if(!rev){
      rev=await jFetch(api.geo(`reverse.php?lat=${pos.lat}&lon=${pos.lon}&format=json&normalizeaddress=1`));
      if(rev?.address) cache.rev[key]=rev; else return;
    }
    const a=rev.address;

    const country=a.country||a.country_name||'';
    const state  =a.state||a.region||a.province||a.state_district||a.county||'';
    const city   =a.city||a.town||a.village||a.municipality||a.hamlet||a.locality||'';

    let iso=(a.country_code||'').toUpperCase();
    if(!iso&&ISO_FALLBACK[country]) iso=ISO_FALLBACK[country];

    /* Kontinent ermitteln (nie „N/A“ cachen) */
    if(!iso){
      cache.cont.__tmp = roughContinent(pos.lat,pos.lon);
      iso='__tmp';
    }
    if(!cache.cont[iso] || cache.cont[iso]==='N/A'){
      const r=await jFetch(`https://restcountries.com/v3.1/alpha/${iso}`);
      const cont=r?.[0]?.continents?.[0] || roughContinent(pos.lat,pos.lon);
      if(cont) cache.cont[iso]=cont;                 // „N/A“ nicht in Cache schreiben
    }

    /* Lage-Tags */
    let cityTag='', posTag='';
    if(country){
      const cc=await centroid(country);
      if(cc&&city){
        const ci=await centroid(`${city}, ${country}`);
        if(ci){
          cityTag=` (${dir(+cc.lat,+cc.lon,+ci.lat,+ci.lon,0.05)})`;
          posTag =` (${dir(+ci.lat,+ci.lon,pos.lat,pos.lon,0.02)})`;
        }
      }
    }

    /* HUD-Update */
    ui.cont.textContent   =`Continent: ${cache.cont[iso]||'N/A'}`;
    ui.country.textContent=`Country:   ${country||'N/A'}${cityTag}`;
    ui.state.textContent  =`State:     ${state||'N/A'}`;
    ui.city.textContent   =`City:      ${city||'N/A'}${posTag}`;
    drawMap();
  }

  /* ── HUD-Aufbau ───────────────────────────────────────────── */
  const line=t=>{
    const d=document.createElement('div');
    d.textContent=t;
    d.style.cssText='color:#fff;background:rgba(0,0,0,.7);padding:5px 8px;border-radius:4px;margin:2px 0;font:14px/1 Arial';
    ui.box.appendChild(d); return d;
  };

  function buildHUD(){
    ui.box=Object.assign(document.createElement('div'),{style:'position:fixed;top:50px;left:10px;z-index:9999'});
    ui.cont=line('Continent: N/A'); ui.country=line('Country:   N/A');
    ui.state=line('State:     N/A'); ui.city=line('City:      N/A');

    const wrap=Object.assign(document.createElement('div'),{style:'position:relative;margin-top:4px'});
    ui.map=Object.assign(document.createElement('img'),{style:'display:block;width:500px;height:300px;border:2px solid #333;border-radius:6px'});
    wrap.appendChild(ui.map);

    ['+','−'].forEach((s,i)=>{
      const b=Object.assign(document.createElement('div'),{
        textContent:s,
        style:`position:absolute;top:8px;right:${i?40:8}px;width:24px;height:24px;line-height:24px;text-align:center;background:rgba(0,0,0,.7);color:#fff;border-radius:3px;cursor:pointer`
      });
      b.onclick=()=>{zoom=Math.min(20,Math.max(1,zoom+(s==='+'?1:-1))); drawMap();};
      wrap.appendChild(b);
    });

    ui.box.appendChild(wrap); document.body.appendChild(ui.box); drawMap();
  }

  /* ── Koordinaten-Parsing ─────────────────────────────────── */
  function extract(txt){
    let lat,lon,m;
    if((m=txt.match(/-?\d+\.\d+,-?\d+\.\d+/)))              [lat,lon]=m[0].split(',').map(Number);
    else if((m=txt.match(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/))) {lat=+m[1];lon=+m[2];}
    else if((m=txt.match(/"lat":\s*(-?\d+\.\d+)\s*,\s*"lng":\s*(-?\d+\.\d+)/))) {lat=+m[1];lon=+m[2];}
    if(!isNaN(lat)&&!isNaN(lon)) setPos(lat,lon);
  }

  /* ── GeoGuessr Hooks ─────────────────────────────────────── */
  XMLHttpRequest.prototype.open=new Proxy(XMLHttpRequest.prototype.open,{
    apply(o,xhr,args){const[m,url]=args;
      if(m==='POST'&&url.includes('MapsJsInternalService')) xhr.addEventListener('load',()=>extract(xhr.responseText));
      return o.apply(xhr,args);}
  });

  const _fetch=window.fetch;
  window.fetch=function(...a){
    return _fetch.apply(this,a).then(res=>{
      try{
        if(res.url.includes('MapsJsInternalService')||res.url.includes('/maps/'))
          res.clone().text().then(extract).catch(()=>{});
      }catch{} return res;});
  };

  /* ── OpenGuessr-Polling ─────────────────────────────────── */
  if(location.hostname.includes('openguessr.com')){
    setInterval(()=>{
      const ifr=document.querySelector('#PanoramaIframe'); if(!ifr||!ifr.src) return;
      let loc=''; try{
        const u=new URL(ifr.src);
        loc=u.searchParams.get('location')||u.searchParams.get('viewpoint')||'';
        if(!loc){const m=ifr.src.match(/(?:location|viewpoint)=([^&]+)/); if(m) loc=decodeURIComponent(m[1]);}
      }catch{}
      if(loc){
        const [lat,lon]=loc.split(/[ ,]/).map(Number);
        if(!isNaN(lat)&&!isNaN(lon)) setPos(lat,lon);
      }
    },1000);
  }

  /* ── Init ────────────────────────────────────────────────── */
  if(document.body) buildHUD(); else document.addEventListener('DOMContentLoaded',buildHUD);
})();
