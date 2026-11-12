// İmparator — Cloudflare Worker
// Görevleri: siteyi sunmak, defteri Mervan'ın Google Sheet'ine okuyup yazmak (servis hesabıyla), piyasa fiyatları,
// İmparator'un sohbeti ve hafta içi her sabah/akşam kendiliğinden yazdığı analiz. Hiçbir veri burada saklanmaz.
//
// Şifre yok: babanın telefonu bir kez özel bağlantıyla açılır (…/?k=GIZLI), anahtar telefonda saklanır.
// Gizli değişkenler (Cloudflare > Workers > imparator > Settings > Variables and Secrets):
//   GIZLI           Rastgele uzun bir metin = erişim anahtarı (bağlantıdaki k=…; değiştirirsen eski bağlantı çalışmaz)
//   GOOGLE_SA_JSON  Servis hesabı anahtar dosyasının tamamı (Nébula'dakiyle aynı servis hesabı olabilir)
//   SHEET_ID        Defterin Google Sheet adresi ya da kimliği (Sheet servis hesabıyla Düzenleyen olarak paylaşılmalı)
//   GEMINI_KEY      Gemini API anahtarı
import * as SH from './sheets.js';
import { fiyatlar, ara, PIYASA } from './piyasa.js';
import { gemini, kisilik, veriOzeti, ISLEM_KURALI, analizIstemi, analizAyir, bugunTR } from './imparator.js';
import { hesapla, kodTemiz, sayi, TURLER } from '../public/hesap.js';

