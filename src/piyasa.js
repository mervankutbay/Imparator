// Piyasa verisi (Yahoo Finance). BIST fiyatları Yahoo'da yaklaşık 15 dakika gecikmelidir.
const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', accept: 'application/json,text/plain,*/*' };
const OZ = 31.1034768;
const zamanAsimi = (p, ms = 6000) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('zaman aşımı')), ms))]);

async function onbellekliJson(url, ttl = 60) {
  const cache = typeof caches !== 'undefined' ? caches.default : null, key = new Request(url);
  if (cache) { const hit = await cache.match(key); if (hit) return hit.json(); }
  let son;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await zamanAsimi(fetch(url.replace('://query1.', `://${host}.`), { headers: UA }));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const body = await r.text();
      if (cache) await cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` } })).catch(() => {});
      return JSON.parse(body);
    } catch (e) { son = e; }
  }
  throw son;
}
export async function yahoo(sembol, gecmis = false) {
  const j = await onbellekliJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sembol)}?range=${gecmis ? '1mo' : '1d'}&interval=${gecmis ? '1d' : '5m'}`);
  const res = j?.chart?.result?.[0], m = res?.meta;
  if (!m || !(m.regularMarketPrice > 0)) throw new Error('fiyat yok');
  const kapanislar = gecmis ? (res.indicators?.quote?.[0]?.close || []).filter(x => x > 0) : [];
  return { fiyat: m.regularMarketPrice, onceki: m.chartPreviousClose || m.previousClose || m.regularMarketPrice, ad: m.longName || m.shortName || '', para: m.currency || '', zaman: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null, kapanislar };
}

// Piyasa ekranının sabit listesi
export const PIYASA = [
  { kod: 'XU100', ad: 'BIST 100', y: 'XU100.IS', grup: 'Borsa İstanbul' },
  { kod: 'XU030', ad: 'BIST 30', y: 'XU030.IS', grup: 'Borsa İstanbul' },
  { kod: 'XBANK', ad: 'BIST Banka', y: 'XBANK.IS', grup: 'Borsa İstanbul' },
  { kod: 'USDTRY', ad: 'Dolar', y: 'USDTRY=X', grup: 'Döviz ve altın', birim: '₺' },
  { kod: 'EURTRY', ad: 'Euro', y: 'EURTRY=X', grup: 'Döviz ve altın', birim: '₺' },
  { kod: 'GRAM', ad: 'Gram altın', y: 'GC=F', grup: 'Döviz ve altın', birim: '₺', gram: true },
  { kod: 'ONS', ad: 'Ons altın', y: 'GC=F', grup: 'Döviz ve altın', birim: '$' },
  { kod: 'BRENT', ad: 'Brent petrol', y: 'BZ=F', grup: 'Dünya', birim: '$' },
  { kod: 'SPX', ad: 'S&P 500 (ABD)', y: '^GSPC', grup: 'Dünya' },
  { kod: 'NDX', ad: 'Nasdaq (ABD)', y: '^IXIC', grup: 'Dünya' },
  { kod: 'DAX', ad: 'DAX (Almanya)', y: '^GDAXI', grup: 'Dünya' },
  { kod: 'US10Y', ad: 'ABD 10 yıllık faiz', y: '^TNX', grup: 'Dünya', birim: '%' },
  { kod: 'BTC', ad: 'Bitcoin', y: 'BTC-USD', grup: 'Dünya', birim: '$' },
];

// kodlar: BIST hisse kodları (THYAO…). Dönen: { piyasa: {kod: {...}}, hisseler: {kod: {...}} }
export async function fiyatlar(kodlar = [], { gecmis = false } = {}) {
  const usd = yahoo('USDTRY=X').catch(() => null);
  const piyasa = {}, hisseler = {};
  await Promise.all([
    ...PIYASA.map(async p => {
      try {
        const f = await yahoo(p.y, gecmis);
        if (p.gram) { const u = await usd; if (!u) throw new Error('kur yok'); const k = u.fiyat, ko = u.onceki; piyasa[p.kod] = { ...p, fiyat: f.fiyat * k / OZ, onceki: f.onceki * ko / OZ, kapanislar: [] }; }
        else piyasa[p.kod] = { ...p, fiyat: f.fiyat, onceki: f.onceki, kapanislar: f.kapanislar };
        piyasa[p.kod].degisim = (piyasa[p.kod].fiyat / piyasa[p.kod].onceki - 1) * 100;
      } catch (e) { piyasa[p.kod] = { ...p, hata: String(e.message || e).slice(0, 60) }; }
    }),
    ...[...new Set(kodlar)].slice(0, 60).map(async kod => {
      try { const f = await yahoo(kod + '.IS', gecmis); hisseler[kod] = { fiyat: f.fiyat, onceki: f.onceki, degisim: (f.fiyat / f.onceki - 1) * 100, ad: f.ad, zaman: f.zaman, kapanislar: f.kapanislar }; }
      catch (e) { hisseler[kod] = { hata: String(e.message || e).slice(0, 60) }; }
    }),
  ]);
  return { piyasa, hisseler, zaman: new Date().toISOString() };
}
export async function ara(q) {
  const j = await onbellekliJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`, 3600);
  return (j.quotes || []).filter(x => /\.IS$/.test(x.symbol || '') && x.quoteType === 'EQUITY').map(x => ({ kod: x.symbol.replace(/\.IS$/, ''), ad: x.longname || x.shortname || '' }));
}
