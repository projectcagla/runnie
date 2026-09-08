import Foundation

public struct GoldenFixtureCase: Codable {
    public let name: String
    public let activity: NormalizedActivity
    public let stream: [StreamPoint]
    public let thresholds: UserThresholds
    public let weather: WeatherSnapshot?
    public let expected: ExpectedResult

    public struct ExpectedResult: Codable {
        public let judgment: String
        public let inferredIntent: String
        public let confidenceLevel: String
        public let zoneEasyPct: Double
        public let zoneModeratePct: Double
        public let zoneThresholdPct: Double
        public let templateId: String
        public let outputSentence: String
        public let flags: [String]
        public let isSilenced: Bool
    }
}

public struct EngineParityValidator {
    public static func validate(jsonData: Data) -> (passed: Int, failed: Int, errors: [String]) {
        let cases: [GoldenFixtureCase]
        do {
            cases = try JSONDecoder().decode([GoldenFixtureCase].self, from: jsonData)
        } catch {
            return (0, 1, ["JSON decode failed: \(error)"])
        }

        var passed = 0
        var failed = 0
        var errors: [String] = []

        for c in cases {
            let input = EngineInput(
                activity: c.activity,
                stream: c.stream,
                thresholds: c.thresholds,
                weather: c.weather
            )

            let asmt = RunnieEngine.evaluateActivity(input: input)

            var match = true
            if asmt.analysisJudgment.rawValue != c.expected.judgment {
                errors.append("[\(c.name)] Judgment mismatch: got \(asmt.analysisJudgment.rawValue), expected \(c.expected.judgment)")
                match = false
            }
            if asmt.inferredIntent.rawValue != c.expected.inferredIntent {
                errors.append("[\(c.name)] Intent mismatch: got \(asmt.inferredIntent.rawValue), expected \(c.expected.inferredIntent)")
                match = false
            }
            if asmt.confidenceLevel.rawValue != c.expected.confidenceLevel {
                errors.append("[\(c.name)] ConfidenceLevel mismatch: got \(asmt.confidenceLevel.rawValue), expected \(c.expected.confidenceLevel)")
                match = false
            }
            if abs(asmt.zoneEasyPct - c.expected.zoneEasyPct) > 1.0 {
                errors.append("[\(c.name)] zoneEasyPct mismatch: got \(asmt.zoneEasyPct), expected \(c.expected.zoneEasyPct)")
                match = false
            }
            if abs(asmt.zoneThresholdPct - c.expected.zoneThresholdPct) > 1.0 {
                errors.append("[\(c.name)] zoneThresholdPct mismatch: got \(asmt.zoneThresholdPct), expected \(c.expected.zoneThresholdPct)")
                match = false
            }
            if asmt.templateId != c.expected.templateId {
                errors.append("[\(c.name)] TemplateId mismatch: got \(asmt.templateId), expected \(c.expected.templateId)")
                match = false
            }
            if asmt.isSilenced != c.expected.isSilenced {
                errors.append("[\(c.name)] isSilenced mismatch: got \(asmt.isSilenced), expected \(c.expected.isSilenced)")
                match = false
            }

            if match {
                passed += 1
            } else {
                failed += 1
            }
        }

        return (passed, failed, errors)
    }
}
