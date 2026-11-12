// İmparator — babanın hisse defteri. Sade, büyük yazılı; veriler Mervan'ın Google Sheet'inde (sunucu üzerinden).
import { hesapla, sayi, kodTemiz, sirala, BIST, bistAd, TURLER, tavanTaban } from './hesap.js';

const SURUM = 'v6';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { al: (k, v) => { try { const x = localStorage.getItem(k); return x === null ? v : JSON.parse(x); } catch { return v; } }, yaz: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* dolu */ } } };
const fmt = (n, k = 2) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: k, maximumFractionDigits: k });
const tl = (n, k) => `${fmt(n, k ?? (Math.abs(n) >= 100000 ? 0 : 2))} ₺`;
const isaretli = (n, k) => `${n >= 0 ? '+' : '−'}${tl(Math.abs(n), k)}`;
const yuzde = n => `%${fmt(Math.abs(n), 2)}`;
const renk = n => n > 0.004 ? 'arti' : n < -0.004 ? 'eksi' : '';
const adetFmt = a => fmt(a, a % 1 ? 2 : 0);
const bugun = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const tarihYaz = t => { const [y, m, g] = String(t).split('-').map(Number); return g ? `${g} ${AYLAR[m - 1]} ${y}` : t; };
const tarihKisa = t => { const [, m, g] = String(t).split('-').map(Number); return g ? `${g} ${AYLAR[m - 1].slice(0, 3)}` : t; };
const app = () => $('#app');

// Bağlantıdaki anahtar (…/?k=…) telefona kaydedilir; adres çubuğunda kalır ki "Ana Ekrana Ekle" ile eklenen uygulama da onu bilsin
const urlAnahtar = new URLSearchParams(location.search).get('k');
if (urlAnahtar) ls.yaz('imp_anahtar', urlAnahtar);
const S = {
  anahtar: ls.al('imp_anahtar', ''), veri: ls.al('imp_veri', null), fiyat: ls.al('imp_fiyat', { piyasa: {}, hisseler: {} }),
  sekme: 'hesap', impSeg: 'analiz', sohbet: ls.al('imp_sohbet', []), mesgul: false,
};

// ---------- Sunucu ----------
async function api(yol, govde) {
  let r;
  try { r = await fetch('/api/' + yol, { method: govde === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-anahtar': S.anahtar }, body: govde === undefined ? undefined : JSON.stringify(govde) }); }
  catch { const e = new Error('İnternet bağlantısı yok'); e.ag = true; throw e; }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.giris) { S.anahtar = ''; ls.yaz('imp_anahtar', ''); anahtarsiz(); throw new Error('Bağlantı geçersiz'); }
  if (!r.ok) throw new Error(j.hata || 'Bağlantı sorunu');
  return j;
}
function veriKoy(v) { S.veri = { islemler: v.islemler || [], analizler: v.analizler || [], takip: v.takip || [], ayar: v.ayar || {} }; bekleyenUygula(); ls.yaz('imp_veri', S.veri); }
// ---------- İnternet yokken yapılan kayıtlar: telefonda bekler, bağlantı gelince deftere yazılır ----------
let dk = ls.al('imp_kuyruk', []);
const kuyrukYaz = () => ls.yaz('imp_kuyruk', dk);
function bekleyenUygula() {
  if (!S.veri || !dk.length) return;
  for (const k of dk) {
    if (k.ekle) k.ekle.forEach(y => { if (!S.veri.islemler.some(i => i.Kimlik === y.Kimlik)) S.veri.islemler.push(y); });
    if (k.duzelt) S.veri.islemler = S.veri.islemler.map(i => i.Kimlik === k.duzelt.Kimlik ? { ...i, ...k.duzelt } : i);
    if (k.sil) S.veri.islemler = S.veri.islemler.filter(i => i.Kimlik !== k.sil);
  }
}
let gonderiliyor = false;
async function kuyrukGonder() {
  if (gonderiliyor || !dk.length || !S.anahtar) return;
  gonderiliyor = true;
  try {
    let son = null;
    while (dk.length) { son = await api('islem', dk[0]); dk.shift(); kuyrukYaz(); }
    if (son) { veriKoy(son); yenidenCiz(); toast('Bekleyen kayıtlar deftere yazıldı ✓'); }
  } catch (e) { if (!e.ag) { toast('Bekleyen bir kayıt yazılamadı: ' + e.message, 5000); dk.shift(); kuyrukYaz(); } }
  finally { gonderiliyor = false; }
}
addEventListener('online', () => kuyrukGonder());
setInterval(() => { if (dk.length && navigator.onLine !== false) kuyrukGonder(); }, 20000);
async function veriYukle() { veriKoy(await api('veri')); }
const kodlar = () => { const h = hesapla(S.veri?.islemler || []); return [...new Set([...h.acik.map(p => p.kod), ...(S.veri?.takip || [])])]; };
let fiyatZaman = 0;
async function fiyatYukle(gecmis = false) {
  const f = await api('fiyat', { kodlar: kodlar(), gecmis });
  S.fiyat = f; fiyatZaman = Date.now(); ls.yaz('imp_fiyat', { piyasa: f.piyasa, hisseler: f.hisseler, zaman: f.zaman });
}
const fiyatlar = () => S.fiyat?.hisseler || {};

// ---------- Ortak arayüz ----------
let toastT;
function toast(m, ms = 2800) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
// ---------- Geri tuşu ve kaydırma (Nébula / Dudestreet gibi) ----------
// Geri: önce açık pencere kapanır; diğer sekmelerden Hesabım'a dönülür (kaldığı yerden); Hesabım'da iki kez basınca çıkılır.
let yoksay = 0, yoksayZaman = 0, geriSon = 0;
const kuyruk = [];
function sira(fn) { kuyruk.push(fn); isle(); }
function isle() {
  if (yoksay > 0 && Date.now() - yoksayZaman > 1500) yoksay = 0;   // gelmeyen bir dönüş kuyruğu kilitlemesin
  while (kuyruk.length && yoksay === 0) kuyruk.shift()();
  if (kuyruk.length) setTimeout(isle, 40);
}
const geriGit = () => sira(() => { yoksay++; yoksayZaman = Date.now(); history.back(); });
const kayitIt = tip => sira(() => history.pushState({ t: tip }, ''));
const kaydirma = {};   // sekme → son kaydırma yeri

// Pencere açıkken arkadaki sayfa kıpırdamasın (iPhone'da da çalışan yöntem)
let kilitY = 0;
function arkaKilit(ac) {
  const b = document.body;
  if (ac && !b.classList.contains('pencere-acik')) { kilitY = scrollY; b.style.top = `-${kilitY}px`; b.classList.add('pencere-acik'); }
  if (!ac && b.classList.contains('pencere-acik')) { b.classList.remove('pencere-acik'); b.style.top = ''; scrollTo(0, kilitY); }
}

// Alttan açılan pencere: dışına dokununca, aşağı kaydırınca ya da geri tuşuyla kapanır
function pencere(html) {
  const perde = document.createElement('div'); perde.className = 'perde';
  perde.innerHTML = `<div class="pencere" role="dialog" aria-modal="true"><div class="tutamac"></div>${html}</div>`;
  document.body.appendChild(perde); arkaKilit(true);
  const ic = perde.firstElementChild;
  let kapandi = false, itildi = false, iptal = false;
  sira(() => { if (iptal) return; history.pushState({ t: 'pencere' }, ''); itildi = true; });
  const kapat = geriden => {
    if (kapandi) return; kapandi = true; perde.classList.add('kapaniyor');
    ic.style.transition = 'transform .2s ease-in'; ic.style.transform = 'translateY(105%)'; perde.style.transition = 'opacity .2s'; perde.style.opacity = '0';
    setTimeout(() => { perde.remove(); if (!$('.perde')) arkaKilit(false); }, 190);
    if (!$('.perde:not(.kapaniyor)')) yenidenCiz();
    if (!itildi) { iptal = true; return; }
    if (!geriden) geriGit();
  };
  perde.addEventListener('click', e => { if (e.target === perde) kapat(); });
  kaydirKapat(ic, () => kapat());
  perde._kapat = kapat;
  ic.kapat = () => kapat();
  return ic;
}
// Pencereyi tutamaçtan (ya da en üstteyken içerikten) aşağı çekince kapat
function kaydirKapat(ic, kapat) {
  let y0 = null, dy = 0, t0 = 0, aktif = false;
  ic.addEventListener('touchstart', e => {
    const ust = e.touches[0].clientY - ic.getBoundingClientRect().top < 48;
    if ((!ust && ic.scrollTop > 0) || (!ust && e.target.closest('input, textarea, select'))) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); aktif = false;
  }, { passive: true });
  ic.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 6 && (ic.scrollTop <= 0 || aktif)) { aktif = true; if (e.cancelable) e.preventDefault(); ic.style.transition = 'none'; ic.style.transform = `translateY(${dy}px)`; }
  }, { passive: false });
  ic.addEventListener('touchend', () => {
    if (y0 === null || !aktif) { y0 = null; return; }
    if (dy > 110 || dy / Math.max(1, Date.now() - t0) > 0.6) kapat();
    else { ic.style.transition = 'transform .2s ease-out'; ic.style.transform = ''; }
    y0 = null; aktif = false;
  });
}
addEventListener('popstate', () => {
  if (yoksay > 0) { yoksay--; isle(); return; }
  const p = $$('.perde:not(.kapaniyor)').pop();
  if (p) { p._kapat(true); return; }
  if (S.sekme !== 'hesap') { sekmeGit('hesap', true); return; }
  if (Date.now() - geriSon < 2200) { history.back(); return; }
  geriSon = Date.now(); toast('Çıkmak için bir kez daha geri bas');
  kayitIt('uygulama');
});
function onay(baslik, metin, evet, { evetYazi = 'Evet', tehlike = false } = {}) {
  const p = pencere(`<h2>${esc(baslik)}</h2>${metin ? `<p class="soluk">${esc(metin)}</p>` : ''}<div class="iki-btn"><button class="btn ikinci" data-h>Vazgeç</button><button class="btn ${tehlike ? 'sat' : ''}" data-e>${esc(evetYazi)}</button></div>`);
  $('[data-h]', p).onclick = () => p.kapat();
  $('[data-e]', p).onclick = () => { p.kapat(); evet(); };
}
const SVG = {
  kamera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  mikrofon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  gonder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
};

