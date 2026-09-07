# Koşu Şiddeti Asistanı — Mimari ve Teknik Kararlar Kaydı (KARARLAR.md)

Bu doküman, kullanıcı tarafından devredilen yetki ve yapılan depo incelemesi kapsamında alınan nihai mimari kararları, elenen alternatifleri, düzeltilen yanlılıkları ve operasyonel kuralları kayıt altına alır.

---

## 1. Eşik Türetme Formülü, Sistematik Yanlılık Koruması ve Katsayılar

### 1.1. Eşik Türetme Hiyerarşisi (Sistematik Yanlılık Düzeltmesi)
- **Ne seçildi:** 4 kademeli öncelik hattı ve bağımsız çıpa:
  1. **Konuşma Testi Çıpası Varsa (Öncelik 1 - Altın Standart):** Koşucunun beyan ettiği konuşma testi nabzı doğrudan $AeT_{point}$ alınır. Hata koridoru dar tutulur ($\pm 2\text{ bpm}$). Güven skoru: `0.90`.
  2. **Bağımsız Ampirik Eşleme Varsa (Öncelik 2):** Daniels kolay tempo katsayısına körü körüne bağımlı kalmak yerine, koşucunun geçmiş 20 seansı taranarak **aerobik ayrışmanın en düşük olduğu ($Pw:Hr \le \%3.5$)** stabil pencerelerin medyan nabzı bulunur. Güven skoru: `0.70` (ayrışma doğrulanmışsa `0.75`).
  3. **Yalnızca Apple Health VO2max Varsa (Öncelik 3):** Daniels formülünden teorik $AeT$ türetilir. Ancak rekreasyonel koşucularda $AeT$'nin 10–15 bpm yüksek tahmin edilerek aşırı eforun sessizce onaylanmasını (Tip II hata / Tehlikeli İyimserlik) engellemek için **konservatif tavan** uygulanır ($AeT = LTHR \times 0.83$). Hata koridoru: $\pm 6\text{ bpm}$. Güven skoru: `0.60`.
  4. **Soğuk Başlangıç / Çıpasız Durum (Öncelik 4):** Kullanıcıyı boş ekran ve sessizlikle bırakmamak için ilk koşularda geçici başlangıç kalibrasyonu atanır. Dengeli kolay koşularda `ACCORDING_TO_PLAN` (Geçici referansla izleniyor) şablonu verilir; ancak eşik aşımı şüphesi varsa kullanıcı suçlanmaz, `OBSERVATION_ONLY` modunda tutulur.
- **Elenen alternatifler:** 
  - *Daniels Sabit Kolay Temposuna Ampirik Eşleme ($0.82$ Güven):* Hedef tempo Daniels'tan türetildiğinde teorik modelin yanlılığını ölçerek meşrulaştırdığı için elendi ve güven skoru $0.70$'e çekildi.
  - *Sabit Yaş Formülü (220 - Yaş):* Bireysel varyansı $\pm 15\text{ bpm}$ aştığı için kesinlikle elendi.

### 1.2. Sabit Katsayılar (`src/config.ts`)
- $LTHR / HR_{max}$ oranı: `0.865` (Seiler, 2013).
- $AeT / LTHR$ oranı (Kalibre): `0.84` (Olbrecht, 2000).
- $AeT / LTHR$ oranı (Kalibre Edilmemiş / Konservatif): `0.83` (Rekreasyonel koşucuları doku hasarından koruyan güvenlik tabanı).
- Aerobik Ayrışma Güvenlik Tavanı: `AEROBIC_DECOUPLING_MAX_PCT = 5.0` (Kolay koşuda hız sabitken nabız >%5 sürüklenirse gizli glikojen/eşik ihlali bayrağı üretilir).
- Daniels Kolay Tempo Katsayısı: $vVO2max \times 0.68$
- Daniels Eşik Tempo Katsayısı: $vVO2max \times 0.88$
- Minetti Eğim Katsayıları: 5. derece metabolik maliyet faktörü (`0.55` – `2.50` arası sınırlandırılmış).

---

## 2. Güven Skoru Eşikleri ve Bölge Sınırları

