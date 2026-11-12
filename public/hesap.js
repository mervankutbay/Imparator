// İmparator — hesaplar (uygulama ve sunucu aynı dosyayı kullanır)
// Kâr hesabı aracı kurumlardaki gibi ORTALAMA MALİYET ile:
//   Alış      : adet artar, maliyete (adet × fiyat + komisyon) eklenir
//   Satış     : satılan adedin ortalama maliyeti düşülür; kâr = (adet × fiyat − komisyon) − ortalama maliyet × adet
//   Bedelsiz  : adet artar, maliyet değişmez (ortalama maliyet düşer)
//   Temettü   : nakit kâr olarak eklenir (Fiyat sütununa net tutar yazılır)

export const TURLER = ['Alış', 'Satış', 'Bedelsiz', 'Temettü'];

// Sayı okuma: "1.250,50" / "1250.5" / 1250.5 hepsi olur
export function sayi(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[₺\s]/g, '').trim();
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
export const kodTemiz = k => String(k || '').toLocaleUpperCase('tr').replace(/\.IS$/i, '').replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, '').replace(/İ/g, 'I').slice(0, 12);

// İşlemleri tarih sırasına koyar (aynı gün: girilme sırası)
export const sirala = l => [...l].sort((a, b) => String(a.Tarih).localeCompare(String(b.Tarih)) || String(a.Kayit || '').localeCompare(String(b.Kayit || '')));

export function hesapla(islemler, fiyatlar = {}) {
  const poz = {}, satisKar = {}, uyarilar = [];
  let gerceklesen = 0, temettu = 0;
  for (const i of sirala(islemler)) {
    const kod = kodTemiz(i.Hisse), adet = sayi(i.Adet), fiyat = sayi(i.Fiyat), kom = sayi(i.Komisyon);
    if (!kod) continue;
    const p = poz[kod] || (poz[kod] = { kod, adet: 0, maliyet: 0, gerceklesen: 0, temettu: 0, ilkTarih: i.Tarih, islemSay: 0 });
    p.islemSay++;
    if (i.Tur === 'Alış') { if (p.adet <= 1e-9) { p.adet = 0; p.maliyet = 0; p.ilkTarih = i.Tarih; } p.adet += adet; p.maliyet += adet * fiyat + kom; }
    else if (i.Tur === 'Satış') {
      const s = Math.min(adet, p.adet);
      if (adet - p.adet > 1e-9) uyarilar.push(`${kod}: ${i.Tarih} tarihinde elde ${p.adet} adet varken ${adet} adet satış girilmiş`);
      const ort = p.adet > 0 ? p.maliyet / p.adet : 0;
      const kar = (adet * fiyat - kom) - ort * s;
      p.maliyet -= ort * s; p.adet -= s; p.gerceklesen += kar; gerceklesen += kar;
      satisKar[i.Kimlik] = { kar, ortMaliyet: ort, yuzde: ort * s ? kar / (ort * s) * 100 : 0 };
      if (p.adet < 1e-9) { p.adet = 0; p.maliyet = 0; }
    } else if (i.Tur === 'Bedelsiz') { p.adet += adet; }
    else if (i.Tur === 'Temettü') { const t = fiyat - kom; p.temettu += t; p.gerceklesen += t; gerceklesen += t; temettu += t; satisKar[i.Kimlik] = { kar: t }; }
  }
  const acik = Object.values(poz).filter(p => p.adet > 1e-9).map(p => {
    const f = fiyatlar[p.kod];
    const fiyat = f && f.fiyat > 0 ? f.fiyat : null;
    const ort = p.maliyet / p.adet;
    const deger = fiyat !== null ? p.adet * fiyat : p.maliyet;
    const kar = fiyat !== null ? deger - p.maliyet : 0;
    return { ...p, ort, fiyat, deger, kar, karYuzde: p.maliyet ? kar / p.maliyet * 100 : 0, bugun: fiyat !== null && f.onceki ? p.adet * (fiyat - f.onceki) : 0, degisim: f?.degisim ?? 0, ad: f?.ad || '' };
  }).sort((a, b) => b.deger - a.deger);
  const kapali = Object.values(poz).filter(p => p.adet <= 1e-9 && (p.gerceklesen || p.temettu));
  const toplamDeger = acik.reduce((s, p) => s + p.deger, 0), toplamMaliyet = acik.reduce((s, p) => s + p.maliyet, 0);
  const acikKar = acik.reduce((s, p) => s + p.kar, 0), bugun = acik.reduce((s, p) => s + p.bugun, 0);
  return { acik, kapali, toplamDeger, toplamMaliyet, acikKar, acikYuzde: toplamMaliyet ? acikKar / toplamMaliyet * 100 : 0, gerceklesen, temettu, toplamKar: acikKar + gerceklesen, bugun, satisKar, uyarilar };
}

// Bir yıl içindeki gerçekleşen kâr (yıllık özet için)
export function yilKar(islemler, yil) {
  const h = hesapla(islemler);
  return sirala(islemler).filter(i => String(i.Tarih).startsWith(String(yil)) && h.satisKar[i.Kimlik]).reduce((s, i) => s + h.satisKar[i.Kimlik].kar, 0);
}

