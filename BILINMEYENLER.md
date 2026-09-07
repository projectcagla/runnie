# Koşu Şiddeti Asistanı — Doğrulanmamış Varsayımlar ve Riskler (BILINMEYENLER.md)

Bu doküman, sistemin kodlama aşamasında varsayılan ancak **gerçek koşucu verisiyle henüz sınanmamış**, **yanlış olma potansiyeli taşıyan** ve **üretim ortamında ilk kırılabilecek** noktaların dürüst bir envanteridir.

---

## 1. Gerçek Veriyle Hiç Sınanmamış Olanlar

1. **Apple Health XML Dışa Aktarımındaki Gerçek Hız Kaynağı:**
   - Kod 3 kademeli bir hiyerarşi kurdu (`RunningSpeed` $\rightarrow$ `GPX` $\rightarrow$ `DistanceWalkingRunning`). Ancak tipik bir Apple Watch kullanıcısının dışa aktarımında `RunningSpeed` kayıtlarının yüzde kaç sıklıkla bulunduğu, GPX rotalarının dışa aktarımda ne kadar korunduğu ve zaman damgalarının gerçekten $\pm 3$ dakika içinde oturup oturmadığı **tek bir gerçek arşivde bile doğrulanmadı**.
2. **Apple Watch VO2max Değerinin Varlığı ve Doğruluğu:**
   - Koşucu açık havada GPS ile en az 20 dakika tempolu koşmadıysa Apple Watch VO2max üretmez. Kullanıcıların arşivinde sıfır VO2max çıkma ihtimali masadadır; bu durumda teorik modelin tamamı çöker ve sistem tek bir konuşma testi çıpasına bağımlı kalır.
3. **Kadans Kilitlenmesi Filtresinin Gerçek Sahadaki Başarımı:**
   - Bilekten optik nabız sensörlerinde adım frekansıyla nabız kilitlenmesi iyi bilinir. Koddaki $|HR - CAD| \le 3\text{ bpm}$ ve $\ge 60\text{ sn}$ kuralı sentetik mantıkla yazılmıştır. Gerçek koşucularda kadansı 165, nabzı da tesadüfen 165 olan fizyolojik olarak geçerli anları yanlışlıkla kilitlenme sayıp nabzı haksız yere eleme riski test edilmemiştir.
4. **Gerçek İki Cihazlı Mükerrer Eşleşme Oranı:**
   - Saati Garmin olup Strava'ya otomatik aktaran bir koşucunun iki kaydı arasındaki zaman farkı gerçekten $\le 120\text{ sn}$ ve mesafe farkı $\le \%5$ midir? Strava'nın duraklamaları kırpma algoritması süreyi veya mesafeyi bu toleransın dışına iterse mükerrer çiftler tekilleştirilemeyebilir.

---

## 2. Sistematik Olarak Yanlış Olabilecek Varsayımlar ve Sapma Yönümüz

1. **Varsayım: "Daniels VDOT Formülü Her Yaş ve Kondisyondaki Koşucuda Geçerlidir"**
   - *Gerçek:* Daniels formülü elit ve antrene koşucuların laboratuvar verilerinden türetilmiştir. Sedanter veya yeni başlayanlarda $vVO2max$'ın $\%68$'i ile koşmak laktat eşiğini aşabilir.
   - *Sapma Yönümüz:* Yeni başlayan koşucu için hesaplanan kolay tempo fazla hızlı çıkar. Motor, koşucu gereğinden hızlı koşarken bile ona "Plana Uygun" diyebilir (Tip II Hata — Tehlikeli İyimserlik).
2. **Varsayım: "$AeT = LTHR \times 0.88$ ve $LTHR = HR_{max} \times 0.88$"**
   - *Gerçek:* Aerobik eşiğin laktat eşiğine oranı sporcunun antrenman geçmişine göre $\%78$ ile $\%92$ arasında değişir.
   - *Sapma Yönümüz:* Aerobik tabanı zayıf ("aerobic deficiency syndrome") olan koşucularda $AeT$ olması gerekenden 10-15 bpm yüksek tahmin edilir. Koşucu laktat üretip glikojen tüketirken motor onu güvenli aerobik koridorda sanır.
3. **Varsayım: "Koşu Bandında Hız Sabittir ve Eğim 0'dır"**
   - *Gerçek:* Koşu bandı seanslarında HealthKit eğimi kaydetmez; bant kalibrasyonu $\%10-15$ hatalı olabilir ve salon içi havalandırma yetersizliği kardiyak drifti tetikler.
   - *Sapma Yönümüz:* Hava servisi `WEATHER_UNAVAILABLE` döneceği ve eğim bilinemeyeceği için motor sıcak salonda koşan koşucuyu "Aşırı Efor" ile haksız yere suçlayabilir.

---

## 3. Popülasyon Ortalamasından Gelen (Kişiye Özel Olmayan) Katsayılar