### 2.1. Güven Skorları (`confidenceScore`)
- `HIGH`: $\ge 0.75$ (Konuşma testi çıpası doğrulanmış veya stabil ampirik eşleme yapılmış).
- `MEDIUM`: $0.55$ – $0.74$ (Teorik VO2max, ampirik tempo pencereleri veya yarış eforu).
- `LOW`: $< 0.55$ (Soğuk başlangıç veya $<6$ antrenman).

### 2.2. Dört Bölgeli Ayrık Dağılım
1. **Kesin Kolay (`defEasySec`):** $HR < AeT_{min}$
2. **Belirsizlik Koridoru (`uncCorridorSec`):** $AeT_{min} \le HR \le AeT_{max}$
3. **Kesin Gri Bölge (`defGraySec`):** $AeT_{max} < HR \le LTHR$
4. **Eşik Üstü (`defThreshSec`):** $HR > LTHR$

### 2.3. Hüküm Kuralları ve Öncelik Hiyerarşisi
- **`ACCORDING_TO_PLAN`:** Kesin Kolay oranı $\ge \%75$ VEYA (yüksek şiddet $\%0$ iken temponun kolay koridorda kalması).
- **`WEATHER_PARDON`:** Isı stresi ($T \ge 24^\circ\text{C}$ **VEYA** $RH \ge \%75$) mevcutken tempo kolay koridorda ($GAP \ge \text{easyPaceCeiling}$) tutulmuşsa nabız yükselmesi beraat ettirilir. (K5 kuralına sadık kalındı; Ankara sıcağı ve Karadeniz nemi beraat kapsamındadır).
- **`PHYSIOLOGICAL_PARDON`:** Dinlenik nabız 30 günlük tabanından $\ge +5\text{ bpm}$ yüksek veya HRV $\ge \%20$ baskılanmışken, tempo kolay koridorda tutulmasına rağmen nabız yükselirse beraat verilir. Hata tempoda değil sistemik toparlanma ihtiyacındadır.
- **`DRIFTED_THRESHOLD`:** Eşik Üstü $\ge \%15$ veya toplam yüksek şiddet $\ge \%35$.
- **`DRIFTED_GRAY`:** (Kesin Gri + Eşik Üstü) $\ge \%25$ ve Eşik Üstü $<\%15$.
- **`BOUNDARY_ZONE`:** Yalnızca yüksek şiddet $<\%25$ iken ve antrenmanın $\ge \%25$'i belirsizlik koridorunda geçmişse verilir. Kolay koşuları haksız yere belirsizliğe iten `Kolay + Koridor >= %80` kuralı kaldırılmıştır.
- **`QUALITY_SUCCESS`:** Kaliteli seanslarda ($QUALITY$) eşik süresi $\ge \%25$ veya toplam yüksek şiddet $\ge \%60$ ise hedeflenen laktat uyarımının başarıyla verildiğini onaylar.
- **`UNDER_STIMULATED`:** Kaliteli seanslarda eşik şiddeti $<\%25$ ve toplam yüksek şiddet $<\%60$ kalmışsa zor günün hakkının verilmediğini, gri bölgede takılındığını bildirir.

---

## 3. Özel Durumlar ve Kenar Hatları

### 3.1. Koşu Bandı (Treadmill) Hattı
- Salon içinde hava durumu, rüzgar ve GPS eğim sensörü bulunmadığı ve bant kalibrasyonları hatalı olabildiği için **tempo/GAP analizi devre dışı bırakılır**.
- Değerlendirme yalnızca **kalp atım hızı kararlılığı ve nabız dağılımı** üzerinden yürütülür (`TREADMILL_ONLY_HR`).
- Nabız verisi olmayan bant koşuları doğrudan `OBSERVATION_ONLY` yapılır.

### 3.2. Kadans Kilitlenmesi Çift Sinyal Filtresi
- Tek başına $|HR - CAD| \le 2$ kuralı kadansı 165, nabzı da 165 olan geçerli anları yanlış eleyebileceğinden çift sinyal uygulanır:
  **$|HR - CAD| \le 2\text{ bpm}$ VE $\sigma(HR) \le 1.2\text{ bpm}$ (30 saniyelik pencerede varyans çöküşü).**
