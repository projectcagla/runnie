# Runnie — Koşu Şiddeti Asistanı

Orta seviye koşucular için koşu sonrası dürüstlük motoru: *"Bu koşu olması gereken şiddette miydi?"*

---

## 1. Sıfırdan Kurulum

### 1.1. Sistem Gereksinimleri
- **Node.js:** v22.0.0 veya üzeri (`node:sqlite` ve `--experimental-strip-types` desteği için zorunludur).
- **macOS / iOS:** macOS 14+, Xcode 15+ (iOS 16.0+ hedefi).
- **Harici Bağımlılıklar:** Sıfır (`package.json` içinde hiçbir harici npm paketi bulunmaz; doğrudan Node.js çekirdek modülleri kullanılır).

### 1.2. Ortam Değişkenleri (`.env` veya Shell)
İsteğe bağlı olarak aşağıdaki ortam değişkenleri ayarlanabilir:
- `PORT`: HTTP sunucu portu (Varsayılan: `3000`).
- `DB_PATH`: SQLite veritabanı dosya yolu (Varsayılan: `./data/runapp.sqlite`).
- `AUTH_SECRET`: Dahili imzalama tuzu.
- `TARGET_DELIVERY_SLA_SEC`: Bildirim gecikme hedefi (Varsayılan: `180` sn / 3 dakika).

### 1.3. Veritabanı Hazırlığı
Ayrı bir migrasyon adımı gerekmez. Sunucu başlatıldığında `backend/src/db/database.ts`, `PRAGMA journal_mode = WAL;` ve `PRAGMA foreign_keys = ON;` ayarlarını açar ve `backend/src/db/schema.sql` dosyasını otomatik olarak işletir.

---

## 2. Sunucuyu Başlatma

```bash
node --experimental-strip-types backend/src/server.ts
```

- **Ne yapar:** HTTP sunucusunu başlatır, SQLite veritabanını bağlar, şemayı kontrol eder ve dinlemeye geçer.
- **Başarılı çıktı:**
  ```text
  [Koşu Şiddeti Asistanı Backend] Çalışıyor: http://localhost:3000
  ```
- **Başarısızlık çıktısı:**
  - `EADDRINUSE`: Port 3000 dolu.
  - `MODULE_NOT_FOUND` / `SyntaxError`: Node.js sürümü 22'den eski.

---

## 3. iOS Projesini Açma ve Cihaza Yükleme

1. **Xcode Projesi:**
   - `ios/RunApp/` klasöründeki Swift dosyalarını (`RunApp.swift`, `ContentView.swift`, `SyncService.swift`) ve `ios/HealthKitReader/` dosyalarını (`HealthKitManager.swift`, `WorkoutNormalizer.swift`, `HealthKitTestView.swift`) yeni bir SwiftUI iOS projesine ekleyin.
2. **HealthKit Yetkisi:**
   - Xcode'da projenin **Signing & Capabilities** sekmesine gidin.
   - **+ Capability** düğmesine basarak **HealthKit** yetkisini ekleyin ve **Clinical Health Records** dışındaki antrenman / sensör kutularını işaretleyin.
   - Projenin `Info.plist` dosyasına şu anahtarı ekleyin:
     - `Privacy - Health Share Usage Description`: *"Koşu şiddetinizi, aerobik eşiğinizi ve toparlanma maliyetinizi analiz etmek için antrenman verilerinize ihtiyaç duyulur."*
3. **Fiziksel Cihaza Dağıtım:**
   - iPhone'unuzu Mac'e bağlayın, geliştirici sertifikanızı seçin ve **Run (Cmd + R)** tuşuna basın. Uygulama ilk açıldığında HealthKit izin penceresi görüntülenecektir.

---

## 4. Örnek Veri Üreteci (Sentetik Hat Doğrulaması)

Gerçek arşiv olmadan uçtan uca veri akışını sınamak için sentetik veri üreteci:

```bash
node --experimental-strip-types scripts/generate-synthetic-dataset.ts
```

- **Ne yapar:** `data/synthetic_test_activities.json` dosyasına 6 farklı senaryoyu (kolay koşu, gri bölge sapması, sıcak hava beraati, interval tespiti ve mükerrer çift) temsil eden sentetik veriyi yazar.
- **NOT:** Bu veri sentetiktir; yalnızca sunucu ve kuyruk hattını denemek içindir, ürün doğrulaması sayılamaz.
- **Başarılı çıktı:**
  ```text
  ========================================================================
  KOŞU ŞİDDETİ ASİSTANI — SENTETİK VERİ ÜRETECİ
  ========================================================================
  Hedef Dosya: .../data/synthetic_test_activities.json
  Üretilen Aktivite Sayısı: 6
  ...
  ========================================================================
  ```
- **Başarısızlık çıktısı:** Dosya yazma hatası (`EACCES` veya `ENOENT`).

---

## 5. Gerçek Apple Health Arşivini İnceleme (Keşif Betiği)

```bash
node --experimental-strip-types scripts/inspect-health-export.ts /path/to/apple_health_export
```

- **Ne yapar:** İki geçişli akışla XML dosyasını ve GPX rotalarını okur; bellek taşması olmadan 3 kademeli tempo dağılımını, nabız sıklığını, mükerrer kayıtları ve VO2max varlığını raporlar.
- **Başarı Kriteri (Dört Kapı):**
  1. *Anlık Tempo Kapsamı:* Açık alan koşularının en az **%80**'inde Kademe 1, 2 veya 3 anlık hız kaynağı bulunmalıdır.
  2. *Nabız Kapsamı:* Koşuların en az **%85**'inde ortalama örnekleme aralığı $\le 10$ saniye olan nabız verisi bulunmalıdır.
  3. *Fizyolojik Çıpa:* En az 1 adet VO2max kaydı VEYA konuşma testi çıpası bulunmalıdır.
  4. *Mükerrerlik Oranı:* Çift antrenman oranı toplam antrenmanların **<%20**'si olmalıdır.
