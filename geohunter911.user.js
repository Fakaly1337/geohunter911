// ==UserScript==
// @name         GeoHunter911 HUD
// @namespace    Fakaly1337
// @version      2025-06-21b
// @description  Kontinent/Land/State/Stadt + Yandex-Minimap. API erst nach Druck auf „Q“.
// @match        https://www.geoguessr.com/*
// @match        https://openguessr.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/Fakaly1337/geohunter911/main/geohunter911.user.js
// @downloadURL  https://raw.githubusercontent.com/Fakaly1337/geohunter911/main/geohunter911.user.js
// ==/UserScript==

(() => {
  'use strict';

  /* Konstanten -------------------------------------------------- */
  const IQ  = 'pk.8a4add797b142c1faca647ddf8d6b000';
  const GEO = p => `https://us1.locationiq.com/v1/${p}&key=${IQ}`;
  const MAP = (lat, lon, z) =>
    `https://static-maps.yandex.ru/1.x/?ll=${lon},${lat}&z=${z}&size=500,300&l=map&pt=${lon},${lat},pm2rdm&lang=en_US`;

  /* State ------------------------------------------------------- */
  const latest = { lat: 0, lon: 0, ready: false };
  const shown  = { lat: 0, lon: 0 };
  let zoom     = 13;
  const cache  = { cont: {}, cen: {}, rev: {} };
  const ui     = {};

  /* Helpers ----------------------------------------------------- */
  const jFetch = url =>
    new Promise(res => GM_xmlhttpRequest({
      url,
      onload: r => res(JSON.parse(r.responseText)),
      onerror: () => res(null)
    }));

  const centroid = async q =>
    (cache.cen[q] ??= (await jFetch(GEO(`search.php?q=${encodeURIComponent(q)}&format=json&limit=1`)))?.[0] || null);

  const dir = (aLat, aLon, bLat, bLon, eps = 0.05) => {
    const dLat = bLat - aLat, dLon = bLon - aLon;
    return (Math.abs(dLat) > eps ? (dLat > 0 ? 'N' : 'S') : '') +
           (Math.abs(dLon) > eps ? (dLon > 0 ? 'E' : 'W') : '') || 'Ctr';
  };

  /* HUD --------------------------------------------------------- */
  const line = t => {
    const d = document.createElement('div');
    d.textContent = t;
    d.style.cssText =
      'color:#fff;background:rgba(0,0,0,.7);padding:5px 8px;border-radius:4px;margin:2px 0;font:14px/1 Arial';
    ui.box.appendChild(d);
    return d;
  };

  function buildHUD() {
    ui.box = Object.assign(document.createElement('div'),
      { style: 'position:fixed;top:50px;left:10px;z-index:9999' });

    ui.cont    = line('Continent: N/A');
    ui.country = line('Country:   N/A');
    ui.state   = line('State:     N/A');
    ui.city    = line('City:      N/A');

    const wrap = Object.assign(document.createElement('div'),
      { style: 'position:relative;margin-top:4px' });

    ui.map = Object.assign(document.createElement('img'), {
      style: 'display:block;width:500px;height:300px;border:2px solid #333;border-radius:6px'
    });
    wrap.appendChild(ui.map);

    ['+','−'].forEach((s,i) => {
      const b = Object.assign(document.createElement('div'), {
        textContent: s,
        style:
          `position:absolute;top:8px;right:${i?40:8}px;width:24px;height:24px;line-height:24px;` +
          'text-align:center;background:rgba(0,0,0,.7);color:#fff;border-radius:3px;cursor:pointer'
      });
      b.onclick = () => {
        zoom = Math.min(20, Math.max(1, zoom + (s === '+' ? 1 : -1)));
        ui.map.src = MAP(shown.lat, shown.lon, zoom);
      };
      wrap.appendChild(b);
    });

    ui.box.appendChild(wrap);
    document.body.appendChild(ui.box);
  }

  if (document.body) buildHUD();
  else document.addEventListener('DOMContentLoaded', buildHUD);

  /* --- zentrale Koord-Extraktion -------------------------------- */
function extract(txt) {
  let lat, lon;

  // alter Treffer  "12.34,56.78"
  let m = txt.match(/-?\d+\.\d+,-?\d+\.\d+/);
  if (m) [lat, lon] = m[0].split(',').map(Number);

  // neues gMaps-Pattern "!1dLAT!2dLON"
  if (!lat) {
    m = txt.match(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/);
    if (m) { lat = +m[1]; lon = +m[2]; }
  }

  if (!isNaN(lat) && !isNaN(lon)) {
    latest.lat = lat;
    latest.lon = lon;
    latest.ready = true;
  }
}

/* --- GeoGuessr: XHR-Sniffer ----------------------------------- */
XMLHttpRequest.prototype.open = new Proxy(XMLHttpRequest.prototype.open, {
  apply(orig, xhr, args) {
    const [m, url] = args;
    if (m === 'POST' && url.includes('MapsJsInternalService')) {
      xhr.addEventListener('load', () => extract(xhr.responseText));
    }
    return orig.apply(xhr, args);
  }
});

/* --- GeoGuessr: fetch-Sniffer --------------------------------- */
const origFetch = window.fetch;
window.fetch = function (...a) {
  return origFetch.apply(this, a).then(res => {
    if (res.url.includes('MapsJsInternalService') || res.url.includes('/maps/')) {
      res.clone().text().then(extract).catch(()=>{});
    }
    return res;
  });
};


  /* OpenGuessr: Iframe-Polling ---------------------------------- */
  if (location.hostname.includes('openguessr.com')) {
    setInterval(() => {
      const ifr = document.querySelector('#PanoramaIframe'); if (!ifr || !ifr.src) return;
      let loc = '';
      try {
        const u = new URL(ifr.src);
        loc = u.searchParams.get('location') || u.searchParams.get('viewpoint') || '';
        if (!loc) {
          const m = ifr.src.match(/(?:location|viewpoint)=([^&]+)/);
          if (m) loc = decodeURIComponent(m[1]);
        }
      } catch {}
      if (loc) {
        const [lat, lon] = loc.split(/[ ,]/).map(Number);
        if (!isNaN(lat) && !isNaN(lon)) {
          latest.lat = lat; latest.lon = lon; latest.ready = true;
        }
      }
    }, 1000);
  }

  /* Hotkey "Q" – löst API-Calls aus ----------------------------- */
  document.addEventListener('keydown', async e => {
    if (e.key.toLowerCase() !== 'q' || !latest.ready) return;

    const id = `${latest.lat.toFixed(5)},${latest.lon.toFixed(5)}`;
    let rev = cache.rev[id];
    if (!rev) {
      rev = await jFetch(GEO(`reverse.php?lat=${latest.lat}&lon=${latest.lon}&format=json`));
      cache.rev[id] = rev;
    }
    if (!rev?.address) return;

    shown.lat = latest.lat; shown.lon = latest.lon;

    const { country = '', state = '', city = '', country_code = '' } = rev.address;
    const iso = country_code.toUpperCase();

    if (!cache.cont[iso]) {
      const r = await jFetch(`https://restcountries.com/v3.1/alpha/${iso}`);
      cache.cont[iso] = r?.[0]?.continents?.[0] || 'N/A';
    }

    let cityInCountry = '', posInCity = '';
    if (country) {
      const cc = await centroid(country);
      if (cc && city) {
        const ci = await centroid(`${city}, ${country}`);
        if (ci) {
          cityInCountry = ` (${dir(+cc.lat, +cc.lon, +ci.lat, +ci.lon, 0.05)})`;
          posInCity     = ` (${dir(+ci.lat, +ci.lon, shown.lat, shown.lon, 0.02)})`;
        }
      }
    }

    ui.cont.textContent    = `Continent: ${cache.cont[iso]}`;
    ui.country.textContent = `Country:   ${country || 'N/A'}${cityInCountry}`;
    ui.state.textContent   = `State:     ${state   || 'N/A'}`;
    ui.city.textContent    = `City:      ${city    || 'N/A'}${posInCity}`;
    ui.map.src = MAP(shown.lat, shown.lon, zoom);
  });

})();
