// Google Sheets (servis hesabı ile). Defter Mervan'ın Drive'ındaki Sheet'te durur; Worker sadece okuyup yazar, hiçbir şey saklamaz.
// Gizli değişkenler: GOOGLE_SA_JSON (servis hesabı anahtar dosyasının tamamı), SHEET_ID (Sheet adresi ya da kimliği)

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = s => b64u(new TextEncoder().encode(s));
let tokenOnbellek = null;

export function servisHesabi(env) {
  const ham = String(env.GOOGLE_SA_JSON || '').trim();
  if (!ham) throw new Error('GOOGLE_SA_JSON tanımlı değil');
  let sa; try { sa = JSON.parse(ham); } catch { throw new Error('GOOGLE_SA_JSON geçerli JSON değil'); }
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SA_JSON içinde client_email/private_key yok');
  return sa;
}
async function anahtarAl(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
async function erisimTokeni(env) {
  const simdi = Math.floor(Date.now() / 1000);
  if (tokenOnbellek && tokenOnbellek.bitis > simdi + 60) return tokenOnbellek.token;
  const sa = servisHesabi(env);
  const bas = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const talep = b64uStr(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: simdi, exp: simdi + 3600 }));
  const imza = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await anahtarAl(sa.private_key), new TextEncoder().encode(`${bas}.${talep}`)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${bas}.${talep}.${imza}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google erişim anahtarı alınamadı: ' + (j.error_description || j.error || r.status));
  tokenOnbellek = { token: j.access_token, bitis: simdi + (j.expires_in || 3600) };
  return tokenOnbellek.token;
}
export function sheetKimlik(env) {
  let id = String(env.SHEET_ID || '').trim().replace(/^["']|["']$/g, '');
  const m = id.match(/\/d\/([A-Za-z0-9_-]+)/); if (m) id = m[1];
  return id.replace(/[^A-Za-z0-9_-]/g, '');
}
async function api(env, yol, secenek = {}, adim = 'istek') {
  const id = sheetKimlik(env); if (!id) throw new Error('SHEET_ID tanımlı değil');
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${yol}`, { ...secenek, headers: { authorization: 'Bearer ' + await erisimTokeni(env), 'content-type': 'application/json', ...(secenek.headers || {}) } });
  const ham = await r.text(); let j = {}; try { j = JSON.parse(ham); } catch { /* boş */ }
  if (!r.ok) {
    let msg = j.error?.message || ham.slice(0, 200) || 'boş cevap';
    if (r.status === 403 || r.status === 404) msg += ' — Sheet servis hesabıyla (Düzenleyen olarak) paylaşılmış mı?';
    const e = new Error(`Sheets ${r.status} (${adim}): ${msg}`); e.durum = r.status; throw e;
  }
  return j;
}
const kok = a => `'${a.replace(/'/g, "''")}'`;

// Sekmeler ve başlıkları: yoksa açılır, eksik başlık eklenir (veri silinmez)
export const SEKMELER = {
  'İşlemler': ['Kimlik', 'Tarih', 'Tür', 'Hisse', 'Adet', 'Fiyat', 'Komisyon', 'Not', 'Kayıt'],
  'Analizler': ['Tarih', 'Saat', 'Tür', 'Başlık', 'Metin'],
  'Takip': ['Kod'],
  'Ayarlar': ['Anahtar', 'Değer'],
};
let hazir = false, sekmeIdleri = null;
async function sekmeListesi(env, yenile = false) {
  if (sekmeIdleri && !yenile) return sekmeIdleri;
  const j = await api(env, '?fields=sheets.properties(sheetId,title)', {}, 'sekme listesi');
  sekmeIdleri = Object.fromEntries((j.sheets || []).map(s => [s.properties.title, s.properties.sheetId]));
  return sekmeIdleri;
}
export async function hazirla(env) {
  if (hazir) return;
  const var_ = await sekmeListesi(env, true);
  const eksik = Object.keys(SEKMELER).filter(t => !(t in var_));
  if (eksik.length) {
    await api(env, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: eksik.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }) }, 'sekme aç');
    await sekmeListesi(env, true);
  }
  const ust = await api(env, `/values:batchGet?${Object.keys(SEKMELER).map(t => 'ranges=' + encodeURIComponent(kok(t) + '!1:1')).join('&')}`, {}, 'başlık oku');
  const yaz = [];
  Object.entries(SEKMELER).forEach(([t, basliklar], i) => {
    const mevcut = ust.valueRanges?.[i]?.values?.[0] || [];
    const ek = basliklar.filter(b => !mevcut.includes(b));
    if (ek.length) yaz.push({ range: `${kok(t)}!${harf(mevcut.length + 1)}1`, values: [ek] });
  });
  if (yaz.length) await api(env, '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: yaz }) }, 'başlık yaz');
  hazir = true;
}
const harf = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// Hepsini tek istekte oku → { sekme: [ {başlık: değer, _row} ] }
export async function hepsiniOku(env) {
  await hazirla(env);
  const adlar = Object.keys(SEKMELER);
  const j = await api(env, `/values:batchGet?${adlar.map(t => 'ranges=' + encodeURIComponent(kok(t))).join('&')}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, {}, 'okuma');
  const out = {};
  adlar.forEach((t, i) => {
    const rows = j.valueRanges?.[i]?.values || [], bas = rows[0] || [];
    out[t] = rows.slice(1).map((r, k) => { const o = { _row: k + 2 }; bas.forEach((b, c) => { o[b] = r[c] ?? ''; }); return o; }).filter(o => Object.entries(o).some(([k, v]) => k !== '_row' && v !== ''));
  });
  return out;
}
async function basliklar(env, sekme) {
  const j = await api(env, `/values/${encodeURIComponent(kok(sekme) + '!1:1')}`, {}, 'başlık');
  return j.values?.[0] || SEKMELER[sekme];
}
export async function ekle(env, sekme, nesneler) {
  await hazirla(env);
  const bas = await basliklar(env, sekme);
  await api(env, `/values/${encodeURIComponent(kok(sekme) + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: nesneler.map(o => bas.map(b => o[b] ?? '')) }) }, 'ekle');
}
// Kimlik sütunu (ya da verilen alan) ile satırı bulup yeniden yazar
export async function guncelle(env, sekme, alan, deger, yeni) {
  const t = (await hepsiniOku(env))[sekme] || [], r = t.find(x => String(x[alan]) === String(deger));
  if (!r) throw new Error('Kayıt bulunamadı (başka yerden silinmiş olabilir)');
  const bas = await basliklar(env, sekme), { _row, ...eski } = r, son = { ...eski, ...yeni };
  await api(env, `/values/${encodeURIComponent(`${kok(sekme)}!A${_row}:${harf(bas.length)}${_row}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [bas.map(b => son[b] ?? '')] }) }, 'güncelle');
}
export async function sil(env, sekme, alan, deger) {
  const t = (await hepsiniOku(env))[sekme] || [], satirlar = t.filter(x => String(x[alan]) === String(deger)).map(x => x._row).sort((a, b) => b - a);
  if (!satirlar.length) return;
  const id = (await sekmeListesi(env))[sekme];
  await api(env, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: satirlar.map(r => ({ deleteDimension: { range: { sheetId: id, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })) }) }, 'sil');
}
// Anahtar/değer (Ayarlar)
export async function ayarYaz(env, degerler) {
  const t = (await hepsiniOku(env))['Ayarlar'] || [];
  for (const [k, v] of Object.entries(degerler)) {
    const r = t.find(x => x.Anahtar === k);
    if (r) await api(env, `/values/${encodeURIComponent(`${kok('Ayarlar')}!B${r._row}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[String(v)]] }) }, 'ayar');
    else await ekle(env, 'Ayarlar', [{ Anahtar: k, 'Değer': String(v) }]);
  }
}
export async function takipYaz(env, kodlar) {
  await hazirla(env);
  await api(env, `/values/${encodeURIComponent(kok('Takip') + '!A2:A')}:clear`, { method: 'POST', body: '{}' }, 'takip temizle');
  if (kodlar.length) await api(env, `/values/${encodeURIComponent(kok('Takip') + '!A2')}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: kodlar.map(k => [k]) }) }, 'takip yaz');
}