// ---------- Anahtar: şifre yok; telefon bir kez özel bağlantıyla (…/?k=…) açılır ----------
function anahtarsiz() {
  $('#ust').classList.add('hidden'); $('#sekmeler').classList.add('hidden'); $('.yazma')?.remove();
  app().innerHTML = `<div class="giris"><img class="avatar" src="img/aydin.png" alt=""><h1>İmparator</h1>
    <p class="soluk">Bu uygulamayı açmak için Mervan’ın gönderdiği bağlantıya dokun.</p></div>`;
}

// ---------- Sekmeler ----------
const SAYFA = { hesap: hesapSayfasi, defter: defterSayfasi, hesapla: hesaplaSayfasi, piyasa: piyasaSayfasi, imparator: imparatorSayfasi };
function sekmeGit(s, geriden = false) {
  if (s === S.sekme) { scrollTo({ top: 0, behavior: 'smooth' }); return; }   // aynı sekmeye dokununca başa dön
  kaydirma[S.sekme] = scrollY;
  if (!geriden) { if (S.sekme === 'hesap') kayitIt('sekme'); else if (s === 'hesap') geriGit(); }
  S.sekme = s; ciz();
  // Hesabım'a dönünce kaldığı yerden, diğer sekmeler baştan açılır
  const y = s === 'hesap' ? (kaydirma.hesap || 0) : 0;
  requestAnimationFrame(() => scrollTo(0, s === 'imparator' && S.impSeg === 'sohbet' ? document.body.scrollHeight : y));
}
function ciz() {
  $('#ust').classList.remove('hidden'); $('#sekmeler').classList.remove('hidden');
  $$('#sekmeler button').forEach(b => b.classList.toggle('on', b.dataset.s === S.sekme));
  if (S.sekme !== 'imparator' || S.impSeg !== 'sohbet') $('.yazma')?.remove();
  SAYFA[S.sekme]();
}
// Açık pencere yoksa sayfayı yeniden çizer (pencere kapanırken de çizilir; kaydırma yeri korunur)
function yenidenCiz() { if ($('.perde:not(.kapaniyor)')) return; if (document.body.classList.contains('pencere-acik')) { SAYFA[S.sekme](); return; } const y = scrollY; SAYFA[S.sekme](); scrollTo(0, y); }