- Doğal solunum aritmisi (RSA) ile dalgalanan nabızlar kilitlenme sayılmaz.

### 3.3. Grup Koşusu Tespiti ve Etiketleme
- HealthKit'te `athletesCount` bulunmadığı için açık kapatıldı:
  1. Koşu sonrası bildirimden tek dokunuşla "Grup Koşusuydu" etiketi (`userFeedbackTag = 'GROUP_RUN'`).
  2. Hafta sonu sabahları tekrarlayan ve tempo standart sapması $>30\text{ sn/km}$ olan koşular için `GROUP_RUN_CANDIDATE` algoritmik tespiti.
- Grup koşusu tespit edildiğinde ceza tonu yumuşatılır, sosyal dinamik vurgulanır.

### 3.4. Geriye Dönük Etiketleme ve Sistematik Sapma Dedektörü
- Kullanıcılar geçmiş koşularına "Aslında kolaydı" veya "Aslında zordu" etiketi bırakabilir (`user_feedbacks` tablosu).
- **`detectSystematicCohortShift`:** Eğer modelin "ACCORDING_TO_PLAN" dediği koşularda en az 3 farklı kullanıcının $\ge \%20$'si "ACTUALLY_HARD" beyanında bulunursa, bu aykırı değer değil sistematik model yanlılığı (Tip II hata) olarak raporlanır ve eşik katsayısı otomatik geriye çekilir.

---

## 4. Ayna Ekranı (Mirror View) Mantığı
- **Giriş Şartı:** Son 60 gün içinde en az **16 koşu** ve **100 km**.
- **Amacı:** Hüküm vermez, nasihat etmez; veriyi koşucunun yüzüne ayna olarak tutar.
- **Tetik Soru:** Eğer son 60 gündeki koşuların $\ge \%50$'si eşik üstünde veya gri bölgede bitmişse tarafsızca sorar:
  *"Son 60 günde X koşunun %Y'si AeT eşiği üzerinde geçti. Bu dağılım planlı bir maraton/tempo hazırlığı mı, yoksa farkında olmadan mı hızlandınız?"*

---

## 5. Çift Cihaz Eşzamanlı Takip ve Tekilleştirme (Deduplication) Kuralları

### 5.1. Çift Tespiti ve Tolerans Mantığı
- **Adaylık Kuralı:** Başlangıç zamanları birbirine yakın ($\le 1800\text{ sn}$) olan antrenmanlar aday çifttir.
- **Mesafe Kriteri:** Mesafe karşılaştırması yalnızca her iki kayıtta da mesafe varsa ($> 50\text{ m}$) uygulanır (fark $\le \%10$).
- **Zaman Örtüşmesi Kriteri:** Bir tarafta mesafe yoksa (ör. WHOOP), eşleştirme tamamen zaman örtüşmesiyle yapılır. Süreler birbirini kapsıyorsa veya kısa olanın en az $\%40$'ı (ya da $\ge 300\text{ sn}$) örtüşüyorsa aynı seanstır. Cihazların duraklamaları farklı işlemesi nedeniyle süre toleransı geniş tutulmuştur.

### 5.2. Veri Zenginliği Puanlaması (En Fazla 100 Puan)
- Anlık Hız / GAP Kalitesi: `RUNNING_SPEED` (+35), `GPX_TRACKPOINT` (+30), `DISTANCE_INTERVAL` (+20), `hasInstantaneousPace` (+5).
- Mesafe Varlığı: $> 100\text{ m}$ (+30).
- Rota / GPS Koordinatı: (+15).
- Kadans Varlığı: (+10).
- Nabız Serisi Varlığı: (+10).
- **Eşitlik Kuralı:** Puanlar eşitse donanım/saat kaynağı (`isHardwareSource`) üçüncü parti köprü uygulamaya tercih edilir.

### 5.3. Kayıt Birleştirmeme (No-Merge) Kararı ve Gerekçesi
- İki kaydın alanlarını harmanlayan melez bir kayıt üretilmez.
- WHOOP'un ~2.9 saniyelik daha sık nabzının getireceği marjinal fayda; farklı başlangıç/bitiş anları, duraklama algoritması farkları, zaman damgası kayması ve çakışma çözümünün getireceği mimari karmaşıklığı ve hata riskini karşılamamaktadır. Kazanan kayıt tek başına korunur.

