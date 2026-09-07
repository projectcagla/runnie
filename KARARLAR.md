# Koşu Şiddeti Asistanı — Mimari ve Teknik Kararlar Kaydı (KARARLAR.md)

Bu doküman, kullanıcı tarafından devredilen yetki kapsamında sistemin inşa edilmesi sırasında alınan nihai teknik kararları, elenen alternatifleri ve gerekçelerini kayıt altına alır.

---

## 1. Eşik Türetme Formülü ve Katsayılar

### 1.1. Eşik Türetme Hiyerarşisi
- **Ne seçildi:** 3 kademeli öncelik hattı:
  1. **Çıpa Varsa (Öncelik 1):** Koşucunun beyan ettiği konuşma testi nabzı doğrudan $AeT_{point}$ alınır. Hata koridoru dar tutulur ($\pm 2\text{ bpm}$). Güven skoru: `0.90`.
  2. **VO2max + Ampirik Eşleme Varsa (Öncelik 2):** Apple Health VO2max değerinden Daniels VDOT formülüyle kolay tempo tavanı ($vVO2max \times 0.68$) hesaplanır. Bu temponun $\pm 25\text{ sn/km}$ koridorundaki stabil nabızların medyanı ampirik $AeT_{point}$ yapılır. Hata koridoru: $\pm 3\text{ bpm}$. Güven skoru: `0.82`.
  3. **Yalnızca VO2max Varsa (Öncelik 3):** Daniels formülünden teorik $AeT$ türetilir ($AeT = LTHR \times 0.88$, $LTHR = HR_{max} \times 0.88$). Hata koridoru geniş tutulur ($\pm 6\text{ bpm}$). Güven skoru: `0.60`.
  4. **Soğuk Başlangıç / Veri Yok (Öncelik 4):** Formül tahmini devre dışı bırakılır. Motor `CALIBRATION_PENDING` modunda kalır, hüküm üretmez.
- **Elenen alternatifler:** 
  - *Karvonen Formülü:* Dinlenik nabız salınımlarına ve tepe nabız tahminine aşırı duyarlı olduğu için elendi.
  - *Sabit Yaş Formülü (220 - Yaş):* Bireysel varyansı $\pm 15\text{ bpm}$ aştığı için elendi.
- **Neden:** Dördüncü turdaki analizde gösterildiği gibi, 4 katmanlı teorik zincir toplamda $\pm \%14$ kümülatif hata üretir. Bu yüzden ampirik eşleme veya konuşma testi çıpası olmadan dar bant iddia edilemez.

### 1.2. Sabit Katsayılar (`src/config.ts`)
- $LTHR / HR_{max}$ oranı: `0.88`
- $AeT / LTHR$ oranı: `0.88`
- Daniels Kolay Tempo Katsayısı: $vVO2max \times 0.68$
- Daniels Eşik Tempo Katsayısı: $vVO2max \times 0.88$
- Minetti Eğim Katsayıları: 5. derece polinom (Cost factor: `0.55` – `2.50` arası sınırlandırılmış).

---

## 2. Güven Skoru Eşikleri ve Bölge Sınırları

### 2.1. Güven Skorları (`confidenceScore`)
- `HIGH`: $\ge 0.80$ (Çıpa doğrulanmış veya ampirik eşleme yapılmış).
- `MEDIUM`: $0.60$ – $0.79$ (Sadece teorik VO2max veya yarış eforu).
- `LOW`: $< 0.60$ (Soğuk başlangıç veya $<6$ antrenman).

### 2.2. Dört Bölgeli Ayrık Dağılım
Motor içinde 4 bölge birbirine karıştırılmadan saklanır:
1. **Kesin Kolay (`defEasySec`):** $HR < AeT_{min}$
2. **Belirsizlik Koridoru (`uncCorridorSec`):** $AeT_{min} \le HR \le AeT_{max}$
3. **Kesin Gri Bölge (`defGraySec`):** $AeT_{max} < HR \le LTHR$
4. **Eşik Üstü (`defThreshSec`):** $HR > LTHR$

