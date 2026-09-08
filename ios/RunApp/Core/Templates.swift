import Foundation

public struct TemplateItem: Codable, Identifiable {
    public let id: String
    public let intent: String
    public let judgment: String
    public let confidenceLevel: String
    public var edgeTag: String?
    public let primarySentence: String
    public let secondaryCostSentence: String

    public init(id: String, intent: String, judgment: String, confidenceLevel: String, edgeTag: String? = nil, primarySentence: String, secondaryCostSentence: String) {
        self.id = id
        self.intent = intent
        self.judgment = judgment
        self.confidenceLevel = confidenceLevel
        self.edgeTag = edgeTag
        self.primarySentence = primarySentence
        self.secondaryCostSentence = secondaryCostSentence
    }
}

public final class TemplatesCatalog {
    public static let shared = TemplatesCatalog()

    public private(set) var list: [TemplateItem] = []

    private init() {
        loadTemplates()
    }

    private func loadTemplates() {
        if let url = Bundle.main.url(forResource: "templates", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let items = try? JSONDecoder().decode([TemplateItem].self, from: data) {
            self.list = items
            return
        }
        if let data = embeddedTemplatesJson.data(using: .utf8),
           let items = try? JSONDecoder().decode([TemplateItem].self, from: data) {
            self.list = items
            return
        }
        self.list = []
    }

    public func selectTemplate(
        intent: AssessmentIntent,
        judgment: AssessmentJudgment,
        confidenceLevel: ConfidenceLevel,
        flags: [String]
    ) -> TemplateItem {
        let intentStr = intent.rawValue
        let judgmentStr = judgment.rawValue
        let confStr = confidenceLevel.rawValue

        // 1. Kenar durum etiketleri (Sensör arızası vb. en yüksek önceliklidir)
        if flags.contains("CADENCE_LOCK") {
            if let t = list.first(where: { $0.edgeTag == "CADENCE_LOCK" }) { return t }
        }

        if flags.contains("TREADMILL") {
            if let t = list.first(where: { $0.edgeTag == "TREADMILL" }) { return t }
        }

        if judgment == .physiologicalPardon {
            if let t = list.first(where: { $0.judgment == "PHYSIOLOGICAL_PARDON" }) { return t }
        }

        if flags.contains("GROUP_RUN") || flags.contains("GROUP_RUN_CANDIDATE") {
            if let t = list.first(where: { $0.edgeTag == "GROUP_RUN" && $0.judgment == judgmentStr }) { return t }
        }

        if flags.contains("WALK_BREAKS") && judgment == .accordingToPlan {
            if let t = list.first(where: { $0.edgeTag == "WALK_BREAKS" }) { return t }
        }

        if flags.contains("CARDIAC_DRIFT_EXPECTED") && intent == .long {
            if let t = list.first(where: { $0.edgeTag == "LONG_RUN" }) { return t }
        }

        // 2. Belirsiz Koridor Şablonu
        if judgment == .boundaryZone {
            if let t = list.first(where: { $0.judgment == "BOUNDARY_ZONE" }) { return t }
        }

        // 3. Yarış Şablonu
        if intent == .race {
            if let t = list.first(where: { $0.intent == "RACE" }) { return t }
        }

        if confidenceLevel == .low || judgment == .observationOnly {
            if let t = list.first(where: { $0.judgment == "OBSERVATION_ONLY" && $0.confidenceLevel == "LOW" }) { return t }
        }

        if let standard = list.first(where: {
            $0.intent == intentStr &&
            $0.judgment == judgmentStr &&
            $0.confidenceLevel == confStr &&
            $0.edgeTag == nil
        }) {
            return standard
        }

        if let fallback = list.first(where: {
            $0.intent == intentStr &&
            $0.judgment == judgmentStr &&
            $0.edgeTag == nil
        }) {
            return fallback
        }

        return list.first ?? TemplateItem(
            id: "FALLBACK_01",
            intent: "EASY",
            judgment: "ACCORDING_TO_PLAN",
            confidenceLevel: "HIGH",
            primarySentence: "Koşu tamamlandı.",
            secondaryCostSentence: "Efor kaydedildi."
        )
    }

    public static func interpolate(_ template: String, vars: [String: Double]) -> String {
        var result = template
        for (k, v) in vars {
            let roundedVal = Int(v.rounded())
            result = result.replacingOccurrences(of: "%{\(k)}", with: "\(roundedVal)")
        }
        return result
    }
}

// Embedded static fallback JSON ensuring zero runtime missing resource failures
private let embeddedTemplatesJson = """
[
  {
    "id": "EASY_ON_TRACK_HIGH_01",
    "intent": "EASY",
    "judgment": "ACCORDING_TO_PLAN",
    "confidenceLevel": "HIGH",
    "primarySentence": "Kolay bir toparlanma koşusu olmalıydı; sürenin %{easyPct}'ini hedeflenen aerobik bölgede tamamladın.",
    "secondaryCostSentence": "Temponu kontrol altında tutarak bacaklarına gereksiz metabolik yük bindirmeden antrenmanı bitirdin."
  },
  {
    "id": "EASY_ON_TRACK_HIGH_02",
    "intent": "EASY",
    "judgment": "ACCORDING_TO_PLAN",
    "confidenceLevel": "HIGH",
    "primarySentence": "Planlanan kolay şiddete sadık kaldın; aerobik temeli korurken toparlanma pencereni açık tuttun.",
    "secondaryCostSentence": "Bu disiplin, haftanın sonraki kaliteli antrenmanları için gereken bacak tazeliğini korumanı sağladı."
  },
  {
    "id": "EASY_ON_TRACK_HIGH_03",
    "intent": "EASY",
    "judgment": "ACCORDING_TO_PLAN",
    "confidenceLevel": "HIGH",
    "primarySentence": "Efor seviyen tam olarak hedeflenen koridorda kaldı; düşük yoğunluklu hacim hedefine ulaştın.",
    "secondaryCostSentence": "Kardiyak stres oluşturmadan aerobik adaptasyon uyaranını başarıyla verdin."
  },
  {
    "id": "EASY_ON_TRACK_LOW_01",
    "intent": "EASY",
    "judgment": "ACCORDING_TO_PLAN",
    "confidenceLevel": "LOW",
    "primarySentence": "Adım ritmin ve tempon koşu boyunca kararlı kaldı; efor hissinin de rahat olduğunu varsayarak dengeli bir kolay koşu diyebiliriz.",
    "secondaryCostSentence": "Henüz kalibrasyon aşamasındayız; nefes durumunun konuşma temposunda kalmış olması bu ritmi doğrular."
  },
  {
    "id": "EASY_DRIFT_MILD_01",
    "intent": "EASY",
    "judgment": "DRIFTED_GRAY",
    "confidenceLevel": "HIGH",
    "primarySentence": "Kolay koşu hedefiyle çıktın ancak sürenin yaklaşık dörtte birini gri bölgede geçirdin.",
    "secondaryCostSentence": "Bacakların rahat hissetmiş olabilir fakat kardiyak yük, antrenmanın toparlanma sınırını hafifçe aştığını gösteriyor."
  },
  {
    "id": "EASY_DRIFT_MILD_02",
    "intent": "EASY",
    "judgment": "DRIFTED_GRAY",
    "confidenceLevel": "HIGH",
    "primarySentence": "Koşunun son bölümünde tempon istemsizce yükseldi ve toparlanma bölgesinin dışına taştın.",
    "secondaryCostSentence": "Bu hafif tempo kayması, sonraki antrenman öncesinde bacaklarında fazladan mekanik yorgunluk bırakabilir."
  },
  {
    "id": "EASY_DRIFT_MILD_03",
    "intent": "EASY",
    "judgment": "DRIFTED_GRAY",
    "confidenceLevel": "HIGH",
    "primarySentence": "Antrenmanın büyük kısmı iyiydi ancak son kilometrelerde aerobik eşik sınırını aştın.",
    "secondaryCostSentence": "Kolay koşularda son düzlükte hızlanma eğilimi, antrenmanın dinlendirici etkisini azaltır."
  },
  {
    "id": "EASY_DRIFT_SEV_01",
    "intent": "EASY",
    "judgment": "DRIFTED_THRESHOLD",
    "confidenceLevel": "HIGH",
    "primarySentence": "Bu koşu toparlanma amaçlıydı; ancak sürenin %{thresholdPct}'ini eşik bölgesinde geçirerek antrenmanı kaliteli bir seans eforuna dönüştürdün.",
    "secondaryCostSentence": "Dinlenmesi gereken bir günde eşik temponu zorladın; bu fazladan efor sonraki kaliteli antrenmanın bacak tazeliğini daralttı."
  },
  {
    "id": "EASY_DRIFT_SEV_02",
    "intent": "EASY",
    "judgment": "DRIFTED_THRESHOLD",
    "confidenceLevel": "HIGH",
    "primarySentence": "Düşük yoğunluklu aerobik temel hedefinden saptın; koşunun önemli bir kısmı yüksek metabolik yük altında geçti.",
    "secondaryCostSentence": "Bu şiddet, aerobik sistemi dinlendirmek yerine kas ve tendonlarına yeni bir toparlanma yükü ekledi."
  },
  {
    "id": "EASY_DRIFT_SEV_03",
    "intent": "EASY",
    "judgment": "DRIFTED_THRESHOLD",
    "confidenceLevel": "HIGH",
    "primarySentence": "Kolay koşu disiplinini koruyamadın; tempon seni farkında olmadan laktat eşiğinin üzerine itti.",
    "secondaryCostSentence": "Gereksiz glikojen tüketimi yaptın; yarınki koşuya tam toparlanmış bacaklarla başlama ihtimalini düşürdün."
  },
  {
    "id": "EASY_DRIFT_SEV_04",
    "intent": "EASY",
    "judgment": "DRIFTED_THRESHOLD",
    "confidenceLevel": "HIGH",
    "primarySentence": "Planlanan kolay tempo yerine tempolu bir koşu yaptın; sürenin yarısına yakını gri ve eşik bölgede geçti.",
    "secondaryCostSentence": "Bu antrenman toparlanma değil, sisteme fazladan kümülatif yorgunluk yazan bir seans oldu."
  },
  {
    "id": "WEATHER_PARDON_01",
    "intent": "EASY",
    "judgment": "WEATHER_PARDON",
    "confidenceLevel": "HIGH",
    "primarySentence": "Nabzın eşik bölgesine tırmanmış görünse de eğim düzeltmeli tempon kolay bölgedeydi; sıcaklık ve nem kalbine fazladan yük bindirdi, tempon doğruydu.",
    "secondaryCostSentence": "Termoregülasyon stresi nabzı yukarı çekti ancak mekanik olarak doğru tempoda kalarak disiplinini korudun."
  },
  {
    "id": "WEATHER_PARDON_02",
    "intent": "EASY",
    "judgment": "WEATHER_PARDON",
    "confidenceLevel": "HIGH",
    "primarySentence": "Yüksek hava nemi kardiyak sürüklenmeyi erkene çekti; fizyolojik stres artsa da temponu koruyarak frene basmayı bildin.",
    "secondaryCostSentence": "Bu hava şartlarında temponu suçlamıyoruz; vücudun sıcaklığa tepki verdi, mekanik eforun planlanan düzeydeydi."
  },
  {
    "id": "WEATHER_PARDON_03",
    "intent": "EASY",
    "judgment": "WEATHER_PARDON",
    "confidenceLevel": "HIGH",
    "primarySentence": "Hava koşulları kardiyovasküler yükü artırdı ancak adım frekansın ve tempon kolay koşu sınırlarının içindeydi.",
    "secondaryCostSentence": "Sıcak havada tempo kontrolünü elden bırakmayarak toparlanma amacını başarıyla muhafaza ettin."
  },
  {
    "id": "PHYSIOLOGICAL_PARDON_01",
    "intent": "EASY",
    "judgment": "PHYSIOLOGICAL_PARDON",
    "confidenceLevel": "HIGH",
    "primarySentence": "Koşu sabahındaki dinlenik nabzın veya toparlanma göstergelerin vücudunun ek bir yük altında olduğunu işaret ediyordu; tempon kolaydı, yükselen nabız hızından değil yorgunluktan kaynaklandı.",
    "secondaryCostSentence": "Mekanik olarak doğru tempoda kalarak aşırı zorlamadan kaçındın; vücudunun biyolojik toparlanma ihtiyacına saygı göstermiş oldun."
  },
  {
    "id": "PHYSIOLOGICAL_PARDON_02",
    "intent": "EASY",
    "judgment": "PHYSIOLOGICAL_PARDON",
    "confidenceLevel": "HIGH",
    "primarySentence": "Dinlenik nabzın son dönem ortalamanın üzerinde seyrediyor; kolay tempoda koşmana rağmen nabzın toparlanma koridorunun üstüne çıktı.",
    "secondaryCostSentence": "Hata hızında değil, sistemik yorgunlukta; temponu yavaş tutarak doğru bir karar verdin."
  },
  {
    "id": "QUALITY_UNDER_01",
    "intent": "QUALITY",
    "judgment": "UNDER_STIMULATED",
    "confidenceLevel": "HIGH",
    "primarySentence": "Bugün kaliteli bir tempo seansı hedeflemiştin ancak sürenin yalnızca %{thresholdPct}'i eşik şiddetine ulaşabildi.",
    "secondaryCostSentence": "Önceki günlerin toparlanmamış yorgunluğu, hedeflenen eşik temposunu korumanı zorlaştırmış olabilir."
  },
  {
    "id": "QUALITY_UNDER_02",
    "intent": "QUALITY",
    "judgment": "UNDER_STIMULATED",
    "confidenceLevel": "HIGH",
    "primarySentence": "Efor hedefin laktat eşiğini uyarmaktı fakat tempon gri bölgede takıldı; hedeflenen antrenman etkisini tam alamadın.",
    "secondaryCostSentence": "Zor günlerin hakkını verebilmek için aradaki kolay günlerde frene basmak kritik önemdedir."
  },
  {
    "id": "QUALITY_UNDER_03",
    "intent": "QUALITY",
    "judgment": "UNDER_STIMULATED",
    "confidenceLevel": "HIGH",
    "primarySentence": "Bu antrenmandan beklenen yüksek şiddet uyaranı alınamadı; planlanan eşik aralıklarının gerisinde kalındı.",
    "secondaryCostSentence": "Bacaklarındaki doluluk hissi zirve hızlara çıkmanı engellediyse, haftalık toparlanma dengeni gözden geçirmelisin."
  },
  {
    "id": "QUALITY_SUCCESS_01",
    "intent": "QUALITY",
    "judgment": "QUALITY_SUCCESS",
    "confidenceLevel": "HIGH",
    "primarySentence": "Amacına tam olarak hizmet eden bir seans; sürenin %{thresholdPct}'ini net şekilde eşik ve üzeri bölgede geçirdin.",
    "secondaryCostSentence": "Zor günün hakkını verdin; aerobik kapasiteyi ve eşik hızını yukarı çekecek hedeflenen metabolik baskıyı başarıyla yarattın."
  },
  {
    "id": "QUALITY_SUCCESS_02",
    "intent": "QUALITY",
    "judgment": "QUALITY_SUCCESS",
    "confidenceLevel": "HIGH",
    "primarySentence": "Planlanan eşik seansı hedefine ulaştı; aralıklarda yüksek temponu eksiksiz korudun.",
    "secondaryCostSentence": "Gereken kardiyovasküler uyaran eksiksiz verildi; şimdi sıradaki kolay koşuda tam toparlanmaya odaklanmalısın."
  },
  {
    "id": "QUALITY_SUCCESS_03",
    "intent": "QUALITY",
    "judgment": "QUALITY_SUCCESS",
    "confidenceLevel": "HIGH",
    "primarySentence": "Güçlü bir kaliteli antrenman; hedeflenen eşik temposunu koşu boyunca yüksek kararlılıkla sürdürdün.",
    "secondaryCostSentence": "Bu seans hız dayanıklılığını pekiştirdi; toparlanma penceresini doğru kullanarak adaptasyon sürecini başlatmalısın."
  },
  {
    "id": "GROUP_RUN_01",
    "intent": "EASY",
    "judgment": "DRIFTED_GRAY",
    "confidenceLevel": "HIGH",
    "edgeTag": "GROUP_RUN",
    "primarySentence": "Grup dinamiği temponu yukarı çekmiş; sosyal olarak harika bir koşu olsa da toparlanma amacının dışına çıkıldı.",
    "secondaryCostSentence": "Kalabalıkla koşarken kolay tempoda kalmak zordur; bu koşu planlanan kolay günden daha fazla toparlanma maliyeti yarattı."
  },
  {
    "id": "GROUP_RUN_02",
    "intent": "EASY",
    "judgment": "DRIFTED_THRESHOLD",
    "confidenceLevel": "HIGH",
    "edgeTag": "GROUP_RUN",
    "primarySentence": "Grup temposuna uyum sağlamak antrenmanı kolay bir koşudan eşik seansına dönüştürdü.",
    "secondaryCostSentence": "Sosyal motivasyon yüksek olsa da bu tempo artışı, haftanın sonraki antrenmanları için toparlanma borcu bıraktı."
  },
  {
    "id": "WALK_BREAKS_01",
    "intent": "EASY",
    "judgment": "ACCORDING_TO_PLAN",
    "confidenceLevel": "HIGH",
    "edgeTag": "WALK_BREAKS",
    "primarySentence": "Araya eklediğin yürüyüş molaları kardiyak yükü kontrol altında tuttu; şiddeti dizginlemek için doğru bir strateji uyguladın.",
    "secondaryCostSentence": "Yürüyüş aralıkları nabzın eşiğe fırlamasını engelledi; mekanik stresi azaltarak akıllıca bir toparlanma koşusu yaptın."
  },
  {
    "id": "WALK_BREAKS_02",
    "intent": "EASY",
    "judgment": "ACCORDING_TO_PLAN",
    "confidenceLevel": "HIGH",
    "edgeTag": "WALK_BREAKS",
    "primarySentence": "Yürü-koş stratejisiyle aerobik temelini korudun ve gereksiz nabız sıçramalarının önüne geçtin.",
    "secondaryCostSentence": "Bu yaklaşım, doku yorgunluğunu minimize ederek toparlanma hızını destekledi."
  },
  {
    "id": "LOW_CONFIDENCE_01",
    "intent": "EASY",
    "judgment": "OBSERVATION_ONLY",
    "confidenceLevel": "LOW",
    "primarySentence": "Henüz yeterli kalibrasyon verimiz olmadığı için kesin bir sınır çizmiyoruz; ancak tempo stabiliten antrenmanın dengeli geçtiğini düşündürüyor.",
    "secondaryCostSentence": "Koşu sonundaki nefes ve bacak hissiyatın motorun mevcut tahmininden daha belirleyicidir."
  },
  {
    "id": "LOW_CONFIDENCE_02",
    "intent": "EASY",
    "judgment": "OBSERVATION_ONLY",
    "confidenceLevel": "LOW",
    "primarySentence": "Eşik modelimizin kalibrasyonu devam ediyor; bu koşudaki tempon sınır bölgesinde seyretti.",
    "secondaryCostSentence": "Konuşma temposunu koruyabildiysen doğru bölgedeydin; verilerin biriktikçe analizlerimiz netleşecek."
  },
  {
    "id": "LOW_CONFIDENCE_03",
    "intent": "EASY",
    "judgment": "OBSERVATION_ONLY",
    "confidenceLevel": "LOW",
    "primarySentence": "Bu koşudaki efor seviyen kalibrasyon koridorumuzun tam ortasında; kesin bir eşik hükmü vermek için erken.",
    "secondaryCostSentence": "Birkaç koşu sonra kişisel eşiklerin oturduğunda çok daha net ve hedefe yönelik geri bildirim alacaksın."
  },
  {
    "id": "EDGE_SHORT_01",
    "intent": "EASY",
    "judgment": "OBSERVATION_ONLY",
    "confidenceLevel": "LOW",
    "edgeTag": "SHORT_RUN",
    "primarySentence": "Kısa hareket süresi kararlı durum fizyolojik analizi için sınırlı veri sundu; bu aktiviteyi genel hacmine ekledik.",
    "secondaryCostSentence": "Kısa süreli toparlanma hareketlerinde tempo dalgalanmaları doğaldır."
  },
  {
    "id": "EDGE_CADENCE_LOCK_01",
    "intent": "EASY",
    "judgment": "OBSERVATION_ONLY",
    "confidenceLevel": "MEDIUM",
    "edgeTag": "CADENCE_LOCK",
    "primarySentence": "Nabız sensörün adımlarınla kilitlendiği için kardiyak veriyi eledik; değerlendirmeyi eğim düzeltmeli tempon üzerinden yaptık.",
    "secondaryCostSentence": "Optik nabız hatalarına karşı tempo kararlılığın koşunun kolay bölgede kaldığına işaret ediyor."
  },
  {
    "id": "EDGE_TREADMILL_01",
    "intent": "EASY",
    "judgment": "ACCORDING_TO_PLAN",
    "confidenceLevel": "MEDIUM",
    "edgeTag": "TREADMILL",
    "primarySentence": "Koşu bandı aktivitesi: Dış hava ve GPS eğim verisi bulunmadığından analiz doğrudan kalp atım hızına dayandırıldı.",
    "secondaryCostSentence": "Kardiyak yükün kolay koşu tavanının altında kalarak toparlanma amacını karşıladı."
  },
  {
    "id": "EDGE_LONG_RUN_DRIFT_01",
    "intent": "LONG",
    "judgment": "ACCORDING_TO_PLAN",
    "confidenceLevel": "HIGH",
    "edgeTag": "LONG_RUN",
    "primarySentence": "Uzun koşunun son bölümündeki hafif nabız artışı dehidrasyona bağlı doğal kardiyak sürüklenmedir; temponu sabit tutarak başarılı bir uzun koşu yaptın.",
    "secondaryCostSentence": "Aerobik dayanıklılığını pekiştiren bu hacim seansı, planlanan dayanıklılık hedefine ulaştı."
  },
  {
    "id": "EDGE_OVERRIDE_3X_01",
    "intent": "QUALITY",
    "judgment": "OBSERVATION_ONLY",
    "confidenceLevel": "MEDIUM",
    "edgeTag": "FREQUENT_OVERRIDE",
    "primarySentence": "Son koşularını ardışık olarak tempo olarak güncelledin; bu sıklıkta yüksek şiddet çalışıyorsan toparlanma pencereni yeniden yapılandırmamız gerekebilir.",
    "secondaryCostSentence": "Haftalık antrenman polarizasyonunu korumak için eşik temponu yeniden gözden geçirebiliriz."
  },
  {
    "id": "BOUNDARY_ZONE_01",
    "intent": "EASY",
    "judgment": "BOUNDARY_ZONE",
    "confidenceLevel": "MEDIUM",
    "primarySentence": "Efor seviyen kolay koşu sınırının tam eşiğinde seyretti; kalibrasyon hata payımızın içinde kaldığın için kesin bir ihlal hükmü vermiyoruz.",
    "secondaryCostSentence": "Koşu sonundaki nefes durumunun konuşma temposunda olup olmadığı motorun mevcut tahmininden daha belirleyicidir."
  },
  {
    "id": "RACE_COMPLETED_01",
    "intent": "RACE",
    "judgment": "OBSERVATION_ONLY",
    "confidenceLevel": "HIGH",
    "primarySentence": "Resmi yarış koşuldu; şiddet denetimi kapalıdır. Yarış eforunun ardından toparlanmaya odaklanmalısın.",
    "secondaryCostSentence": "Yarış süresince gösterdiğin yüksek efor genel antrenman yüküne eklendi."
  }
]
"""