// ---------- Hesabım ----------
function hesapSayfasi() {
  const islemler = S.veri?.islemler || [], h = hesapla(islemler, fiyatlar());
  const yil = bugun().slice(0, 4), yilKar = sirala(islemler).filter(i => String(i.Tarih).startsWith(yil) && h.satisKar[i.Kimlik]).reduce((s, i) => s + h.satisKar[i.Kimlik].kar, 0);
  const fz = S.fiyat?.zaman ? new Date(S.fiyat.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : null;
  app().innerHTML = `
    <div class="kart">
      <div class="soluk kucuk">Portföyüm</div>
      <div class="dev say">${tl(h.toplamDeger, 0)}</div>
      <div class="ikili">
        <div><span class="soluk kucuk">Kâr / zarar</span><b class="say ${renk(h.acikKar)}">${isaretli(h.acikKar, 0)}</b><span class="hap ${renk(h.acikKar)}">${h.acikKar >= 0 ? '▲' : '▼'} ${yuzde(h.acikYuzde)}</span></div>
        <div><span class="soluk kucuk">Bugün</span><b class="say ${renk(h.bugun)}">${isaretli(h.bugun, 0)}</b></div>
      </div>
    </div>
    <div class="iki-btn"><button class="btn al" id="aldim">＋ Aldım</button><button class="btn sat" id="sattim">－ Sattım</button></div>
    ${dk.length ? `<div class="uyari">⏳ ${dk.length} kayıt internet bekliyor; bağlanınca deftere yazılacak.</div>` : ''}
    ${h.uyarilar.map(u => `<div class="uyari">⚠️ ${esc(u)}</div>`).join('')}
    <div class="baslik">Hisselerim</div>
    ${h.acik.length ? `<div class="liste">${h.acik.map(p => `
      <button class="oge tikla" data-poz="${p.kod}">
        <div class="ust-sira"><span class="kod">${p.kod}</span><span class="deger say">${tl(p.deger, 0)}</span></div>
        <div class="ust-sira poz-orta"><span class="say">${adetFmt(p.adet)} adet × ${p.fiyat ? fmt(p.fiyat) : '—'}</span><b class="say ${renk(p.kar)}">${isaretli(p.kar, 0)}</b></div>
        <div class="alt-sira"><span class="say">Ort. ${fmt(p.ort)}${p.fiyat ? ` · bugün <span class="${renk(p.degisim)}">${p.degisim >= 0 ? '▲' : '▼'}${yuzde(p.degisim)}</span>` : ''}</span><span class="say ${renk(p.kar)}">${p.kar >= 0 ? '+' : '−'}${yuzde(p.karYuzde)}</span></div>
      </button>`).join('')}</div>` : `<div class="kart bos">Henüz hisse yok.<br>“Aldım” ile ilk alışını gir ya da İmparator’a defter sayfanın fotoğrafını gönder.</div>`}
    <div class="baslik">Gerçekleşen kâr</div>
    <div class="kart">
      <div class="ozet-satir"><span>${yil} yılı</span><b class="say ${renk(yilKar)}">${isaretli(yilKar, 0)}</b></div>
      <div class="ozet-satir"><span>Toplam (satışlar + temettü)</span><b class="say ${renk(h.gerceklesen)}">${isaretli(h.gerceklesen, 0)}</b></div>
      ${h.kapali.length ? `<div class="soluk kucuk" style="margin-top:6px">Kapanan: ${h.kapali.map(p => `${p.kod} <span class="${renk(p.gerceklesen)}">${isaretli(p.gerceklesen, 0)}</span>`).join(' · ')}</div>` : ''}
    </div>
    <div class="zaman">${fz ? `Fiyatlar ${fz} · BIST 15 dk gecikmeli` : 'Fiyatlar yükleniyor…'}</div>`;
  $('#aldim').onclick = () => islemFormu({ Tur: 'Alış' });
  $('#sattim').onclick = () => islemFormu({ Tur: 'Satış' });
  $$('[data-poz]').forEach(b => b.onclick = () => pozisyonDetay(b.dataset.poz));
}

function pozisyonDetay(kod) {
  const islemler = S.veri.islemler, h = hesapla(islemler, fiyatlar()), p = h.acik.find(x => x.kod === kod);
  const ilgili = sirala(islemler.filter(i => i.Hisse === kod)).reverse();
  const w = pencere(`<h2>${kod} <span class="soluk kucuk">${esc(p?.ad || bistAd(kod))}</span></h2>
    ${p ? `<div class="kart" style="margin-top:0">
      <div class="ozet-satir"><span class="soluk">Adet</span><b class="say">${adetFmt(p.adet)}</b></div>
      <div class="ozet-satir"><span class="soluk">Ortalama maliyet</span><b class="say">${fmt(p.ort)} ₺</b></div>
      <div class="ozet-satir"><span class="soluk">Son fiyat</span><b class="say">${p.fiyat ? fmt(p.fiyat) + ' ₺' : '—'}</b></div>
      <div class="ozet-satir"><span class="soluk">Değer</span><b class="say">${tl(p.deger)}</b></div>
      <div class="ozet-satir"><span class="soluk">Kâr / zarar</span><b class="say ${renk(p.kar)}">${isaretli(p.kar)} (${p.kar >= 0 ? '+' : '−'}${yuzde(p.karYuzde)})</b></div>
      ${p.gerceklesen ? `<div class="ozet-satir"><span class="soluk">Bu hisseden gerçekleşen</span><b class="say ${renk(p.gerceklesen)}">${isaretli(p.gerceklesen)}</b></div>` : ''}
    </div>` : ''}
    <div class="iki-btn"><button class="btn al" data-al>＋ Aldım</button><button class="btn sat" data-sat>－ Sattım</button></div>
    <div class="baslik">İşlemleri</div><div class="liste">${ilgili.map(i => islemSatiri(i, h)).join('')}</div>`);
  $('[data-al]', w).onclick = () => { w.kapat(); setTimeout(() => islemFormu({ Tur: 'Alış', Hisse: kod }), 50); };
  $('[data-sat]', w).onclick = () => { w.kapat(); setTimeout(() => islemFormu({ Tur: 'Satış', Hisse: kod }), 50); };
  $$('[data-islem]', w).forEach(b => b.onclick = () => { w.kapat(); setTimeout(() => islemFormu(S.veri.islemler.find(i => i.Kimlik === b.dataset.islem)), 50); });
}

// ---------- Defter ----------
function islemSatiri(i, h) {
  const k = h.satisKar[i.Kimlik], tutar = i.Tur === 'Temettü' ? i.Fiyat : i.Adet * i.Fiyat;
  return `<button class="oge tikla" data-islem="${esc(i.Kimlik)}">
    <div class="ust-sira"><span><span class="tur ${i.Tur}">${i.Tur}</span> <span class="kod">${esc(i.Hisse)}</span></span><span class="deger say">${i.Tur === 'Bedelsiz' ? '+' + adetFmt(i.Adet) + ' adet' : tl(tutar)}</span></div>
    <div class="alt-sira"><span class="say">${tarihKisa(i.Tarih)}${i.Tur === 'Alış' || i.Tur === 'Satış' ? ` · ${adetFmt(i.Adet)} × ${fmt(i.Fiyat)}` : ''}${i.Komisyon ? ` · kom. ${fmt(i.Komisyon)}` : ''}</span>${k && i.Tur === 'Satış' ? `<b class="say ${renk(k.kar)}">${isaretli(k.kar, 0)}</b>` : ''}</div>
    ${i.Not ? `<div class="alt-sira"><span>${esc(i.Not)}</span></div>` : ''}
  </button>`;
}
function defterSayfasi() {
  const islemler = S.veri?.islemler || [], h = hesapla(islemler, fiyatlar());
  const l = sirala(islemler).reverse(), gruplar = [];
  l.forEach(i => { const a = String(i.Tarih).slice(0, 7); let g = gruplar[gruplar.length - 1]; if (!g || g.a !== a) gruplar.push(g = { a, l: [] }); g.l.push(i); });
  app().innerHTML = `
    <div class="iki-btn"><button class="btn al" id="aldim">＋ Aldım</button><button class="btn sat" id="sattim">－ Sattım</button></div>
    <button class="btn ikinci" id="foto" style="margin-bottom:6px">📷 Defteri fotoğrafla aktar</button>
    <div class="satir" style="margin:6px 4px"><span class="soluk kucuk bosluk">${l.length} kayıt</span><button class="btn hayalet" id="diger" style="width:auto;min-height:40px">Bedelsiz / temettü</button></div>
    ${gruplar.length ? `<div class="liste">${gruplar.map(g => { const [y, m] = g.a.split('-').map(Number); return `<div class="ay-baslik">${AYLAR[m - 1]} ${y}</div>${g.l.map(i => islemSatiri(i, h)).join('')}`; }).join('')}</div>` : '<div class="kart bos">Defter boş. İlk işlemini “Aldım” ile gir.</div>'}`;
  $('#aldim').onclick = () => islemFormu({ Tur: 'Alış' });
  $('#sattim').onclick = () => islemFormu({ Tur: 'Satış' });
  $('#diger').onclick = () => islemFormu({ Tur: 'Bedelsiz' });
  $('#foto').onclick = () => { S.impSeg = 'sohbet'; sekmeGit('imparator'); setTimeout(() => { $('#fotoSec')?.click(); }, 120); toast('Defter sayfasının fotoğrafını çek; İmparator işlemleri okusun'); };
  $$('[data-islem]').forEach(b => b.onclick = () => islemFormu(S.veri.islemler.find(i => i.Kimlik === b.dataset.islem)));
}

// Alış / satış / bedelsiz / temettü formu (yeni ya da düzenle)
function islemFormu(baslangic = {}) {
  const duzenle = !!baslangic.Kimlik, k = { Tur: 'Alış', Tarih: bugun(), ...baslangic };
  const komOran = sayi(S.veri?.ayar?.komisyon_binde);
  let komElle = duzenle && k.Komisyon !== undefined;
  const w = pencere(`<h2>${duzenle ? 'Kaydı düzenle' : 'Yeni kayıt'}</h2>
    <div class="seg seg4" id="fTur">${TURLER.map(t => `<button data-t="${t}" class="${t === 'Alış' ? 'al' : t === 'Satış' ? 'sat' : ''}">${t === 'Alış' ? 'Aldım' : t === 'Satış' ? 'Sattım' : t}</button>`).join('')}</div>
    <label class="etiket" for="fHisse">Hisse</label>
    <input id="fHisse" class="buyuk-giris" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ör. THYAO" value="${esc(k.Hisse || '')}">
    <div id="fOneri"></div>
    <div id="fElde" class="soluk kucuk" style="margin:6px 2px 0"></div>
    <div id="fAdetKutu"><label class="etiket" for="fAdet">Adet</label><input id="fAdet" class="buyuk-giris" inputmode="decimal" placeholder="0" value="${k.Adet ? String(k.Adet).replace('.', ',') : ''}"></div>
    <div id="fFiyatKutu"><label class="etiket" for="fFiyat" id="fFiyatEt">Fiyat (1 adet)</label><div class="alan-ek"><input id="fFiyat" class="buyuk-giris" inputmode="decimal" placeholder="0,00" value="${k.Fiyat ? String(k.Fiyat).replace('.', ',') : ''}"><span>₺</span></div><div id="fSon" class="soluk kucuk" style="margin:6px 2px 0"></div></div>
    <label class="etiket" for="fTarih">Tarih</label><input id="fTarih" type="date" value="${esc(k.Tarih)}">
    <div id="fKomKutu"><label class="etiket" for="fKom">Komisyon <span class="cok-kucuk">${komOran ? `(binde ${fmt(komOran, 2)} otomatik)` : '(varsa)'}</span></label><div class="alan-ek"><input id="fKom" inputmode="decimal" placeholder="0" value="${k.Komisyon ? String(k.Komisyon).replace('.', ',') : ''}"><span>₺</span></div></div>
    <label class="etiket" for="fNot">Not <span class="cok-kucuk">(isteğe bağlı)</span></label><input id="fNot" maxlength="120" value="${esc(k.Not || '')}">
    <div class="ozet-kutu" id="fOzet"></div>
    <button class="btn" id="fKaydet" style="margin-top:16px">Kaydet</button>
    ${duzenle ? '<button class="btn tehlike" id="fSil" style="margin-top:10px">Bu kaydı sil</button>' : ''}`);
  let tur = k.Tur;
  const elde = kod => { const h = hesapla(S.veri.islemler.filter(i => i.Kimlik !== k.Kimlik), fiyatlar()); return h.acik.find(p => p.kod === kod); };
  const guncelle = () => {
    $$('#fTur button', w).forEach(b => b.classList.toggle('on', b.dataset.t === tur));
    const kod = kodTemiz($('#fHisse', w).value), e = kod && elde(kod);
    $('#fAdetKutu', w).classList.toggle('hidden', tur === 'Temettü');
    $('#fFiyatKutu', w).classList.toggle('hidden', tur === 'Bedelsiz');
    $('#fKomKutu', w).classList.toggle('hidden', tur === 'Bedelsiz');
    $('#fFiyatEt', w).textContent = tur === 'Temettü' ? 'Eline geçen net tutar' : 'Fiyat (1 adet)';
    $('#fElde', w).innerHTML = e ? `Elinde <b>${adetFmt(e.adet)}</b> adet · ort. maliyet ${fmt(e.ort)} ₺ ${tur === 'Satış' ? `<button class="cip" id="fTamami" style="margin-left:6px">Tamamı</button>` : ''}` : (tur === 'Satış' && kod ? 'Bu hisseden elinde görünmüyor.' : '');
    if ($('#fTamami', w)) $('#fTamami', w).onclick = () => { $('#fAdet', w).value = String(e.adet).replace('.', ','); hesap(); };
    const f = fiyatlar()[kod];
    $('#fSon', w).textContent = f?.fiyat ? `Son fiyat: ${fmt(f.fiyat)} ₺ (15 dk gecikmeli)` : '';
    hesap();
  };
  const hesap = () => {
    const kod = kodTemiz($('#fHisse', w).value), adet = sayi($('#fAdet', w).value), fiyat = sayi($('#fFiyat', w).value);
    if (!komElle && komOran && tur !== 'Bedelsiz' && tur !== 'Temettü') $('#fKom', w).value = adet && fiyat ? fmt(adet * fiyat * komOran / 1000) : '';
    const kom = sayi($('#fKom', w).value), e = kod && elde(kod);
    let h = '';
    if (tur === 'Alış') h = `<div class="ozet-satir"><span>Ödenen</span><b class="say">${tl(adet * fiyat + kom)}</b></div>`;
    else if (tur === 'Satış') {
      const gelir = adet * fiyat - kom;
      h = `<div class="ozet-satir"><span>Eline geçen</span><b class="say">${tl(gelir)}</b></div>`;
      if (e && adet && fiyat) { const kar = gelir - e.ort * Math.min(adet, e.adet); h += `<div class="ozet-satir"><span>Kâr / zarar</span><b class="say ${renk(kar)}">${isaretli(kar)} (${kar >= 0 ? '+' : '−'}${yuzde(e.ort ? kar / (e.ort * Math.min(adet, e.adet)) * 100 : 0)})</b></div>`; }
    } else if (tur === 'Temettü') h = `<div class="ozet-satir"><span>Kâra eklenecek</span><b class="say arti">${tl(fiyat - kom)}</b></div>`;
    else h = `<div class="ozet-satir"><span>Bedelsiz</span><b class="say">+${adetFmt(adet)} adet</b></div><div class="soluk kucuk">Maliyet değişmez, ortalama maliyet düşer.</div>`;
    $('#fOzet', w).innerHTML = h;
  };
  // Hisse önerileri: elindekiler + BIST listesi + gerekirse Yahoo araması
  let araT;
  const oneri = () => {
    const q = kodTemiz($('#fHisse', w).value), qa = $('#fHisse', w).value.trim().toLocaleLowerCase('tr');
    const eldekiler = hesapla(S.veri.islemler).acik.map(p => p.kod);
    if (!q) { $('#fOneri', w).innerHTML = eldekiler.length ? `<div class="cipler">${eldekiler.map(c => `<button class="cip" data-k="${c}">${c}</button>`).join('')}</div>` : ''; bagla(); return; }
    const l = BIST.filter(([c, a]) => c.startsWith(q) || a.toLocaleLowerCase('tr').includes(qa)).slice(0, 6);
    if (l.length === 1 && l[0][0] === q) { $('#fOneri', w).innerHTML = ''; return; }
    $('#fOneri', w).innerHTML = l.length ? `<div class="oneri-liste">${l.map(([c, a]) => `<button data-k="${c}"><b>${c}</b><span class="soluk kucuk">${esc(a)}</span></button>`).join('')}</div>` : '';
    bagla();
    clearTimeout(araT);
    if (!l.length && qa.length >= 2) araT = setTimeout(async () => { try { const r = await api('ara?q=' + encodeURIComponent(qa)); if (r.length && kodTemiz($('#fHisse', w)?.value) === q) { $('#fOneri', w).innerHTML = `<div class="oneri-liste">${r.slice(0, 6).map(x => `<button data-k="${x.kod}"><b>${x.kod}</b><span class="soluk kucuk">${esc(x.ad)}</span></button>`).join('')}</div>`; bagla(); } } catch { /* yok */ } }, 400);
  };
  const sec = async kod => {
    $('#fHisse', w).value = kod; $('#fOneri', w).innerHTML = ''; guncelle();
    if (!fiyatlar()[kod]) { try { const f = await api('fiyat', { kodlar: [kod] }); S.fiyat.hisseler = { ...fiyatlar(), ...f.hisseler }; } catch { /* yok */ } }
    const f = fiyatlar()[kod];
    if (f?.fiyat && !sayi($('#fFiyat', w).value) && tur !== 'Temettü') $('#fFiyat', w).value = String(f.fiyat.toFixed(2)).replace('.', ',');
    guncelle(); if (tur !== 'Temettü') $('#fAdet', w).focus();
  };
  const bagla = () => $$('#fOneri [data-k]', w).forEach(b => b.onclick = () => sec(b.dataset.k));
  $$('#fTur button', w).forEach(b => b.onclick = () => { tur = b.dataset.t; guncelle(); });
  $('#fHisse', w).oninput = () => { const s = $('#fHisse', w); const p = s.selectionStart; s.value = s.value.toLocaleUpperCase('tr'); s.setSelectionRange(p, p); oneri(); guncelle(); };
  $('#fHisse', w).onblur = () => setTimeout(() => { const q = kodTemiz($('#fHisse', w)?.value); if (q && !fiyatlar()[q]) sec(q); }, 200);
  $('#fAdet', w).oninput = hesap; $('#fFiyat', w).oninput = hesap;
  $('#fKom', w).oninput = () => { komElle = true; hesap(); };
  $('#fKaydet', w).onclick = () => {
    const kayit = { ...(duzenle ? { Kimlik: k.Kimlik } : {}), Tur: tur, Hisse: kodTemiz($('#fHisse', w).value), Adet: tur === 'Temettü' ? '' : sayi($('#fAdet', w).value), Fiyat: tur === 'Bedelsiz' ? 0 : sayi($('#fFiyat', w).value), Komisyon: tur === 'Bedelsiz' ? 0 : sayi($('#fKom', w).value), Tarih: $('#fTarih', w).value || bugun(), Not: $('#fNot', w).value.trim() };
    if (!kayit.Hisse) return toast('Hisse kodunu yaz');
    if (tur !== 'Temettü' && !(kayit.Adet > 0)) return toast('Adedi yaz');
    if (tur !== 'Bedelsiz' && !(kayit.Fiyat > 0)) return toast(tur === 'Temettü' ? 'Tutarı yaz' : 'Fiyatı yaz');
    if (tur === 'Bedelsiz' && !elde(kayit.Hisse) && !duzenle) return onay(`Elinde ${kayit.Hisse} görünmüyor`, 'Bedelsiz, elindeki hisseye eklenir. Önce alışını girmen gerekiyor olabilir. Yine de kaydedilsin mi?', () => { w.kapat(); kaydet(kayit, duzenle); }, { evetYazi: 'Yine de kaydet' });
    if (!bistAd(kayit.Hisse) && !fiyatlar()[kayit.Hisse]?.fiyat && !duzenle) return onay(`${kayit.Hisse} bulunamadı`, 'Borsa İstanbul’da bu kodla bir hisse bulamadım. Kodu doğru yazdığına emin misin?', () => { w.kapat(); kaydet(kayit, duzenle); }, { evetYazi: 'Yine de kaydet' });
    if (tur === 'Satış') { const e = elde(kayit.Hisse); if (!e || kayit.Adet - e.adet > 1e-9) return onay('Elinde bu kadar yok', `Defterde ${kayit.Hisse} için ${e ? adetFmt(e.adet) : 0} adet görünüyor. Yine de kaydedilsin mi?`, () => { w.kapat(); kaydet(kayit, duzenle); }, { evetYazi: 'Kaydet' }); }
    w.kapat(); kaydet(kayit, duzenle);
  };
  if (duzenle) $('#fSil', w).onclick = () => onay('Bu kayıt silinsin mi?', `${k.Tarih} · ${k.Tur} · ${k.Hisse}`, () => { w.kapat(); kayitSil(k.Kimlik); }, { evetYazi: 'Sil', tehlike: true });
  oneri(); guncelle();
  if (!duzenle && !k.Hisse) setTimeout(() => $('#fHisse', w)?.focus(), 250);
  else if (k.Hisse && !k.Fiyat) sec(k.Hisse);
}

// Kayıt: ekranda hemen görünür, sunucuya arkadan yazılır; yazılamazsa geri alınır
async function kaydet(kayit, duzenle) {
  const once = S.veri.islemler;
  const yeni = duzenle ? { ...once.find(i => i.Kimlik === kayit.Kimlik), ...kayit } : { ...kayit, Kimlik: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), Kayit: new Date().toISOString() };
  S.veri.islemler = duzenle ? once.map(i => i.Kimlik === kayit.Kimlik ? yeni : i) : [...once, yeni];
  yenidenCiz();
  toast(duzenle ? 'Düzeltildi ✓' : kayit.Tur === 'Satış' ? 'Satış deftere yazıldı ✓' : 'Deftere yazıldı ✓');
  const govde = duzenle ? { duzelt: yeni } : { ekle: [yeni] };
  if (dk.length) { dk.push(govde); kuyrukYaz(); yenidenCiz(); return kuyrukGonder(); }   // sıra bozulmasın
  try {
    veriKoy(await api('islem', govde));
    if (!fiyatlar()[yeni.Hisse]) fiyatYukle().catch(() => {});
    yenidenCiz();
  } catch (e) {
    if (e.ag) { dk.push(govde); kuyrukYaz(); yenidenCiz(); return toast('İnternet yok. Kayıt telefonda bekliyor, bağlanınca deftere yazılacak.', 5000); }
    S.veri.islemler = once; yenidenCiz(); toast('Kaydedilemedi: ' + e.message, 5000);
  }
}
async function kayitSil(kimlik) {
  const once = S.veri.islemler; S.veri.islemler = once.filter(i => i.Kimlik !== kimlik); yenidenCiz(); toast('Silindi');
  if (dk.length) { dk.push({ sil: kimlik }); kuyrukYaz(); return kuyrukGonder(); }
  try { veriKoy(await api('islem', { sil: kimlik })); yenidenCiz(); }
  catch (e) { if (e.ag) { dk.push({ sil: kimlik }); kuyrukYaz(); return toast('İnternet yok. Silme, bağlanınca deftere işlenecek.', 5000); } S.veri.islemler = once; yenidenCiz(); toast('Silinemedi: ' + e.message, 5000); }
}