- **Başarısızlık:** Yukarıdaki 4 orandan herhangi birinin baraj altında kalması durumunda mimari o kullanıcı arşivi için `CALIBRATION_PENDING` moduna geçer.

---

## 6. Testler ve İddiaları

Tüm testleri çalıştırmak için komut:

```bash
npm test
```

### 6.1. `tests/backend.test.ts`
- **İddia 1 (Cihaz Kimlik Doğrulama):** Cihaz kaydında sunucunun en az 256-bit entropili bağımsız token ürettiğini, bu token ile oturum açılabildiğini, rastgele sahte token'ların `null` döndüğünü iddia eder.
  - *Başarısızlık:* Sahte token ile oturum açılması veya üretilen token'ın $<64$ karakter olması.
- **İddia 2 (Tekilleştirme):** Tekil kopyaların asla silinmediğini; mükerrer çiftte ise sensörsüz Strava kaydına karşı donanım Apple Watch kaydının korunduğunu iddia eder.
  - *Başarısızlık:* Tek kopya aktivitenin elenmesi veya üçüncü taraf kaydın donanıma tercih edilmesi.
- **İddia 3 (Hava Servisi Kesinliği):** Koordinat yokken servisin kesinlikle 20°C / %50 uydurmadığını, deterministik olarak `UNAVAILABLE` döndüğünü iddia eder.
  - *Başarısızlık:* `res.status`'ün `AVAILABLE` çıkması veya varsayılan sayı dönmesi.
- **İddia 4 (Unutulma Hakkı):** Kullanıcı silme isteğinde tüm kişisel ve antrenman verisinin fiziksel olarak silindiğini ve tuzlanmış denetim kaydının oluştuğunu iddia eder.
  - *Başarısızlık:* Silinen kullanıcının tablolarda satırının kalması.
- **İddia 5 (Uçtan Uca Değerlendirme):** Senkronize edilen aktivitenin iş kuyruğunda işlenip `assessments` tablosuna değişmez Türkçe hüküm yazdığını iddia eder.
  - *Başarısızlık:* Değerlendirme cümlesinin boş kalması veya kuyruk durumunun `FAILED` olması.

### 6.2. `tests/engine.test.ts`
- **İddia:** Isınma kırpma penceresini, kadans kilitlenmesi tespitini, 4 bölgeli dağılımı ve ısı beraatini test eder.
  - *Başarısızlık:* Isınma anındaki nabzın kolay koşuyu "aşırı efor" yapması veya sıcak havada korunan temponun azarlanması.

### 6.3. `tests/thresholds.test.ts`
- **İddia:** Daniels VDOT formülü, ampirik eşleme koridoru ve tepe nabız güvenlik tavanının ($HR_{max} \times 0.82$) doğruluğunu iddia eder.
  - *Başarısızlık:* Eşik üstü tempoların ampirik AeT olarak onaylanması.

### 6.4. `tests/appleHealthXmlParser.test.ts`
- **İddia:** XML akışında HRV ve toparlanma nabızlarının elendiğini, iki işaretçili taramanın doğru en yakın komşuyu seçtiğini iddia eder.
  - *Başarısızlık:* HRV değerlerinin nabız akışına sızması.

### 6.5. `tests/textUtils.test.ts` ve `tests/forbiddenWords.test.ts`
- **İddia:** Türkçe İ/ı normalizasyonunun kusursuz çalıştığını ve yasaklı tıbbi/biyolojik kelimelerin şablonlarda bulunmadığını iddia eder.
  - *Başarısızlık:* Yasaklı kelime listesinden herhangi bir terimin motordan sızması.

---

## 7. Komut Listesi ve Çıktı Kılavuzu

| Komut | Ne Yapar? | Başarılı Çıktı Örneği | Başarısızlık Göstergesi |
| :--- | :--- | :--- | :--- |
| `npm test` | Tüm birim ve entegrasyon testlerini Node test koşucusuyla yürütür | `ℹ tests 27`<br>`ℹ suites 0`<br>`ℹ pass 27`<br>`ℹ fail 0` | `✖ fail 1` veya daha fazla kırmızı test hatası |
| `node --experimental-strip-types backend/src/server.ts` | Backend sunucusunu ve SQLite veritabanını başlatır | `[Koşu Şiddeti Asistanı Backend] Çalışıyor: http://localhost:3000` | Port çakışması (`EADDRINUSE`) veya veritabanı kilitlenmesi |
| `curl -i http://localhost:3000/v1/health` | Backend sağlık kontrolü | `HTTP/1.1 200 OK`<br>`{"status":"healthy",...}` | `Connection refused` (Sunucu kapalı) |
| `node --experimental-strip-types scripts/generate-synthetic-dataset.ts` | Test için sentetik koşu veri seti üretir | `Hedef Dosya: .../data/synthetic_test_activities.json`<br>`Üretilen Aktivite Sayısı: 6` | Dosya yazılamadı (`EACCES`) |
| `node --experimental-strip-types scripts/inspect-health-export.ts <yol>` | Gerçek Apple Health XML dışa aktarımını inceler | 4 Kriter Özeti:<br>Anlık Hız: $\ge \%80$<br>Nabız Sıklığı: $\le 10$s<br>Fizyolojik Çıpa: $\ge 1$<br>Mükerrerlik: $<\%20$ | Kapsama oranlarının baraj altında kalması |