// ---------- Tavan / taban ----------
// Borsa İstanbul pay piyasası fiyat adımları (fiyat seviyesine göre)
export function fiyatAdimi(f) { return f < 20 ? 0.01 : f < 50 ? 0.02 : f < 100 ? 0.05 : f < 250 ? 0.1 : f < 500 ? 0.25 : f < 1000 ? 0.5 : f < 2500 ? 1 : 2.5; }
const yuvarla = (x, a, yon) => { const n = x / a; const r = yon < 0 ? Math.floor(n + 1e-9) : Math.ceil(n - 1e-9); return +(r * a).toFixed(2); };
// Tavan: baz × (1 + marj), fiyat adımına AŞAĞI; taban: baz × (1 − marj), fiyat adımına YUKARI yuvarlanır
export function tavanTaban(baz, marj = 10) {
  const hamT = baz * (1 + marj / 100), hamB = baz * (1 - marj / 100);
  return { tavan: yuvarla(hamT, fiyatAdimi(hamT), -1), taban: yuvarla(hamB, fiyatAdimi(hamB), 1) };
}

// BIST'te sık işlem gören hisseler (arama önerisi için; listede olmayan kod da yazılabilir)
export const BIST = [
  ['AEFES', 'Anadolu Efes'], ['AGHOL', 'Anadolu Grubu Holding'], ['AKBNK', 'Akbank'], ['AKSA', 'Aksa Akrilik'], ['AKSEN', 'Aksa Enerji'], ['ALARK', 'Alarko Holding'], ['ALFAS', 'Alfa Solar'],
  ['ALTNY', 'Altınay Savunma'], ['ANSGR', 'Anadolu Sigorta'], ['ARCLK', 'Arçelik'], ['ASELS', 'Aselsan'], ['ASTOR', 'Astor Enerji'], ['BERA', 'Bera Holding'], ['BIMAS', 'BİM Mağazalar'],
  ['BRSAN', 'Borusan Boru'], ['BRYAT', 'Borusan Yatırım'], ['BTCIM', 'Batıçim'], ['CANTE', 'Çan2 Termik'], ['CCOLA', 'Coca-Cola İçecek'], ['CIMSA', 'Çimsa'], ['CLEBI', 'Çelebi'],
  ['CWENE', 'CW Enerji'], ['DOAS', 'Doğuş Otomotiv'], ['DOHOL', 'Doğan Holding'], ['DSTKF', 'Destek Faktoring'], ['ECILC', 'Eczacıbaşı İlaç'], ['EGEEN', 'Ege Endüstri'], ['EKGYO', 'Emlak Konut GYO'],
  ['ENERY', 'Enerya Enerji'], ['ENJSA', 'Enerjisa'], ['ENKAI', 'Enka İnşaat'], ['EREGL', 'Ereğli Demir Çelik'], ['EUPWR', 'Europower Enerji'], ['FROTO', 'Ford Otosan'], ['GARAN', 'Garanti BBVA'],
  ['GESAN', 'Girişim Elektrik'], ['GRSEL', 'Gür-Sel Turizm'], ['GUBRF', 'Gübre Fabrikaları'], ['HALKB', 'Halkbank'], ['HEKTS', 'Hektaş'], ['ISCTR', 'İş Bankası (C)'], ['ISMEN', 'İş Yatırım'],
  ['KCAER', 'Kocaer Çelik'], ['KCHOL', 'Koç Holding'], ['KONTR', 'Kontrolmatik'], ['KONYA', 'Konya Çimento'], ['KOZAA', 'Koza Madencilik'], ['KOZAL', 'Koza Altın'], ['KRDMD', 'Kardemir (D)'],
  ['KTLEV', 'Katılımevim'], ['MAVI', 'Mavi Giyim'], ['MGROS', 'Migros'], ['MIATK', 'Mia Teknoloji'], ['MPARK', 'MLP Sağlık'], ['OBAMS', 'Oba Makarnacılık'], ['ODAS', 'Odaş Elektrik'],
  ['OTKAR', 'Otokar'], ['OYAKC', 'Oyak Çimento'], ['PASEU', 'Pasifik Eurasia'], ['PETKM', 'Petkim'], ['PGSUS', 'Pegasus'], ['QUAGR', 'Qua Granite'], ['REEDR', 'Reeder Teknoloji'],
  ['SAHOL', 'Sabancı Holding'], ['SASA', 'Sasa Polyester'], ['SDTTR', 'SDT Uzay'], ['SISE', 'Şişecam'], ['SKBNK', 'Şekerbank'], ['SMRTG', 'Smart Güneş'], ['SOKM', 'Şok Marketler'],
  ['TABGD', 'TAB Gıda'], ['TAVHL', 'TAV Havalimanları'], ['TCELL', 'Turkcell'], ['THYAO', 'Türk Hava Yolları'], ['TKFEN', 'Tekfen Holding'], ['TOASO', 'Tofaş'], ['TSKB', 'TSKB'],
  ['TTKOM', 'Türk Telekom'], ['TTRAK', 'Türk Traktör'], ['TUKAS', 'Tukaş'], ['TUPRS', 'Tüpraş'], ['TURSG', 'Türkiye Sigorta'], ['ULKER', 'Ülker'], ['VAKBN', 'Vakıfbank'],
  ['VESBE', 'Vestel Beyaz Eşya'], ['VESTL', 'Vestel'], ['YEOTK', 'Yeo Teknoloji'], ['YKBNK', 'Yapı Kredi'], ['ZOREN', 'Zorlu Enerji'], ['AKSGY', 'Akiş GYO'], ['ISGYO', 'İş GYO'],
  ['KLSER', 'Kaleseramik'], ['LMKDC', 'Limak Doğu Anadolu Çimento'], ['TUREX', 'Tureks Turizm'], ['BINHO', '1000 Yatırımlar'], ['RALYH', 'Ral Yatırım'], ['GLRMK', 'Gülermak'], ['ENTRA', 'IC Enterra'],
];
export const bistAd = kod => (BIST.find(b => b[0] === kod) || [])[1] || '';
