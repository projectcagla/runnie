# Koşu Şiddeti Asistanı — Doğrulanmamış Varsayımlar ve Kalan Riskler (BILINMEYENLER.md)

Bu doküman, sistemin kodlama aşamasında varsayılan ancak **gerçek koşucu verisiyle sahada sınanacak**, **kalan risklerin** ve **alınan mimari korumaların** dürüst bir envanteridir.

---

## 1. Bu Turda Çözülen ve Koruma Altına Alınan Riskler

1. **Sistematik Aşırı İyimserlik / Rekreasyonel AeT Yanlılığı (Eski Madde 2.1 & 2.2):**
   - *Eski Tehdit:* Daniels elit katsayısı ve sabit $\%88$ oranı, aerobik tabanı zayıf hedef kitlemizde AeT'yi 10–15 bpm yüksek hesaplayıp laktat üreten koşucuyu "Plana Uygun" diyerek sessizce onaylıyordu.
   - *Uygulanan Çözüm:* 
     1. Kalibre edilmemiş koşucularda $AeT$ katsayısı $\%83$'e çekilerek ortopedik dokuyu koruyan konservatif taban kuruldu.
     2. Hız sabitken nabzın $>\%5$ sürüklendiği anları yakalayan **Aerobik Ayrışma ($Pw:Hr$ Decoupling)** filtresi eklendi.
     3. Ampirik eşleme Daniels hız koridorundan bağımsızlaştırılarak en düşük ayrışmalı ($Pw:Hr \le \%3.5$) pencerelerin medyan nabzına bağlandı ve güven skoru $0.70$'e çekildi.
     4. Sahada toplu kullanıcı geri bildirimlerini tarayan **Sistematik Sapma Dedektörü (`detectSystematicCohortShift`)** inşa edildi.

2. **Kadans Kilitlenmesi Yanlış Pozitifleri (Eski Madde 1.3):**
   - *Eski Tehdit:* Kadansı 165, nabzı da tesadüfen 165 olan geçerli anlar salt yakınlık yüzünden elenebiliyordu.
   - *Uygulanan Çözüm:* Çift sinyal getirildi. Yakınlığa ek olarak nabız standart sapmasının çöküşü ($\sigma(HR) \le 1.2\text{ bpm}$) şart koşuldu. Doğal solunum aritmisi (RSA) korundu.

3. **Koşu Bandı Belirsizlikleri (Eski Madde 2.3):**
   - *Eski Tehdit:* Hava servisi ve GPS olmadığı için bant seansları hatalı yargılanıyordu.
   - *Uygulanan Çözüm:* Koşu bandında hız ve GAP analizi tamamen kapatıldı; değerlendirme yalnızca nabız stabilitesi üzerinden yürütülen `TREADMILL_ONLY_HR` hattına alındı.

4. **Sistemik Yorgunluk ve Hastalık Başlangıcı (Eski Madde 6.2):**
   - *Eski Tehdit:* Serin havada grip veya uykusuzluk yüzünden nabzı fırlayan koşucu hızını kontrol edemediği gerekçesiyle azarlanıyordu.
   - *Uygulanan Çözüm:* **Fizyolojik Durum Beraati (`PHYSIOLOGICAL_PARDON`)** devreye alındı. Koşu sabahındaki dinlenik nabız tabandan $\ge +5\text{ bpm}$ yüksekse veya HRV $\ge \%20$ baskılanmışsa, kolay tempoda yükselen nabza beraat verilir.

5. **Grup Koşusu Açığı (Eski Madde 6.3):**
   - *Eski Tehdit:* HealthKit'te `athletesCount` olmadığı için kulüp koşularındaki istemsiz hızlanmalar bireysel disiplinsizlik sanılıyordu.
   - *Uygulanan Çözüm:* Tek dokunuşlu geriye dönük grup etiketi ve hafta sonu sabahı tempo varyansı $>30\text{ sn/km}$ olan koşular için algoritmik `GROUP_RUN_CANDIDATE` yumuşatması eklendi.

6. **Soğuk Başlangıçtaki Sessizlik Çıkmazı (Eski Madde 4.3):**
   - *Eski Tehdit:* Kullanıcı ilk koşularda konuşma testine basmazsa ekran boş kalıyordu.
   - *Uygulanan Çözüm:* Dengeli kolay koşularda `EASY_ON_TRACK_LOW` şablonuyla geçici kalibrasyon bildirimi açıldı; kullanıcı asla boş ekranla bırakılmaz.

---