const SURUM = 'v4';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const esit = (a, b) => { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const yetkili = (k, env) => esit(String(k || ''), String(env.GIZLI || ''));

// Sheet satırlarını uygulamanın biçimine çevir
const isoTarih = v => { const s = String(v || '').trim(); const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.slice(0, 10); };
const islemDis = r => ({ Kimlik: String(r.Kimlik), Tarih: isoTarih(r.Tarih), Tur: r['Tür'], Hisse: kodTemiz(r.Hisse), Adet: sayi(r.Adet), Fiyat: sayi(r.Fiyat), Komisyon: sayi(r.Komisyon), Not: String(r.Not || ''), Kayit: String(r['Kayıt'] || '') });
function islemIc(k, eski = {}) {
  const tur = TURLER.includes(k.Tur) ? k.Tur : eski['Tür'] || 'Alış';
  const o = { Kimlik: String(k.Kimlik || eski.Kimlik || ('i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))), Tarih: /^\d{4}-\d{2}-\d{2}$/.test(k.Tarih || '') ? k.Tarih : (eski.Tarih || bugunTR()), 'Tür': tur, Hisse: kodTemiz(k.Hisse ?? eski.Hisse), Adet: tur === 'Temettü' ? '' : sayi(k.Adet ?? eski.Adet), Fiyat: sayi(k.Fiyat ?? eski.Fiyat), Komisyon: sayi(k.Komisyon ?? eski.Komisyon), Not: String(k.Not ?? eski.Not ?? '').slice(0, 200), 'Kayıt': eski['Kayıt'] || new Date().toISOString() };
  if (!o.Hisse) throw new Error('Hisse kodu yok');
  if (tur !== 'Temettü' && !(o.Adet > 0)) throw new Error('Adet sıfır olamaz');
  if (['Alış', 'Satış', 'Temettü'].includes(tur) && !(o.Fiyat > 0)) throw new Error('Fiyat sıfır olamaz');
  return o;
}
async function veri(env) {
  const t = await SH.hepsiniOku(env);
  const ayar = Object.fromEntries((t['Ayarlar'] || []).map(r => [r.Anahtar, r['Değer']]));
  return {
    islemler: (t['İşlemler'] || []).filter(r => r.Kimlik && r.Hisse).map(islemDis),
    analizler: (t['Analizler'] || []).filter(r => r['Metin']).map(r => ({ Tarih: isoTarih(r.Tarih), Saat: String(r.Saat || ''), Tur: r['Tür'], Baslik: r['Başlık'], Metin: r['Metin'] })).sort((a, b) => (b.Tarih + b.Saat).localeCompare(a.Tarih + a.Saat)).slice(0, 30),
    takip: (t['Takip'] || []).map(r => kodTemiz(r.Kod)).filter(Boolean),
    ayar: { sozler: String(ayar.sozler || ''), komisyon_binde: ayar.komisyon_binde ?? '' },
  };
}

async function analizYap(env, tur) {
  const v = await veri(env);
  const h = hesapla(v.islemler);
  const kodlar = [...new Set([...h.acik.map(p => p.kod), ...v.takip])];
  const fiyat = await fiyatlar(kodlar).catch(() => ({ piyasa: {}, hisseler: {} }));
  const ozet = veriOzeti({ islemler: v.islemler, ayar: v.ayar, takip: v.takip, fiyat, sonAnaliz: v.analizler[0] });
  const r = await gemini(env, { system: kisilik(v.ayar), contents: [{ role: 'user', parts: [{ text: analizIstemi(tur, ozet) }] }], arama: true, sure: 90000, uzun: true });
  const { baslik, metin } = analizAyir(r.text);
  const saat = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const satir = { Tarih: bugunTR(), Saat: saat, 'Tür': tur, 'Başlık': baslik, 'Metin': metin + (r.kaynaklar.length ? '\n\nKaynaklar: ' + r.kaynaklar.map(k => k.baslik || k.url).join(' · ') : '') };
  await SH.ekle(env, 'Analizler', [satir]);
  return { Tarih: satir.Tarih, Saat: saat, Tur: tur, Baslik: baslik, Metin: satir.Metin };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (p === '/api/saglik') {
        let sa = null, sheet = false, hata = null;
        try { sa = SH.servisHesabi(env).client_email; } catch (e) { hata = e.message; }
        if (sa && SH.sheetKimlik(env)) { try { await SH.hazirla(env); sheet = true; } catch (e) { hata = e.message; } }
        return json({ surum: SURUM, gizli: !!env.GIZLI, gemini: !!env.GEMINI_KEY, servisHesabi: sa, sheet, hata });
      }
      // Ana ekrana eklenirken anahtar kaybolmasın: uygulama bağlantısı anahtarla açılır
      if (p === '/api/manifest') {
        const k = url.searchParams.get('k') || '', ok = yetkili(k, env);
        return new Response(JSON.stringify({ name: 'İmparator', short_name: 'İmparator', start_url: ok ? '/?k=' + encodeURIComponent(k) : '/', scope: '/', display: 'standalone', background_color: '#f4f4f1', theme_color: '#f4f4f1', lang: 'tr',
          icons: [{ src: '/img/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png' }] }), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' } });
      }
      if (!env.GIZLI) return json({ hata: 'Sunucuda GIZLI tanımlı değil' }, 500);
      if (!yetkili(request.headers.get('x-anahtar'), env)) return json({ hata: 'anahtar', giris: true }, 401);

      if (p === '/api/veri') return json({ ...(await veri(env)), surum: SURUM });
      if (p === '/api/islem' && request.method === 'POST') {
        const b = await request.json();
        if (Array.isArray(b.ekle) && b.ekle.length) await SH.ekle(env, 'İşlemler', b.ekle.slice(0, 60).map(k => islemIc(k)));
        if (b.duzelt?.Kimlik) {
          const t = (await SH.hepsiniOku(env))['İşlemler'] || [], eski = t.find(r => String(r.Kimlik) === String(b.duzelt.Kimlik));
          if (!eski) throw new Error('Kayıt bulunamadı');
          const yeni = islemIc({ ...islemDis(eski), ...b.duzelt }, eski);
          await SH.guncelle(env, 'İşlemler', 'Kimlik', b.duzelt.Kimlik, yeni);
        }
        if (b.sil) await SH.sil(env, 'İşlemler', 'Kimlik', b.sil);
        return json(await veri(env));
      }
      if (p === '/api/takip' && request.method === 'POST') {
        const b = await request.json(); await SH.takipYaz(env, [...new Set((b.kodlar || []).map(kodTemiz).filter(Boolean))].slice(0, 40));
        return json(await veri(env));
      }
      if (p === '/api/ayar' && request.method === 'POST') {
        const b = await request.json(), y = {};
        if (b.sozler !== undefined) y.sozler = String(b.sozler).slice(0, 3000);
        if (b.komisyon_binde !== undefined) y.komisyon_binde = String(sayi(b.komisyon_binde));
        await SH.ayarYaz(env, y); return json(await veri(env));
      }
      if (p === '/api/fiyat' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        return json(await fiyatlar((b.kodlar || []).map(kodTemiz).filter(Boolean), { gecmis: !!b.gecmis }));
      }
      if (p === '/api/ara') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 30);
        return json(q.length >= 2 ? await ara(q).catch(() => []) : []);
      }
      if (p === '/api/sohbet' && request.method === 'POST') {
        const b = await request.json();
        const v = await veri(env), h = hesapla(v.islemler);
        const fiyat = await fiyatlar([...new Set([...h.acik.map(x => x.kod), ...v.takip])]).catch(() => ({ piyasa: {}, hisseler: {} }));
        const system = `${kisilik(v.ayar)}\n\n${ISLEM_KURALI}\n\nVERİLER:\n${veriOzeti({ ...v, fiyat, sonAnaliz: v.analizler[0] })}${v.analizler[0] ? `\n\nSON ANALİZİN METNİ:\n${v.analizler[0].Metin.slice(0, 2500)}` : ''}`;
        const contents = (b.mesajlar || []).slice(-30).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: String(m.text || '').slice(0, 4000) }] }));
        if (!contents.length) throw new Error('Mesaj yok');
        const ekler = (b.ekler || []).slice(0, 3).filter(e => e?.data && /^image\//.test(e.mime || ''));
        contents[contents.length - 1].parts.push(...ekler.map(e => ({ inline_data: { mime_type: e.mime, data: e.data } })));
        const r = await gemini(env, { system, contents, arama: !ekler.length, hafif: !!b.hafif, sure: ekler.length ? 80000 : 45000, uzun: ekler.length > 0 });
        return json({ metin: r.text, model: r.model, kaynaklar: r.kaynaklar });
      }
      if (p === '/api/analiz' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        return json(await analizYap(env, ['Sabah', 'Akşam'].includes(b.tur) ? b.tur : 'Güncel'));
      }
      return json({ hata: 'bulunamadı' }, 404);
    } catch (e) {
      return json({ hata: String(e.message || e).slice(0, 300) }, 500);
    }
  },

  // Hafta içi 08:45 (sabah) ve 18:45 (akşam) İstanbul saatiyle analiz yazılır (wrangler.jsonc > triggers)
  async scheduled(event, env, ctx) {
    const saat = new Date(event.scheduledTime).getUTCHours();
    const tur = saat < 10 ? 'Sabah' : 'Akşam';
    ctx.waitUntil((async () => {
      const v = await veri(env);
      if (v.analizler.some(a => a.Tarih === bugunTR() && a.Tur === tur)) return;
      await analizYap(env, tur);
    })().catch(e => console.error('analiz yazılamadı', e)));
  },
};
export { PIYASA };