Aşağıdaki katsayılar hiçbir bireysel teste dayanmaz; popülasyon varsayımıdır:
- `LTHR_RATIO_OF_HRMAX = 0.88`
- `AET_RATIO_OF_LTHR = 0.88`
- `CADENCE_LOCK_DIFF_THRESHOLD = 3 bpm`
- `WARMUP_RATIO_MAX = 0.20` (Maksimum 8 dakika ısınma payı)
- `HEAT_TEMPERATURE_THRESHOLD_C = 24.0`
- `HEAT_HUMIDITY_THRESHOLD_PCT = 75`
- `Minetti Cost Factor` polinom katsayıları (Dağ koşucusu ile yol koşucusunda enerji tüketimi farklıdır).

---

## 4. İlk Gerçek Kullanıcıda Kırılmasını Beklediğimiz İlk 3 Şey

1. **HealthKit Rota İzni ve GPX Zaman Boşlukları:**
   - Kullanıcı HealthKit yetkilendirmesinde "Antrenman Rotaları" iznini atlarsa veya Apple Watch rota kaydetmediyse, `GPX_TRACKPOINT` kademesi tamamen düşer. GPS uydusu geç bağlanan ilk 2-3 kilometrelik koşularda rota noktaları antrenman başlangıcından geride kalır.
2. **Tekilleştirmede Üçüncü Taraf Süre Manipülasyonu:**
   - Apple Watch koşuyu duraklatıldığında toplam süreyle kaydederken Strava hareket süresine göre kırpar. 60 dakikalık koşuda 5 dakika ışıkta bekleyen bir koşucuda zaman farkı 300 saniyeye çıkar; tekilleştirme filtresi ($\le 120\text{ sn}$) bunu çift olarak tanıyamaz ve aynı koşu iki kez değerlendirilir.
3. **Konuşma Testi Çıpasının Kullanıcı Tarafından İhmal Edilmesi:**
   - İlk 3 koşuda kullanıcı bildirime tıklamaz veya konuşma testi nabzını girmezse sistem sürekli `CALIBRATING` / `OBSERVATION_ONLY` modunda kalır ve hiçbir hüküm cümlesi üretemez.

---

## 5. Sahaya Çıkmadan Önce Mutlaka Yapılması Gereken Doğrulamalar (Öncelik Sırasıyla)

1. **Öncelik 1: Gerçek Apple Health Arşivi Üzerinde Keşif Betiği:**
   - `scripts/inspect-health-export.ts` en az 3 farklı kullanıcının gerçek dışa aktarımında çalıştırılmalı ve 4 kabul barajı (Anlık tempo $\ge \%80$, Nabız $\ge \%85$, Çıpa $\ge 1$, Mükerrer $<\%20$) somut çıktıyla görülmelidir.
2. **Öncelik 2: Bizzat Koşucu Tarafından Etiketlenmiş 10 Koşuluk Doğrulama:**
   - Koşucunun "bu gerçekten kolaydı", "burada zorlandım", "burada bacaklarım koptu" dediği 10 gerçek koşu motora verilmeli ve motorun ürettiği hüküm ile yer gerçeği karşılaştırılmalıdır.
3. **Öncelik 3: APNs Canlı Gateway mTLS Bağlantısı:**
   - Apple Developer hesabı üzerinden `.p8` anahtarı oluşturulup arka plan bildirimlerinin kilitli ekranda 180 saniye içinde ulaştığı fiziksel iPhone üzerinde doğrulanmalıdır.

---

## 6. Kullanıcıya Yanlış Hüküm Verme İhtimalinin En Yüksek Olduğu 3 Senaryo

1. **Rüzgarlı / Tepelik Parkurda GPS İrtifa Hataları:**
   - Minetti eğim düzeltmesi barometrik altimetreye güvenir. GPS tabanlı irtifa dalgalanması düz yolda yapay bir $\%5$ yokuş uydurursa, motor koşucunun yavaş temposunu "yokuş tırmanışı" sanarak olduğundan daha yüksek bir enerji maliyeti (GAP) hesaplar ve aşırı efor hükmünü ıskalar.
2. **Kardiyak Yorgunluk / Hastalık Başlangıcı (Isı Beraati Yokken):**
   - Koşucu grip başlangıcında veya uykusuzken 6:00/km tempoda 160 nabız görür. Hava serindir ($15^\circ\text{C}$); dolayısıyla ısı beraati devreye girmez. Motor koşucuyu "Hızını kontrol edemedin, gereksiz zorladın" diye azarlar; oysa sorun hız değil sistemik biyolojik yorgunluktur.
3. **Grup Koşusunda Başlığın Standart Kalması:**
   - Kullanıcı grup koşusuna katılmıştır ancak saatine bunu belirtmemiştir (`athletesCount` HealthKit'te yoktur). Grup içinde sohbet temposu dalgalanır. Motor bunu tekil bir disiplinsizlik olarak yorumlayıp sert cümle kurabilir.
