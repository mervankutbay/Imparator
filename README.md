# İmparator

Babam için sade hisse defteri: alış/satış kaydı, ortalama maliyetle kâr hesabı, piyasa ekranı ve **İmparator** (yapay zekâ) ile sohbet + hafta içi her sabah/akşam otomatik analiz.

- **Veri:** Mervan'ın Google Sheet'inde (sekmeler: İşlemler, Analizler, Takip, Ayarlar — ilk açılışta kendiliğinden oluşur). Worker servis hesabıyla okur/yazar, hiçbir şey saklamaz.
- **Giriş:** telefonda bir kez 6 haneli şifre (PIN).
- **Fiyatlar:** Yahoo Finance (BIST ~15 dk gecikmeli).
- **Yapay zekâ:** Gemini (anahtar sadece Cloudflare gizli ayarında). Analiz: hafta içi 08:45 ve 18:45 (İstanbul).

## Cloudflare gizli değişkenleri
| Ad | Ne |
|---|---|
| `PIN` | 6 haneli şifre |
| `GIZLI` | rastgele uzun metin (değişirse herkes yeniden şifre girer) |
| `GOOGLE_SA_JSON` | servis hesabı anahtar dosyasının tamamı (Nébula'dakiyle aynı olabilir) |
| `SHEET_ID` | Sheet adresi ya da kimliği (Sheet servis hesabıyla **Düzenleyen** olarak paylaşılmalı) |
| `GEMINI_KEY` | Gemini API anahtarı |

Kontrol: `/api/saglik` hepsini gösterir.

## Kâr hesabı (ortalama maliyet)
- Alış: maliyete adet × fiyat + komisyon eklenir
- Satış: kâr = (adet × fiyat − komisyon) − ortalama maliyet × adet
- Bedelsiz: adet artar, maliyet aynı kalır
- Temettü: net tutar gerçekleşen kâra eklenir
