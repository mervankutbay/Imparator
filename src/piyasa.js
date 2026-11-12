// Piyasa verisi (Yahoo Finance). BIST fiyatları Yahoo'da yaklaşık 15 dakika gecikmelidir.
const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', accept: 'application/json,text/plain,*/*' };
const OZ = 31.1034768;
const zamanAsimi = (p, ms = 6000) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('zaman aşımı')), ms))]);

// Cloudflare ücretsiz planda bir istekte en fazla 50 alt istek yapılabilir: sembol başına tek istek atılır,
// aynı sembol bir kez çekilir, önbellek tüm fiyat listesi için tek kayıt olarak tutulur.
async function json1(url) {
  const r = await zamanAsimi(fetch(url, { headers: UA }));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
export async function yahoo(sembol, gecmis = false) {
  const j = await json1(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sembol)}?range=${gecmis ? '1mo' : '1d'}&interval=${gecmis ? '1d' : '1h'}`);
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
export async function fiyatlar(kodlar = [], { gecmis = false, enFazla = 30 } = {}) {
  const liste = [...new Set(kodlar)].slice(0, enFazla);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request('https://imparator.local/fiyat/' + (gecmis ? 'g/' : '') + encodeURIComponent([...liste].sort().join(',')));
  if (cache) { const h = await cache.match(key).catch(() => null); if (h) return h.json(); }
  const bekleyen = new Map(), al = s => { if (!bekleyen.has(s)) bekleyen.set(s, yahoo(s, gecmis)); return bekleyen.get(s); };   // aynı sembol tek kez
  const piyasa = {}, hisseler = {};
  await Promise.all([
    ...(gecmis ? [] : PIYASA).map(async p => {
      try {
        const f = await al(p.y);
        if (p.gram) { const u = await al('USDTRY=X'); piyasa[p.kod] = { ...p, fiyat: f.fiyat * u.fiyat / OZ, onceki: f.onceki * u.onceki / OZ, kapanislar: [] }; }
        else piyasa[p.kod] = { ...p, fiyat: f.fiyat, onceki: f.onceki, kapanislar: f.kapanislar };
        piyasa[p.kod].degisim = (piyasa[p.kod].fiyat / piyasa[p.kod].onceki - 1) * 100;
      } catch (e) { piyasa[p.kod] = { ...p, hata: String(e.message || e).slice(0, 60) }; }
    }),
    ...liste.map(async kod => {
      try { const f = await al(kod + '.IS'); hisseler[kod] = { fiyat: f.fiyat, onceki: f.onceki, degisim: (f.fiyat / f.onceki - 1) * 100, ad: f.ad, zaman: f.zaman, kapanislar: f.kapanislar }; }
      catch (e) { hisseler[kod] = { hata: String(e.message || e).slice(0, 60) }; }
    }),
  ]);
  const sonuc = { piyasa, hisseler, zaman: new Date().toISOString() };
  if (cache) await cache.put(key, new Response(JSON.stringify(sonuc), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } })).catch(() => {});
  return sonuc;
}
export async function ara(q) {
  const j = await json1(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`);
  return (j.quotes || []).filter(x => /\.IS$/.test(x.symbol || '') && x.quoteType === 'EQUITY').map(x => ({ kod: x.symbol.replace(/\.IS$/, ''), ad: x.longname || x.shortname || '' }));
}