### 2.3. Hüküm Kuralları
- **`ACCORDING_TO_PLAN`:** Kesin Kolay oranı $\ge \%75$.
- **`DRIFTED_GRAY`:** (Kesin Gri + Eşik Üstü) $\ge \%25$ ve Eşik Üstü $<\%15$.
- **`DRIFTED_THRESHOLD`:** Eşik Üstü $\ge \%15$.
- **`BOUNDARY_ZONE`:** Ortalama nabza bakılmaz; antrenmanın $\ge \%25$'i Belirsizlik Koridorunda geçmişse veya Kolay + Koridor $\ge \%80$ ise verilir.
- **`WEATHER_PARDON`:** Isı stresi ($T \ge 24^\circ\text{C}$ ve $RH \ge \%75$) mevcutken tempo kolay koridorda ($GAP \ge \text{easyPaceCeiling}$) tutulmuşsa, nabız yükselmesi beraat ettirilir.

---

## 3. Motorun Sustuğu Durumlar (`OBSERVATION_ONLY` / Sessizlik)

Aşağıdaki durumlarda motor kullanıcıya hüküm bildirmez, ceza/azarlama cümlesi kurmaz:
1. **Koşu Dışı Sporlar:** Bisiklet, yürüyüş, yüzme (`NON_RUN_SPORT`).
2. **Kısa Süre:** 15 dakikanın altındaki koşular (`DURATION_TOO_SHORT`).
3. **Düşük Güven:** Güven seviyesi `LOW` iken (ilk 6 koşu tamamlanmamışsa).
4. **Yarışlar:** `RACE` niyeti tespit edildiğinde yarış fizyolojisi kolay koşu mantığıyla yargılanmaz.
5. **Aşırı Kadans Kilitlenmesi:** Antrenmanın $>\%30$'unda optik nabız kadansa kilitlenmişse ve tempo verisi yoksa (`CADENCE_LOCK`).
6. **Hava Ölçülemediğinde Belirsizlik:** `WEATHER_UNAVAILABLE` durumunda sınır ihlallerde kullanıcı doğrudan suçlanmaz, hava belirsizliği bayrak olarak taşınır.

---

## 4. Ayna Ekranı (Mirror View) Mantığı

- **Giriş Şartı:** Son 60 gün içinde en az **16 koşu** ve **100 km**.
- **Amacı:** Hüküm vermez, nasihat etmez; veriyi koşucunun yüzüne ayna olarak tutar.
- **Tetik Soru:** Eğer son 60 gündeki koşuların $\ge \%50$'si eşik üstünde veya gri bölgede bitmişse tarafsızca sorar:
  *"Son 60 günde X koşunun %Y'si AeT eşiği üzerinde geçti. Bu dağılım planlı bir maraton/tempo hazırlığı mı, yoksa farkında olmadan mı hızlandınız?"*
- **Seçimler:**
  - *Planlı Antrenman:* Motor tonunu korur, `BASE_BUILDING` toleransını uygular.
  - *Farkında Olmadan:* Motor uyarı hassasiyetini korur.

---

## 5. Veritabanı, Kütüphane ve Kimlik Doğrulama Seçimleri

### 5.1. Sıfır Dış Bağımlılık (Node.js Built-in)
- **Ne seçildi:** `node:sqlite` (`DatabaseSync`), `node:http`, `node:crypto`, `node:readline`.
- **Elenen alternatifler:** Express, Fastify, Prisma, TypeORM, better-sqlite3.
- **Neden:** Kurulum sürtünmesini sıfırlamak, `npm install` bağımlılık kırılmalarını önlemek, yerel platform güvenliğini doğrudan Node.js çekirdeğinde tutmak.

### 5.2. Frictionless Cihaz Kimlik Doğrulaması
- **Ne seçildi:** İstemciden gelen `deviceIdentifier` (Vendor UUID) sadece donanım bağlantısıdır. Sunucu `crypto.randomBytes(32)` ile 256-bit yüksek entropili gizli belirteç üretir. Diskte yalnızca `sha256(token)` tutulur. İstemci sonraki tüm isteklerde `Authorization: Bearer <token>` başlığıyla gelir.
- **Elenen alternatifler:** Cihaz UUID'sinden hash türetmek (tahmin edilebilir güvenlik açığı), OAuth (koşucudan şifre/giriş isteyerek sürtünme yaratır).

### 5.3. Konum Verisi Minimizasyonu
- **Ne seçildi:** `activities` tablosundan enlem/boylam kaldırıldı. İstemciden gelen koordinat senkronizasyon anında hava servisinde kullanılır ve derhal bellekten atılır. Diskte asla koordinat saklanmaz.