// ---------- Hesapla: kâr, hedef fiyat, ortalama maliyet, tavan/taban ----------
const HS = ls.al('imp_hesapla', { arac: 'kar' });
const hsYaz = () => ls.yaz('imp_hesapla', HS);
const ARACLAR = [['kar', '💰', 'Kâr'], ['hedef', '🎯', 'Hedef'], ['ort', '⚖️', 'Ortalama'], ['tavan', '📈', 'Tavan']];
function hesaplaSayfasi() {
  const h = hesapla(S.veri?.islemler || [], fiyatlar());
  const hisseler = [...new Set([...h.acik.map(p => p.kod), ...(S.veri?.takip || [])])];
  const cipler = hisseler.length ? `<div class="soluk kucuk" style="margin-top:4px">Hisseden doldur:</div><div class="cipler">${hisseler.map(k => `<button class="cip" data-doldur="${k}">${k}</button>`).join('')}</div>` : '';
  const alan = (id, et, ph = '0', ek = '₺') => `<label class="etiket" for="${id}">${et}</label><div class="alan-ek"><input id="${id}" class="buyuk-giris" inputmode="decimal" placeholder="${ph}" value="${esc(HS[id] ?? '')}">${ek ? `<span>${ek}</span>` : ''}</div>`;
  const kom = sayi(S.veri?.ayar?.komisyon_binde);
  const IC = {
    kar: `${cipler}${alan('kAlis', 'Alış fiyatı')}${alan('kSatis', 'Satış fiyatı')}${alan('kAdet', 'Adet', '0', 'adet')}
      <label class="onay-sat"><input type="checkbox" id="kKom" ${HS.kKom !== false && kom ? 'checked' : ''} ${kom ? '' : 'disabled'}> Komisyonu düş ${kom ? `(binde ${fmt(kom, 2)})` : '<span class="soluk kucuk">— Ayarlar’dan oran girersen</span>'}</label>`,
    hedef: `${cipler}${alan('hAlis', 'Alış fiyatı (ya da ortalama maliyet)')}
      <label class="etiket">İstediğin getiri</label><div class="cipler">${[5, 10, 15, 20, 30, 50, 100].map(y => `<button class="cip" data-yuzde="${y}">%${y}</button>`).join('')}</div>
      ${alan('hYuzde', 'Getiri yüzdesi', 'ör. 10', '%')}
      <label class="etiket">Zarar durdurma</label><div class="cipler">${[3, 5, 7, 10, 15].map(y => `<button class="cip" data-zarar="${y}">−%${y}</button>`).join('')}</div>
      ${alan('hZarar', 'Zarar yüzdesi', 'ör. 5', '%')}`,
    ort: `${cipler}${alan('oAdet', 'Elindeki adet', '0', 'adet')}${alan('oOrt', 'Şu anki ortalama maliyet')}
      <div class="baslik" style="margin-left:2px">Yeni alım</div>${alan('oYAdet', 'Alınacak adet', '0', 'adet')}${alan('oYFiyat', 'Alış fiyatı')}
      <div class="baslik" style="margin-left:2px">Ya da: ortalamayı kaça düşürmek istiyorsun?</div>${alan('oHedef', 'Hedef ortalama')}`,
    tavan: `${cipler}${alan('tBaz', 'Önceki kapanış (baz fiyat)')}
      <label class="etiket">Günlük fiyat marjı</label><div class="seg" id="tMarj">${[10, 20].map(m => `<button data-m="${m}" class="${(HS.tMarj || 10) === m ? 'on' : ''}">%${m}</button>`).join('')}</div>`,
  };
  app().innerHTML = `<div class="arac-izgara">${ARACLAR.map(([k, i, a]) => `<button class="arac ${HS.arac === k ? 'on' : ''}" data-arac="${k}"><span>${i}</span>${a}</button>`).join('')}</div>
    <div class="ana-sonuc" id="anaSonuc"></div>
    <div class="kart">${IC[HS.arac]}<div class="sonuc" id="sonuc"></div></div>
    ${HS.arac === 'tavan' ? '<p class="soluk kucuk" style="margin:0 6px">Tavan fiyat adımına aşağı, taban yukarı yuvarlanır (Borsa İstanbul kuralı). Kesin değer için aracı kurum ekranına bak.</p>' : ''}`;
  $$('[data-arac]').forEach(b => b.onclick = () => { HS.arac = b.dataset.arac; hsYaz(); hesaplaSayfasi(); });
  const v = id => sayi($('#' + id)?.value);
  const satir = (a, d, sinif = '') => `<div class="ozet-satir"><span>${a}</span><b class="say ${sinif}">${d}</b></div>`;
  const hesapYap = () => {
    $$('#app input.buyuk-giris').forEach(i => { HS[i.id] = i.value; }); if ($('#kKom')) HS.kKom = $('#kKom').checked; hsYaz();
    const o = $('#sonuc'); let x = '', ana = '';
    if (HS.arac === 'kar') {
      const a = v('kAlis'), st = v('kSatis'), n = v('kAdet') || 1, oran = $('#kKom')?.checked ? kom / 1000 : 0;
      if (a && st) {
        const komT = (a + st) * n * oran, brut = (st - a) * n, net = brut - komT, gy = (net / (a * n * (1 + oran))) * 100;
        ana = `<span class="soluk kucuk">Net kâr / zarar</span><b class="${renk(net)}">${isaretli(net)}</b><span class="hap ${renk(net)}">${net >= 0 ? '▲' : '▼'} ${yuzde(gy)}</span>`;
        x = satir('Fiyat farkı (1 adet)', `${st - a >= 0 ? '+' : '−'}${fmt(Math.abs(st - a))} ₺ (${st >= a ? '+' : '−'}${yuzde((st / a - 1) * 100)})`)
          + satir('Alış tutarı', tl(a * n)) + satir('Satış tutarı', tl(st * n)) + (oran ? satir('Komisyon (alış + satış)', '−' + tl(komT)) : '') + satir('Net kâr / zarar', isaretli(net), renk(net));
      }
    } else if (HS.arac === 'hedef') {
      const a = v('hAlis'), y = v('hYuzde'), z = v('hZarar'), oran = kom / 1000;
      if (a) {
        const f1 = y ? a * (1 + y / 100) : null, f2 = z ? a * (1 - z / 100) : null;
        ana = `<div class="ikili" style="margin:0"><div><span class="soluk kucuk">%${fmt(y || 0, y % 1 ? 1 : 0)} kâr için sat</span><b class="arti">${f1 ? fmt(f1) + ' ₺' : '—'}</b></div><div><span class="soluk kucuk">%${fmt(z || 0, z % 1 ? 1 : 0)} zararda dur</span><b class="eksi">${f2 ? fmt(f2) + ' ₺' : '—'}</b></div></div>`;
        if (y && oran) x += satir('Kâr hedefi komisyon dahil', fmt(a * (1 + oran) * (1 + y / 100) / (1 - oran)) + ' ₺');
        if (y) x += satir('Fiyat farkı', '+' + fmt(f1 - a) + ' ₺');
        if (z) x += satir('Zarar durdurmada fark', '−' + fmt(a - f2) + ' ₺');
      }
    } else if (HS.arac === 'ort') {
      const A = v('oAdet'), O = v('oOrt'), yA = v('oYAdet'), yF = v('oYFiyat'), H = v('oHedef');
      if (A && O && yA && yF) {
        const t = A + yA, yeni = (A * O + yA * yF) / t;
        ana = `<span class="soluk kucuk">Yeni ortalama maliyet</span><b>${fmt(yeni)} ₺</b><span class="hap ${renk(O - yeni)}">${yeni <= O ? '▼' : '▲'} ${fmt(Math.abs(yeni - O))} ₺</span>`;
        x += satir('Toplam adet', adetFmt(t)) + satir('Toplam maliyet', tl(A * O + yA * yF)) + satir('Yeni alım tutarı', tl(yA * yF));
      }
      if (A && O && H && yF) {
        if ((yF < H && H < O) || (yF > H && H > O)) { const n = Math.ceil(A * (O - H) / (H - yF)); x += `<div class="ozet-kutu">${fmt(yF)} ₺’den <b>${adetFmt(n)} adet</b> (${tl(n * yF)}) alırsan ortalaman ${fmt(H)} ₺ olur.</div>`; if (!ana) ana = `<span class="soluk kucuk">${fmt(H)} ₺ ortalama için</span><b>${adetFmt(n)} adet al</b>`; }
        else x += `<div class="ozet-kutu soluk">Hedef ortalama, şu anki ortalama ile alış fiyatı arasında olmalı.</div>`;
      }

    } else {
      const b = v('tBaz'), m = HS.tMarj || 10;
      if (b) {
        const t1 = tavanTaban(b, m);
        ana = `<div class="ikili" style="margin:0"><div><span class="soluk kucuk">Bugünkü tavan</span><b class="arti">${fmt(t1.tavan)} ₺</b></div><div><span class="soluk kucuk">Bugünkü taban</span><b class="eksi">${fmt(t1.taban)} ₺</b></div></div>`;
        x = '';
        let tv = b, tb = b; const sat = [];
        for (let g = 1; g <= 5; g++) { tv = tavanTaban(tv, m).tavan; tb = tavanTaban(tb, m).taban; sat.push(`<tr><td>${g}. gün</td><td class="arti">${fmt(tv)} <span class="cok-kucuk">(+${fmt((tv / b - 1) * 100, 1)}%)</span></td><td class="eksi">${fmt(tb)} <span class="cok-kucuk">(−${fmt((1 - tb / b) * 100, 1)}%)</span></td></tr>`); }
        x += `<div class="etiket">Art arda tavan / taban olursa</div><table class="tablo"><tr><th></th><th>Tavan</th><th>Taban</th></tr>${sat.join('')}</table>`;
      }
    }
    o.innerHTML = x;
    const an = $('#anaSonuc'); an.innerHTML = ana || `<span class="soluk">${{ kar: 'Alış, satış fiyatı ve adedi yaz', hedef: 'Alış fiyatını yaz, bir yüzde seç', ort: 'Elindeki adet ve ortalamayı, sonra yeni alımı yaz', tavan: 'Önceki kapanış fiyatını yaz' }[HS.arac]}</span>`; an.classList.toggle('bos', !ana);
  };
  $$('#app input').forEach(i => (i.oninput = hesapYap));
  if ($('#kKom')) $('#kKom').onchange = hesapYap;
  $$('[data-yuzde]').forEach(b => b.onclick = () => { $('#hYuzde').value = b.dataset.yuzde; hesapYap(); });
  $$('[data-zarar]').forEach(b => b.onclick = () => { $('#hZarar').value = b.dataset.zarar; hesapYap(); });
  $$('#tMarj [data-m]').forEach(b => b.onclick = () => { HS.tMarj = Number(b.dataset.m); hsYaz(); hesaplaSayfasi(); });
  const yaz = (id, val) => { if ($('#' + id)) $('#' + id).value = val ? String(Math.round(val * 100) / 100).replace('.', ',') : ''; };
  $$('[data-doldur]').forEach(b => b.onclick = () => {
    const kod = b.dataset.doldur, p = h.acik.find(x => x.kod === kod), f = fiyatlar()[kod];
    if (HS.arac === 'kar') { yaz('kAlis', p?.ort); yaz('kSatis', f?.fiyat); yaz('kAdet', p?.adet); }
    if (HS.arac === 'hedef') yaz('hAlis', p?.ort || f?.fiyat);
    if (HS.arac === 'ort') { yaz('oAdet', p?.adet); yaz('oOrt', p?.ort); yaz('oYFiyat', f?.fiyat); }
    if (HS.arac === 'tavan') yaz('tBaz', f?.onceki);
    $$('[data-doldur]').forEach(x => x.classList.toggle('on', x === b)); hesapYap();
  });
  hesapYap();
}