## 2. Popülasyon Katsayıları ve Sosyolojik Varsayımlar

1. **`AET_RATIO_OF_LTHR_UNCALIBRATED = 0.83` Katsayısı:**
   - Popülasyon tabanı olarak seçilen bu katsayının yönü Tip II hatayı (laktat üreten rekreasyonel koşucuyu plana uygun sanma tehlikesini) azaltmak için muhafazakar yönde seçilmiştir; ancak kesin sayısal bireysel biyolojik dayanağı yoktur. Gerçek laktat eşiği laboratuvarda ölçülmeyen koşucularda bu oran $\pm 5\text{ bpm}$ sapabilir.
2. **`GROUP_RUN_CANDIDATE` Kuralındaki Hafta Sonu Sabahı Varsayımı:**
   - Cumartesi ve Pazar sabahları (04:00 - 10:00 UTC) ile tempo standart sapmasının $>30\text{ sn/km}$ olması bir popülasyon/sosyolojik varsayımdır. Hafta içi akşam koşan kulüpleri veya çok homojen tempolu grup koşularını algılayamaz; bu kullanıcılar için tek dokunuşlu elle etiketleme (`userFeedbackTag = 'GROUP_RUN'`) yegane güvenilir kanal kalır.

---

## 3. Mimari Kararlar, Ertelenen Seçenekler ve Kalan Sınırlar

1. **Kayıt Birleştirme (Hybrid Merge) Ertelenmiş Bir Seçenektir:**
   - Apple Watch (mesafe, anlık tempo, GPS rotası, GAP) ile WHOOP'un yoğun nabız akışını tek bir melez aktivitede harmanlamak teorik olarak cazip görünse de; zaman damgası kayması, cihazların duraklamaları farklı işlemesi ve çakışma çözümünün getireceği karmaşıklık nedeniyle kod düzeyinde uygulanmamış, ertelenmiştir.
2. **Tempo Fakir Tek Kaynaklı Kullanıcılarda Kapanan Özellikler:**
   - Kullanıcı yalnızca WHOOP gibi mesafe ve anlık tempo üretmeyen tek bir donanımla koştuğunda aşağıdaki özellikler doğrudan devre dışı kalır:
     - **Isı Beraati (`WEATHER_PARDON`):** Nabız yükseldiğinde temponun gerçekten kolay tutulup tutulmadığı bilinemez.
     - **Grup Koşusu Algoritmik Tespiti (`GROUP_RUN_CANDIDATE`):** Tempo varyansı hesaplanamaz; geriye dönük elle etiketleme zorunludur.
     - **Eğim Düzeltmeli Hız (GAP) ve Tempo Dağılımı:** Nabız kilitlenmesi veya sensör kaybında yedeğe geçilemez.
     - **Patika (Trail) Tespiti:** Mesafe bilinmediğinden km başına irtifa kazancı hesaplanamaz.
3. **Tarihsel Çift Sayım Güvensizliği:**
   - Çift cihaz eşzamanlı takibindeki tekilleştirme hatası düzeltilmeden önce, hem Apple Watch hem WHOOP taşıyan kullanıcıların tüm koşuları veritabanında iki kez sayılmıştır. Bu nedenle önceki turlarda telemetride görülen koşu sayıları, haftalık antrenman yükleri ve hacim istatistikleri gerçeği yansıtmamaktadır ve güvenilmezdir.

---

## 4. Sahada İlk Gerçek Koşucularla Doğrulanması Gereken Kalan Riskler

1. **Apple Health XML Dışa Aktarımındaki Gerçek Hız Kaynağı:**
   - Kod 3 kademeli hiyerarşi kurdu (`RunningSpeed` $\rightarrow$ `GPX` $\rightarrow$ `DistanceWalkingRunning`). Tipik kullanıcı dışa aktarımında `RunningSpeed` kayıtlarının kapsama oranının $\ge \%80$ olduğu gerçek bir arşivde gözlemlenmelidir.
2. **Apple Watch VO2max Üretim Sıklığı:**
   - Açık havada GPS ile tempolu koşmayan kullanıcılarda Apple Watch VO2max üretmez. Bu kullanıcıların ilk konuşma testi etkileşimine katılım oranı izlenmelidir.
3. **Fiziksel Cihazda APNs 180 Saniye Bildirim SLA'sı:**
   - Apple Push Notification servisinin kilitli ekranda koşu bittikten sonraki 3 dakika içinde fiziksel iPhone'a ulaştığı Apple Developer Gateway üzerinden canlı doğrulanmalıdır.