### 5.4. Kaybeden Kaydın Durumu ve Cihaz Bağımsızlığı
- Kaybeden kayıt fiziksel olarak silinmez; `is_duplicate = 1` olarak işaretlenir ve `duplicate_of_id = winner.id` ile kazanan kayda bağlanır.
- Kaybeden kayıt değerlendirmeden, haftalık yükten, ayna ekranı barajından ve tüm istatistiki sayımlardan çıkarılır.
- Cihaz bağımsızlığı esastır; kaynak adına göre beyaz liste veya WHOOP adını hedef alan hardcoded filtre yazılmaz.

---

## 6. Koşu Akıl Sağlığı Filtresi (Sanity Filter) Eşikleri

- **Amaç:** Cihazların otomatik algılayıp "Koşu" olarak HealthKit'e yazdığı sıfır mesafeli ve adımsız uyku/istirahat seanslarını (ör. 2 saat 45 dk, 0 mesafe, 32 adım) hüküm hattından ayıklamak.
- **Eşikler:** Mesafe $\le 50\text{ m}$ ve Süre $\ge 300\text{ sn}$ (5 dk) iken:
  1. Ortalama kadans $< 60\text{ spm}$ ise, VEYA
  2. Akış noktalarında koşan kadans ($\ge 60\text{ spm}$) hiç yoksa, VEYA
  3. Kadans yokken ortalama nabız dinlenik düzeydeyse ($< 95\text{ bpm}$), VEYA
  4. Süre $> 900\text{ sn}$ (15 dk) ve anlık hız ile kadans sıfır ise:
  Aktivite `SUSPICIOUS_NON_RUN` kabul edilir; veritabanına `is_duplicate = 1` ve `duplicate_of_id = 'SUSPICIOUS_NON_RUN'` ile sessizce arşivlenir. Değerlendirme kuyruğuna alınmaz, sayımlara dahil edilmez.

---

## 7. Sessizlik Durumları Mesaj Tablosu ("Asla Boş Ekran")

| Durum Kodu | Tetikleyici Koşul | Gösterilen Açıklama Cümlesi | Tek Eylem Düğmesi |
|---|---|---|---|
| `PERMISSION_MISSING` | HealthKit izni verilmedi | HealthKit okuma izni verilmedi. Koşularınızın analiz edilebilmesi için Apple Sağlık izinleri gereklidir. | [İzinleri İste] |
| `NO_RUNS_FOUND` | Son 60 günde koşu bulunamadı | HealthKit arşivinizde koşu antrenmanı bulunamadı. Apple Watch ile koşu kaydettikten sonra tekrar senkronize edin. | [HealthKit'i Tara] |
| `SERVER_UNREACHABLE` | Sunucuya ulaşılamadı / Ağ hatası | Sunucuya ulaşılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin. | [Yeniden Dene] |
| `BELOW_DATA_THRESHOLD` | Tekil koşu < 16 veya mesafe < 100 km | {X} koşu bulundu, {Y} adedi çift kayıt olarak elendi ({Z} tekil). Ayna ekranı için 16 koşu gerekiyor. | [HealthKit'i Senkronize Et] |
| `CALIBRATION_PENDING` | Soğuk başlangıç / Düşük güven | Kişisel fizyolojik eşikleriniz henüz kalibre edilmedi. Eforunuz geçici güvenlik referanslarıyla izleniyor. | [Konuşma Testi Çıpası Gir] |
| `OBSERVATION_ONLY` | Yarış, aşırı kısa veya düşük güvenli sapma | Bu koşu yalnızca gözlem modunda kaydedildi; fizyolojik hüküm üretilmedi. | [Ayna Ekranını İncele] |
| `SUSPICIOUS_NON_RUN` | Sıfır mesafe ve yetersiz kadans seansı | Şüpheli koşu dışı aktivite tespit edildi; sessizce arşivlendi. | [Gözat] |