// ---------- Piyasa ----------
function piyasaSatiri(ad, alt, f, birim = '₺', veri = '') {
  // Fiyatı gelmeyen satır da dokunulabilir kalır (ör. yanlış yazılmış kod takipten çıkarılabilsin)
  if (!f || f.hata || !f.fiyat) return veri ? `<button class="oge tikla" ${veri}><div class="bosluk"><div class="ad">${esc(ad)}</div><div class="soluk kucuk">${f?.hata ? 'Fiyat bulunamadı · dokun' : esc(alt || '')}</div></div><div class="soluk">—</div></button>`
    : `<div class="oge"><div class="bosluk"><div class="ad">${esc(ad)}</div>${alt ? `<div class="soluk kucuk">${esc(alt)}</div>` : ''}</div><div class="soluk">—</div></div>`;
  const k = f.fiyat >= 10000 ? 0 : f.fiyat >= 100 ? 2 : f.fiyat < 1 ? 4 : 2;
  return `<button class="oge tikla" ${veri}><div class="bosluk"><div class="ad">${esc(ad)}</div>${alt ? `<div class="soluk kucuk">${esc(alt)}</div>` : ''}</div>
    <div class="sag"><div class="fiyat say">${fmt(f.fiyat, k)}${birim === '%' ? '%' : birim ? ' ' + birim : ''}</div><span class="hap ${renk(f.degisim)}">${f.degisim >= 0 ? '▲' : '▼'} ${yuzde(f.degisim)}</span></div></button>`;
}
function piyasaSayfasi() {
  const P = S.fiyat?.piyasa || {}, H = fiyatlar(), h = hesapla(S.veri?.islemler || [], H);
  const grup = g => Object.values(P).filter(p => p.grup === g).map(p => piyasaSatiri(p.ad, '', p, p.birim === undefined ? '' : p.birim)).join('');
  const takip = (S.veri?.takip || []).filter(k => !h.acik.some(p => p.kod === k));
  const fz = S.fiyat?.zaman ? new Date(S.fiyat.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
  app().innerHTML = `
    <div class="baslik">Borsa İstanbul</div><div class="liste piyasa">${grup('Borsa İstanbul') || '<div class="bos">Yükleniyor…</div>'}</div>
    ${h.acik.length ? `<div class="baslik">Hisselerim</div><div class="liste piyasa">${h.acik.map(p => piyasaSatiri(p.kod, p.ad || bistAd(p.kod), H[p.kod], '₺', `data-hisse="${p.kod}"`)).join('')}</div>` : ''}
    <div class="baslik satir"><span class="bosluk">Takip listem</span></div>
    <div class="liste piyasa">${takip.map(k => piyasaSatiri(k, bistAd(k) || H[k]?.ad || '', H[k], '₺', `data-hisse="${k}"`)).join('')}<button class="oge tikla" id="takipEkle" style="color:var(--marka);font-weight:700">＋ Hisse ekle</button></div>
    <div class="baslik">Döviz ve altın</div><div class="liste piyasa">${grup('Döviz ve altın')}</div>
    <div class="baslik">Dünya</div><div class="liste piyasa">${grup('Dünya')}</div>
    <button class="btn ikinci" id="yenile" style="margin-top:14px">↻ Yenile</button>
    <div class="zaman">${fz ? `Son güncelleme ${fz} · BIST verileri 15 dk gecikmeli` : ''}</div>`;
  $('#yenile').onclick = async () => { $('#yenile').disabled = true; try { await fiyatYukle(); piyasaSayfasi(); toast('Güncellendi'); } catch (e) { toast(e.message); $('#yenile').disabled = false; } };
  $('#takipEkle').onclick = takipEkle;
  $$('[data-hisse]').forEach(b => b.onclick = () => hisseKarti(b.dataset.hisse));
}
async function hisseKarti(kod) {
  const tk = (S.veri.takip || []).includes(kod), elde = hesapla(S.veri.islemler, fiyatlar()).acik.find(p => p.kod === kod);
  const w = pencere(`<h2>${kod} <span class="soluk kucuk">${esc(bistAd(kod) || fiyatlar()[kod]?.ad || '')}</span></h2>
    <div class="kart" style="margin-top:0"><div class="dev say">${fiyatlar()[kod]?.fiyat ? fmt(fiyatlar()[kod].fiyat) + ' ₺' : '—'}</div><div class="soluk kucuk" id="hkGrafikYazi">Son 1 ay yükleniyor…</div><svg class="cizgi-grafik" id="hkGrafik" viewBox="0 0 300 90" preserveAspectRatio="none"></svg></div>
    <div class="iki-btn"><button class="btn al" data-al>＋ Aldım</button>${elde ? '<button class="btn sat" data-sat>－ Sattım</button>' : `<button class="btn ikinci" data-tk>${tk ? 'Takipten çıkar' : '☆ Takibe al'}</button>`}</div>
    ${elde && tk ? '<button class="btn hayalet" data-tk>Takipten çıkar</button>' : ''}
    <button class="btn ikinci" data-sor style="margin-top:6px">İmparator’a sor</button>`);
  $('[data-al]', w).onclick = () => { w.kapat(); setTimeout(() => islemFormu({ Tur: 'Alış', Hisse: kod }), 50); };
  if ($('[data-sat]', w)) $('[data-sat]', w).onclick = () => { w.kapat(); setTimeout(() => islemFormu({ Tur: 'Satış', Hisse: kod }), 50); };
  if ($('[data-tk]', w)) $('[data-tk]', w).onclick = () => { w.kapat(); takipDegis(kod, !tk); };
  $('[data-sor]', w).onclick = () => { w.kapat(); S.impSeg = 'sohbet'; sekmeGit('imparator'); setTimeout(() => { const g = $('#girdi'); if (g) { g.value = `${kod} hakkında ne düşünüyorsun?`; g.focus(); } }, 120); };
  try {
    const f = await api('fiyat', { kodlar: [kod], gecmis: true }), k = f.hisseler?.[kod]?.kapanislar || [];
    const g = $('#hkGrafik', w); if (!g || k.length < 2) { if ($('#hkGrafikYazi', w)) $('#hkGrafikYazi', w).textContent = ''; return; }
    const mn = Math.min(...k), mx = Math.max(...k), y = v => 84 - (v - mn) / ((mx - mn) || 1) * 78;
    const yol = k.map((v, i) => `${(i / (k.length - 1) * 300).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const deg = (k[k.length - 1] / k[0] - 1) * 100;
    g.innerHTML = `<polyline points="${yol}" fill="none" stroke="${deg >= 0 ? 'var(--arti)' : 'var(--eksi)'}" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
    $('#hkGrafikYazi', w).innerHTML = `Son 1 ay: <b class="${renk(deg)}">${deg >= 0 ? '+' : '−'}${yuzde(deg)}</b> · en düşük ${fmt(mn)} · en yüksek ${fmt(mx)}`;
  } catch { if ($('#hkGrafikYazi', w)) $('#hkGrafikYazi', w).textContent = ''; }
}
function takipEkle() {
  const w = pencere(`<h2>Takibe hisse ekle</h2><input id="tkKod" class="buyuk-giris" autocapitalize="characters" autocomplete="off" placeholder="ör. ASELS"><div id="tkOneri"></div>`);
  const ciz = () => {
    const q = kodTemiz($('#tkKod', w).value), qa = $('#tkKod', w).value.trim().toLocaleLowerCase('tr');
    const l = q ? BIST.filter(([c, a]) => c.startsWith(q) || a.toLocaleLowerCase('tr').includes(qa)).slice(0, 8) : [];
    $('#tkOneri', w).innerHTML = `<div class="oneri-liste">${l.map(([c, a]) => `<button data-k="${c}"><b>${c}</b><span class="soluk kucuk">${esc(a)}</span></button>`).join('')}${q && !l.some(x => x[0] === q) ? `<button data-k="${q}"><b>${q}</b><span class="soluk kucuk">bu kodu ekle</span></button>` : ''}</div>`;
    $$('[data-k]', w).forEach(b => b.onclick = async () => {
      const kod = b.dataset.k;
      // Listede olmayan kod: önce Borsa İstanbul'da gerçekten var mı bak (yanlış yazılan kod takibe girmesin)
      if (!bistAd(kod)) {
        b.disabled = true; b.querySelector('.soluk').textContent = 'kontrol ediliyor…';
        try { const f = await api('fiyat', { kodlar: [kod] }); const h = f.hisseler?.[kod]; if (!h?.fiyat) { b.disabled = false; b.querySelector('.soluk').textContent = 'bulunamadı'; return toast(`${kod} diye bir hisse bulamadım, kodu kontrol et`, 3500); } S.fiyat.hisseler = { ...fiyatlar(), [kod]: h }; }
        catch (e) { b.disabled = false; return toast(e.message); }
      }
      w.kapat(); takipDegis(kod, true);
    });
  };
  $('#tkKod', w).oninput = () => { $('#tkKod', w).value = $('#tkKod', w).value.toLocaleUpperCase('tr'); ciz(); };
  setTimeout(() => $('#tkKod', w)?.focus(), 250);
}
async function takipDegis(kod, ekle) {
  const once = S.veri.takip || [], yeni = ekle ? [...new Set([...once, kod])] : once.filter(k => k !== kod);
  S.veri.takip = yeni; yenidenCiz(); toast(ekle ? `${kod} takipte` : `${kod} takipten çıktı`);
  try { veriKoy(await api('takip', { kodlar: yeni })); await fiyatYukle(); yenidenCiz(); } catch (e) { S.veri.takip = once; yenidenCiz(); toast(e.message); }
}

// ---------- İmparator ----------
function analizHTML(a, acik) {
  const govde = esc(a.Metin).split('\n').reduce((o, s) => {
    const t = s.trim();
    if (!t) return o;
    if (t.startsWith('## ')) return o + `<h4>${t.slice(3)}</h4>`;
    if (/^[-•*] /.test(t)) return o + `<ul><li>${t.slice(2).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^([A-ZÇĞİÖŞÜ0-9]{3,6}):/, '<b>$1:</b>')}</li></ul>`;
    return o + `<p>${t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`;
  }, '').replace(/<\/ul><ul>/g, '');
  return `<div class="kart analiz"><div class="imp-bas"><img class="avatar" src="img/aydin.png" alt=""><div class="bosluk"><b>İmparator</b><div class="soluk kucuk">${esc(a.Tur)} analizi · ${tarihYaz(a.Tarih)} ${esc(a.Saat)}</div></div></div>
    <h3>${esc(a.Baslik)}</h3><div class="govde ${acik ? '' : 'kapali'}">${govde}</div>${acik ? '' : '<button class="btn hayalet" data-devam>Devamını oku ›</button>'}</div>`;
}
function imparatorSayfasi() {
  app().innerHTML = `<div class="seg" style="margin-top:6px"><button data-g="analiz" class="${S.impSeg === 'analiz' ? 'on' : ''}">Günün analizi</button><button data-g="sohbet" class="${S.impSeg === 'sohbet' ? 'on' : ''}">Sohbet</button></div><div id="impIc"></div>`;
  $$('[data-g]').forEach(b => b.onclick = () => { S.impSeg = b.dataset.g; if (S.impSeg !== 'sohbet') $('.yazma')?.remove(); imparatorSayfasi(); scrollTo(0, 0); });
  S.impSeg === 'analiz' ? analizBolumu() : sohbetBolumu();
}
let analizAcik = false;
function analizBolumu() {
  const l = S.veri?.analizler || [], son = l[0];
  $('#impIc').innerHTML = `${son ? analizHTML(son, analizAcik) : `<div class="kart bos"><img class="avatar" src="img/aydin.png" alt="" style="width:80px;height:80px"><p>İmparator hafta içi her sabah 08:45’te ve akşam 18:45’te piyasayı yazar.</p></div>`}
    <button class="btn ikinci" id="simdi">✍️ Şimdi bir analiz yaz</button>
    ${l.length > 1 ? `<div class="baslik">Önceki analizler</div><div class="liste">${l.slice(1, 15).map((a, i) => `<button class="oge tikla" data-eski="${i + 1}"><div class="ust-sira"><b>${esc(a.Baslik)}</b></div><div class="alt-sira"><span>${esc(a.Tur)} · ${tarihYaz(a.Tarih)} ${esc(a.Saat)}</span></div></button>`).join('')}</div>` : ''}`;
  $('[data-devam]')?.addEventListener('click', () => { analizAcik = true; analizBolumu(); });
  $$('[data-eski]').forEach(b => b.onclick = () => { const w = pencere(analizHTML(l[Number(b.dataset.eski)], true)); });
  $('#simdi').onclick = async () => {
    const b = $('#simdi'); b.disabled = true; b.textContent = 'İmparator piyasayı inceliyor… (30-60 sn)';
    try { const a = await api('analiz', {}); S.veri.analizler = [a, ...S.veri.analizler]; ls.yaz('imp_veri', S.veri); analizAcik = true; analizBolumu(); scrollTo(0, 0); }
    catch (e) { toast('Yazılamadı: ' + e.message, 5000); b.disabled = false; b.textContent = '✍️ Şimdi bir analiz yaz'; }
  };
}

// Sohbet: İmparator sorulara cevap verir, söylenen alış/satışı onay kartıyla deftere yazar, defter fotoğrafını okur
function islemAyikla(text) {
  const m = String(text || '').match(/\[\[ISLEM\s*([\s\S]*?)\]\]\s*$/) || String(text || '').match(/\[\[ISLEM\s*([\s\S]*?)\]\]/);
  if (!m) return { text, islemler: [] };
  let l = []; try { const j = JSON.parse(m[1]); l = (Array.isArray(j) ? j : [j]).map(islemTemizle).filter(Boolean).slice(0, 40); } catch { l = []; }
  return { text: text.replace(m[0], '').trim(), islemler: l };
}
function islemTemizle(x) {
  if (!x?.tip) return null;
  const tarih = /^\d{4}-\d{2}-\d{2}$/.test(x.tarih || '') ? x.tarih : bugun();
  if (x.tip === 'islem') {
    const tur = TURLER.includes(x.tur) ? x.tur : null, hisse = kodTemiz(x.hisse); if (!tur || !hisse) return null;
    const o = { tip: 'islem', Tur: tur, Hisse: hisse, Adet: tur === 'Temettü' ? '' : sayi(x.adet), Fiyat: tur === 'Bedelsiz' ? 0 : sayi(x.fiyat), Tarih: tarih, Not: String(x.not || '').slice(0, 120) };
    const oran = sayi(S.veri?.ayar?.komisyon_binde);
    o.Komisyon = x.komisyon !== undefined && x.komisyon !== null && x.komisyon !== '' ? sayi(x.komisyon) : (oran && (tur === 'Alış' || tur === 'Satış') ? Math.round(o.Adet * o.Fiyat * oran / 10) / 100 : 0);
    if (tur !== 'Temettü' && !(o.Adet > 0)) return null; if (tur !== 'Bedelsiz' && !(o.Fiyat > 0)) return null;
    return o;
  }
  if (x.tip === 'sil') { const i = S.veri.islemler.find(i => i.Kimlik === String(x.kimlik)); return i ? { tip: 'sil', Kimlik: i.Kimlik, eski: i } : null; }
  if (x.tip === 'duzelt') {
    const i = S.veri.islemler.find(i => i.Kimlik === String(x.kimlik)); if (!i) return null;
    const y = {}; if (x.adet !== undefined) y.Adet = sayi(x.adet); if (x.fiyat !== undefined) y.Fiyat = sayi(x.fiyat); if (x.komisyon !== undefined) y.Komisyon = sayi(x.komisyon); if (/^\d{4}-\d{2}-\d{2}$/.test(x.tarih || '')) y.Tarih = x.tarih; if (TURLER.includes(x.tur)) y.Tur = x.tur;
    return Object.keys(y).length ? { tip: 'duzelt', Kimlik: i.Kimlik, eski: i, yeni: y } : null;
  }
  if (x.tip === 'takip') { const kod = kodTemiz(x.kod); return kod ? { tip: 'takip', kod, ekle: x.ekle !== false } : null; }
  return null;
}
function islemYazi(o) {
  if (o.tip === 'islem') return `<span class="tur ${o.Tur}">${o.Tur}</span> <b>${o.Hisse}</b> ${o.Tur === 'Temettü' ? tl(o.Fiyat) : o.Tur === 'Bedelsiz' ? '+' + adetFmt(o.Adet) + ' adet' : `${adetFmt(o.Adet)} × ${fmt(o.Fiyat)} = ${tl(o.Adet * o.Fiyat)}`}<div class="soluk kucuk">${tarihYaz(o.Tarih)}${o.Komisyon ? ` · komisyon ${fmt(o.Komisyon)}` : ''}</div>`;
  if (o.tip === 'sil') return `🗑️ Sil: ${o.eski.Tarih} ${o.eski.Tur} ${o.eski.Hisse} ${adetFmt(o.eski.Adet)} × ${fmt(o.eski.Fiyat)}`;
  if (o.tip === 'duzelt') return `✏️ Düzelt: ${o.eski.Hisse} ${o.eski.Tarih} → ${Object.entries(o.yeni).map(([k, v]) => `${k} ${typeof v === 'number' ? fmt(v) : v}`).join(', ')}`;
  return `${o.ekle ? '☆ Takibe al' : 'Takipten çıkar'}: <b>${o.kod}</b>`;
}
function mesajHTML(m, i) {
  if (m.role === 'user') return `<div class="msj ben">${m.foto ? '<span class="ek">📷 fotoğraf</span>' : ''}${esc(m.text)}</div>`;
  let h = `<div class="msj o ${m.hata ? 'hata' : ''}">${esc(m.text)}${m.kaynaklar?.length ? `<span class="kaynak">Kaynak: ${m.kaynaklar.map(k => esc(k.baslik || 'web')).join(' · ')}</span>` : ''}</div>`;
  if (m.islemler?.length) h += `<div class="islem-kart">${m.islemler.map(o => `<div class="is">${islemYazi(o)}</div>`).join('')}
    ${m.durum === 'ok' ? '<div class="arti" style="font-weight:700;margin-top:8px">✓ Deftere yazıldı</div>' : m.durum === 'iptal' ? '<div class="soluk" style="margin-top:8px">Vazgeçildi</div>' : m.durum === 'hata' ? `<div class="eksi" style="margin-top:8px">⚠️ ${esc(m.hataMsj || 'Yazılamadı')}</div>` : m.durum === 'isleniyor' ? '<div class="soluk" style="margin-top:8px">Yazılıyor…</div>'
      : `<div class="iki-btn" style="margin-bottom:0"><button class="btn ikinci" data-iptal="${i}">Vazgeç</button><button class="btn" data-onay="${i}">Onayla${m.islemler.length > 1 ? ` (${m.islemler.length})` : ''}</button></div>`}</div>`;
  return h;
}
let ek = null;
function sohbetBolumu() {
  const ONERI = ['Bugün piyasa nasıl?', 'Portföyümü değerlendir', 'Dolar ve altın ne durumda?', 'Bu hafta neye dikkat edeyim?'];
  $('#impIc').innerHTML = `${S.sohbet.length ? '<div style="text-align:right;margin-top:6px"><button class="btn hayalet" id="yeniSohbet" style="width:auto;min-height:40px;display:inline-flex">Yeni sohbet</button></div>' : ''}<div class="msjlar" id="msjlar">${S.sohbet.map(mesajHTML).join('') || `<div class="msj o">Piyasa da defter de önümüzde. Ne düşünüyoruz, bir bakalım? Aldığımızı sattığımızı da söyle, deftere yazalım.</div>`}</div><div style="height:${S.sohbet.length ? 150 : 190}px"></div>`;
  if (!$('.yazma')) {
    const y = document.createElement('div'); y.className = 'yazma';
    y.innerHTML = `<div class="oneriler" id="oneriler">${S.sohbet.length ? '' : ONERI.map(o => `<button class="cip" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div><div id="ekOn"></div>
      <div class="yazma-ic"><button class="ikon" id="foto" aria-label="Fotoğraf">${SVG.kamera}</button><button class="ikon" id="mik" aria-label="Sesle yaz">${SVG.mikrofon}</button><textarea id="girdi" rows="1" placeholder="İmparator’a yaz…"></textarea><button class="ikon gonder" id="gonder" aria-label="Gönder">${SVG.gonder}</button></div>
      <input type="file" id="fotoSec" accept="image/*" hidden>`;
    document.body.appendChild(y);
    const g = $('#girdi');
    g.oninput = () => { g.style.height = 'auto'; g.style.height = Math.min(150, g.scrollHeight) + 'px'; };
    $('#gonder').onclick = gonder;
    $$('[data-o]').forEach(b => b.onclick = () => { g.value = b.dataset.o; gonder(); });
    $('#foto').onclick = () => $('#fotoSec').click();
    $('#fotoSec').onchange = async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { ek = await kucult(f); ekCiz(); } catch { toast('Fotoğraf okunamadı'); } };
    $('#mik').onclick = sesle;
  }
  ekCiz(); islemBagla();
  $('#yeniSohbet')?.addEventListener('click', () => onay('Yeni sohbet başlasın mı?', 'Bu telefondaki konuşma geçmişi silinir. Defter ve analizler yerinde kalır.', () => { S.sohbet = []; ls.yaz('imp_sohbet', []); $('.yazma')?.remove(); sohbetBolumu(); }, { evetYazi: 'Başlat' }));
  requestAnimationFrame(() => scrollTo(0, document.body.scrollHeight));
}
function ekCiz() { const o = $('#ekOn'); if (!o) return; o.innerHTML = ek ? `<div class="ek-on"><img src="data:${ek.mime};base64,${ek.data}" alt=""><span class="bosluk kucuk">Fotoğraf hazır. İstersen ne yapayım yaz, ya da direkt gönder.</span><button class="ikon" style="width:44px;height:44px;border:0" id="ekSil">✕</button></div>` : ''; if (ek) $('#ekSil').onclick = () => { ek = null; ekCiz(); }; }
async function kucult(f) {
  const u = URL.createObjectURL(f);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
    const o = Math.min(1, 1800 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * o); c.height = Math.round(img.height * o);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
  } finally { URL.revokeObjectURL(u); }
}
let ses = null;
function sesle() {
  const b = $('#mik'), g = $('#girdi');
  if (ses) { ses.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Klavyedeki mikrofon tuşuna basarak da konuşabilirsin', 4000);
  const r = new SR(), bas = g.value ? g.value.trimEnd() + ' ' : '';
  r.lang = 'tr-TR'; r.interimResults = true; r.continuous = true;
  r.onresult = e => { g.value = bas + [...e.results].map(x => x[0].transcript).join('').trim(); g.oninput(); };
  r.onerror = e => { if (e.error === 'not-allowed') toast('Mikrofon izni verilmedi'); };
  r.onend = () => { b.classList.remove('kayitta'); ses = null; };
  ses = r; b.classList.add('kayitta');
  try { r.start(); } catch { b.classList.remove('kayitta'); ses = null; }
}
const sayac = () => { const s = ls.al('imp_sayac', {}); return s.gun === bugun() ? s.n : 0; };
async function gonder() {
  ses?.stop();
  const g = $('#girdi'), foto = ek, text = g.value.trim() || (foto ? 'Bu fotoğraftaki işlemleri deftere aktar.' : '');
  if (!text || S.mesgul) return;
  S.mesgul = true; g.value = ''; g.oninput(); ek = null; ekCiz(); $('#oneriler').innerHTML = '';
  S.sohbet.push({ role: 'user', text, ...(foto ? { foto: true } : {}) });
  $('#msjlar').insertAdjacentHTML('beforeend', `<div class="msj ben">${foto ? '<span class="ek">📷 fotoğraf</span>' : ''}${esc(text)}</div><div class="msj o" id="yaziyor"><span class="yaziyor"><span></span><span></span><span></span></span></div>`);
  scrollTo(0, document.body.scrollHeight);
  try {
    const gecmis = S.sohbet.slice(-30).map(m => ({ role: m.role, text: m.text + (m.islemler?.length ? (m.durum === 'ok' ? '\n(Bu işlemler onaylandı ve deftere yazıldı.)' : m.durum === 'iptal' ? '\n(Kullanıcı bu işlemlerden vazgeçti.)' : '\n(İşlemler onay bekliyor.)') : '') }));
    const r = await api('sohbet', { mesajlar: gecmis, ekler: foto ? [foto] : [], hafif: sayac() >= 20 });
    ls.yaz('imp_sayac', { gun: bugun(), n: sayac() + 1 });
    const { text: cevap, islemler } = islemAyikla(r.metin);
    S.sohbet.push({ role: 'model', text: cevap || '👍', ...(islemler.length ? { islemler } : {}), ...(r.kaynaklar?.length ? { kaynaklar: r.kaynaklar } : {}) });
  } catch (e) {
    S.sohbet.pop(); g.value = text; if (foto) { ek = foto; ekCiz(); }
    $('#yaziyor')?.remove(); $('#msjlar').insertAdjacentHTML('beforeend', `<div class="msj o hata">⚠️ ${esc(e.message)}</div>`);
    S.mesgul = false; return;
  }
  S.mesgul = false; ls.yaz('imp_sohbet', S.sohbet.slice(-60));
  sohbetBolumu();
}
function islemBagla() {
  $$('[data-iptal]').forEach(b => b.onclick = () => { S.sohbet[Number(b.dataset.iptal)].durum = 'iptal'; ls.yaz('imp_sohbet', S.sohbet); sohbetBolumu(); });
  $$('[data-onay]').forEach(b => b.onclick = async () => {
    const m = S.sohbet[Number(b.dataset.onay)]; if (!m || m.durum) return;
    m.durum = 'isleniyor'; sohbetBolumu();
    try {
      const ekle = m.islemler.filter(o => o.tip === 'islem').map(({ tip, ...k }) => k);
      if (ekle.length) veriKoy(await api('islem', { ekle }));
      for (const o of m.islemler.filter(o => o.tip === 'duzelt')) veriKoy(await api('islem', { duzelt: { Kimlik: o.Kimlik, ...o.yeni } }));
      for (const o of m.islemler.filter(o => o.tip === 'sil')) veriKoy(await api('islem', { sil: o.Kimlik }));
      const tk = m.islemler.filter(o => o.tip === 'takip');
      if (tk.length) { let l = [...(S.veri.takip || [])]; tk.forEach(o => { l = o.ekle ? [...new Set([...l, o.kod])] : l.filter(k => k !== o.kod); }); veriKoy(await api('takip', { kodlar: l })); }
      m.durum = 'ok'; toast('Deftere yazıldı ✓'); fiyatYukle().catch(() => {});
    } catch (e) { m.durum = 'hata'; m.hataMsj = e.message; }
    ls.yaz('imp_sohbet', S.sohbet); sohbetBolumu();
  });
}

// ---------- Ayarlar ----------
function ayarlar() {
  const a = S.veri?.ayar || {};
  const w = pencere(`<h2>Ayarlar</h2>
    <label class="etiket">Görünüm</label><div class="seg" id="aTema"><button data-t="">Otomatik</button><button data-t="acik">Açık</button><button data-t="koyu">Gece</button></div>
    <p class="soluk kucuk">Otomatik: telefon gece moduna geçince uygulama da koyu olur.</p>
    <label class="etiket">Yazı boyutu</label><div class="seg" id="aBoyut"><button data-b="">Büyük</button><button data-b="cok">Çok büyük</button></div>
    <label class="etiket" for="aSoz">İmparator’un sözleri</label><textarea id="aSoz" rows="5" maxlength="3000" placeholder="Her satıra bir söz. Kürtçe ise yanına Türkçesi: Dilop dilop dibe gol (Damla damla göl olur)">${esc(a.sozler || '')}</textarea>
    <p class="soluk kucuk">Babanın gerçekten kullandığı deyim ve atasözleri. İmparator önce bunları kullanır.</p>
    <label class="etiket" for="aKom">Komisyon oranı (binde)</label><input id="aKom" inputmode="decimal" placeholder="ör. 2 (binde 2)" value="${esc(String(a.komisyon_binde || '').replace('.', ','))}">
    <p class="soluk kucuk">Aracı kurumunun aldığı komisyon. Girersen her alış ve satışta otomatik hesaplanır; istersen kayıtta elle değiştirirsin.</p>
    <button class="btn" id="aKaydet">Kaydet</button>
    <button class="btn ikinci" id="aGuncelle" style="margin-top:10px">Uygulamayı güncelle</button>
    <p class="soluk cok-kucuk" style="text-align:center">İmparator ${SURUM} · Defter Google Sheet’te tutulur</p>`);
  const tm = localStorage.getItem('imp_tema') || '';
  $$('#aTema button', w).forEach(b => { b.classList.toggle('on', b.dataset.t === tm); b.onclick = () => { temaUygula(b.dataset.t); $$('#aTema button', w).forEach(x => x.classList.toggle('on', x === b)); }; });
  const boyut = localStorage.getItem('imp_boyut') || '';
  $$('#aBoyut button', w).forEach(b => { b.classList.toggle('on', b.dataset.b === boyut); b.onclick = () => { localStorage.setItem('imp_boyut', b.dataset.b); document.documentElement.dataset.boyut = b.dataset.b; $$('#aBoyut button', w).forEach(x => x.classList.toggle('on', x === b)); }; });
  $('#aKaydet', w).onclick = async () => { $('#aKaydet', w).disabled = true; try { veriKoy(await api('ayar', { sozler: $('#aSoz', w).value.trim(), komisyon_binde: $('#aKom', w).value })); w.kapat(); toast('Kaydedildi'); yenidenCiz(); } catch (e) { toast(e.message); $('#aKaydet', w).disabled = false; } };
  $('#aGuncelle', w).onclick = async () => { try { (await navigator.serviceWorker?.getRegistrations?.() || []).forEach(r => r.unregister()); (await caches.keys()).forEach(k => caches.delete(k)); } catch { /* yok */ } location.reload(); };
}

// ---------- Görünüm: otomatik (telefona uyar) / açık / koyu ----------
const AY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const GUNES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M1.5 12H4M20 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>';
const sistemKoyu = matchMedia('(prefers-color-scheme: dark)');
const koyuMu = () => { const t = localStorage.getItem('imp_tema'); return t ? t === 'koyu' : sistemKoyu.matches; };
function temaUygula(t) {
  if (t !== undefined) { if (t) localStorage.setItem('imp_tema', t); else localStorage.removeItem('imp_tema'); }
  const v = localStorage.getItem('imp_tema'); if (v) document.documentElement.dataset.tema = v; else delete document.documentElement.dataset.tema;
  $('#temaRenk')?.setAttribute('content', koyuMu() ? '#0d0f13' : '#f4f4f1');
  const b = $('#temaBtn'); if (b) { b.innerHTML = koyuMu() ? GUNES : AY; b.setAttribute('aria-label', koyuMu() ? 'Açık mod' : 'Gece modu'); }
}
sistemKoyu.addEventListener?.('change', () => temaUygula());

// ---------- Açılış ----------
async function baslat() {
  $$('#sekmeler button').forEach(b => b.onclick = () => sekmeGit(b.dataset.s));
  if (!history.state?.t) { history.replaceState({ t: 'kok' }, ''); history.pushState({ t: 'uygulama' }, ''); }
  $('#ayarBtn').onclick = ayarlar;
  temaUygula(); $('#temaBtn').onclick = () => temaUygula(koyuMu() ? 'acik' : 'koyu');
  if (!S.anahtar) return anahtarsiz();
  if (S.veri) ciz(); else app().innerHTML = '<div class="giris"><img class="avatar" src="img/aydin.png" alt=""><p class="soluk">Defter açılıyor…</p></div>';
  try { await veriYukle(); ciz(); kuyrukGonder(); } catch (e) { if (S.anahtar) toast('Defter okunamadı: ' + e.message, 5000); if (!S.veri) return; }
  try { await fiyatYukle(); yenidenCiz(); } catch { /* fiyat yoksa da çalışır */ }
}
// Ekrana dönünce (60 sn'den eskiyse) fiyatları yenile; piyasa ekranı açıkken dakikada bir
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.anahtar && Date.now() - fiyatZaman > 60000) { fiyatYukle().then(yenidenCiz).catch(() => {}); veriYukle().then(yenidenCiz).catch(() => {}); } });
setInterval(() => { if (document.visibilityState === 'visible' && S.anahtar && S.sekme !== 'imparator' && Date.now() - fiyatZaman > 60000) fiyatYukle().then(yenidenCiz).catch(() => {}); }, 30000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
baslat();
