// ==UserScript==
// @name         PlonkIT HUD (GeoGuessr + OpenGuessr, auto)
// @namespace    Fakaly1337
// @version      2025-06-22e
// @description  Zeigt immer Kontinent / Land (mit Lage) / State / Stadt (mit Lage) + Yandex-Minimap.
// @match        https://www.geoguessr.com/*
// @match        https://openguessr.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  /* ── API-Wrapper ─────────────────────────────────────────── */
  const LQ_KEY = 'pk.8a4add797b142c1faca647ddf8d6b000';
  const api = {
    geo: p => `https://us1.locationiq.com/v1/${p}&key=${LQ_KEY}`,
    map: (lat, lon, z) =>
      `https://static-maps.yandex.ru/1.x/?ll=${lon},${lat}&z=${z}&size=500,300&l=map&pt=${lon},${lat},pm2rdm&lang=en_US`
  };

  /* ── Continent Bounding-Boxes + Centroids ────────────────── */
  const CONT = {
    'North America': {lat:[  7, 85], lon:[-170,-30]},
    'South America': {lat:[-60,  15],lon:[ -90,-30]},
    'Europe'       : {lat:[ 35,  72],lon:[ -25, 45]},
    'Africa'       : {lat:[-35,  37],lon:[ -20, 52]},
    'Asia'         : {lat:[ -1,  81],lon:[  25,180]},
    'Oceania'      : {lat:[-50,   0],lon:[ 100,180]},
    'Antarctica'   : {lat:[-90, -60],lon:[-180,180]},
    'Arctic'       : {lat:[ 72,  90],lon:[-180,180]}
  };
  for (const k in CONT) {
    const c = CONT[k];
    c.clat = (c.lat[0] + c.lat[1]) / 2;
    c.clon = (c.lon[0] + c.lon[1]) / 2;
  }

  /* ── Hard-ISO für special cases ──────────────────────────── */
  const ISO_FALLBACK = {
    'Hong Kong': 'HK',
    'Macau':     'MO',
    'Åland Islands': 'AX',
    'Kosovo':    'XK'
  };

  const roughContinent = (lat, lon) => {
    for (const k in CONT) {
      const c = CONT[k];
      if (lat >= c.lat[0] && lat <= c.lat[1] && lon >= c.lon[0] && lon <= c.lon[1])
        return k;
    }
    return lat >= 0 ? 'Europe' : 'Africa'; // Fallback-Fallback ;)
  };

  /* ── State ───────────────────────────────────────────────── */
  const pos   = {lat: 0, lon: 0};
  let   zoom  = 13;
  const cache = {rev:{}, cen:{}, cont:{}, contCent:{}};
  const ui    = {};

  /* ── Helpers ────────────────────────────────────────────── */
  const jFetch = url => new Promise(r =>
    GM_xmlhttpRequest({url,onload:x=>r(JSON.parse(x.responseText)),onerror:()=>r(null)}));

  const centroid = async q =>
    (cache.cen[q] ??= (await jFetch(api.geo(`search.php?q=${encodeURIComponent(q)}&format=json&limit=1`)))?.[0] || null);

  const dir = (aLat,aLon,bLat,bLon,eps=0.05)=>{
    const dLat=bLat-aLat, dLon=bLon-aLon;
    return (Math.abs(dLat)>eps?(dLat>0?'N':'S'):'') +
           (Math.abs(dLon)>eps?(dLon>0?'E':'W'):'')   || 'Ctr';
  };

  const bestCity = a =>
    a.city||a.town||a.village||a.municipality||a.hamlet||a.locality||'';

  const drawMap = () => { ui.map.src = api.map(pos.lat, pos.lon, zoom); };

  /* ── HUD construction ──────────────────────────────────── */
  const line = t => {
    const d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'color:#fff;background:rgba(0,0,0,.7);padding:5px 8px;border-radius:4px;margin:2px 0;font:14px/1 Arial';
    ui.box.appendChild(d);
    return d;
  };

  function buildHUD() {
    ui.box = Object.assign(document.createElement('div'),
      {style:'position:fixed;top:50px;left:10px;z-index:9999'});
    ui.cont    = line('Continent: N/A');
    ui.country = line('Country:   N/A');
    ui.state   = line('State:     N/A');
    ui.city    = line('City:      N/A');

    const wrap = Object.assign(document.createElement('div'),
      {style:'position:relative;margin-top:4px'});
    ui.map = Object.assign(document.createElement('img'),
      {style:'display:block;width:500px;height:300px;border:2px solid #333;border-radius:6px'});
    wrap.appendChild(ui.map);

    ['+','−'].forEach((s,i)=>{
      const b = Object.assign(document.createElement('div'), {
        textContent:s,
        style:`position:absolute;top:8px;right:${i?40:8}px;width:24px;height:24px;line-height:24px;text-align:center;background:rgba(0,0,0,.7);color:#fff;border-radius:3px;cursor:pointer`
      });
      b.onclick = () => { zoom = Math.min(20,Math.max(1,zoom+(s==='+'?1:-1))); drawMap(); };
      wrap.appendChild(b);
    });

    ui.box.appendChild(wrap);
    document.body.appendChild(ui.box);
    drawMap();
  }

  /* ── Coordinate parsing ─────────────────────────────────── */
  const parseCoords = txt => {
    let m;
    if ((m = txt.match(/-?\d+\.\d+,-?\d+\.\d+/)))
      return m[0].split(',').map(Number);
    if ((m = txt.match(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/)))
      return [+m[1], +m[2]];
    if ((m = txt.match(/"lat":\s*(-?\d+\.\d+).*?"lng":\s*(-?\d+\.\d+)/)))
      return [+m[1], +m[2]];
  };

  const setFrom = txt => { const c=parseCoords(txt); c && setPos(c[0],c[1]); };

  /* ── Set position & refresh ─────────────────────────────── */
  function setPos(lat, lon) {
    if (Math.abs(lat-pos.lat)<1e-6 && Math.abs(lon-pos.lon)<1e-6) return;
    pos.lat = lat; pos.lon = lon;
    refresh();
  }

  /* ── Main refresh ───────────────────────────────────────── */
  async function refresh() {
    if (!pos.lat) return;

    const key = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;   // 10-m grid
    let rev = cache.rev[key];
    if (!rev) {
      rev = await jFetch(api.geo(`reverse.php?lat=${pos.lat}&lon=${pos.lon}&format=json&normalizeaddress=1`));
      if (rev?.address) cache.rev[key] = rev;
      else return;                                              // API fail
    }
    const a = rev.address;

    /* Basic fields ------------------------------------------ */
    const country = a.country || a.country_name || '';
    const state   = a.state || a.region || a.province || a.state_district || a.county || '';
    const city    = bestCity(a);

    /* ISO + Continent --------------------------------------- */
    let iso = (a.country_code || '').toUpperCase();
    if (!iso && ISO_FALLBACK[country]) iso = ISO_FALLBACK[country];

    if (!iso) {
      cache.cont.__tmp = roughContinent(pos.lat, pos.lon);
      iso = '__tmp';
    }
    if (!cache.cont[iso] || cache.cont[iso] === 'N/A') {
      const r = await jFetch(`https://restcountries.com/v3.1/alpha/${iso}`);
      const cont = r?.[0]?.continents?.[0] || roughContinent(pos.lat, pos.lon);
      cache.cont[iso] = cont;
    }
    const continent = cache.cont[iso];

    /* Country centroid (once) -------------------------------- */
    if (!cache.cen[country]) cache.cen[country] = await centroid(country) || {lat: pos.lat, lon: pos.lon};

    /* Continent centroid ------------------------------------ */
    if (!cache.contCent[continent]) {
      const c = CONT[continent];
      cache.contCent[continent] = c ? {lat:c.clat, lon:c.clon} : {lat:pos.lat, lon:pos.lon};
    }

    /* Directions -------------------------------------------- */
    const contCent = cache.contCent[continent];
    const countryCent = cache.cen[country];
    const contDir = ` (${dir(contCent.lat, contCent.lon, countryCent.lat, countryCent.lon, 0.1)})`;
    let cityDir = '';
    if (city) {
      if (!cache.cen[`${city},${country}`])
        cache.cen[`${city},${country}`] = await centroid(`${city}, ${country}`) || {lat: pos.lat, lon: pos.lon};
      const cityCent = cache.cen[`${city},${country}`];
      cityDir = ` (${dir(countryCent.lat, countryCent.lon, cityCent.lat, cityCent.lon, 0.05)})`;
    }

    /* HUD update -------------------------------------------- */
    ui.cont.textContent    = `Continent: ${continent}`;
    ui.country.textContent = `Country:   ${country || 'N/A'}${contDir}`;
    ui.state.textContent   = `State:     ${state || 'N/A'}`;
    ui.city.textContent    = `City:      ${city || 'N/A'}${cityDir}`;
    drawMap();
  }

  /* ── Hooks ------------------------------------------------- */
  XMLHttpRequest.prototype.open = new Proxy(XMLHttpRequest.prototype.open, {
    apply(o,xhr,args){const[m,u]=args;
      if(m==='POST' && u.includes('MapsJsInternalService'))
        xhr.addEventListener('load',()=>setFrom(xhr.responseText));
      return o.apply(xhr,args);}
  });

  const _fetch = window.fetch;
  window.fetch = function (...a) {
    return _fetch.apply(this,a).then(res=>{
      if (res.url.includes('MapsJsInternalService') || res.url.includes('/maps/'))
        res.clone().text().then(setFrom).catch(()=>{});
      return res;
    });
  };

  /* OpenGuessr polling */
  if (location.hostname.includes('openguessr.com')) {
    setInterval(()=>{
      const ifr=document.getElementById('PanoramaIframe'); if(!ifr||!ifr.src) return;
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

  /* Init */
  if (document.body) buildHUD(); else addEventListener('DOMContentLoaded', buildHUD);
})();
