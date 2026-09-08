import Foundation
import SQLite3

public final class RunnieDatabase {
    public static let shared = RunnieDatabase()

    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "com.projectcagla.runnie.database", qos: .userInitiated)

    public init(inMemory: Bool = false) {
        if inMemory {
            sqlite3_open(":memory:", &db)
        } else {
            let fileManager = FileManager.default
            let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            let dbDir = appSupport.appendingPathComponent("Runnie", isDirectory: true)
            try? fileManager.createDirectory(at: dbDir, withIntermediateDirectories: true)
            let dbPath = dbDir.appendingPathComponent("runnie.sqlite").path
            sqlite3_open(dbPath, &db)
        }
        createTables()
    }

    deinit {
        if db != nil {
            sqlite3_close(db)
        }
    }

    private func executeRaw(_ sql: String) {
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK {
            if let e = err {
                print("SQLite raw error: \(String(cString: e)) on SQL: \(sql)")
                sqlite3_free(err)
            }
        }
    }

    private func createTables() {
        executeRaw("PRAGMA journal_mode = WAL;")
        executeRaw("PRAGMA foreign_keys = ON;")

        let createActivities = """
        CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY,
            client_activity_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            sport_type TEXT NOT NULL,
            surface_type TEXT NOT NULL,
            title TEXT,
            start_time TEXT NOT NULL,
            elapsed_time_sec REAL NOT NULL,
            moving_time_sec REAL NOT NULL,
            distance_meters REAL NOT NULL,
            elevation_gain_meters REAL NOT NULL,
            has_heart_rate INTEGER NOT NULL DEFAULT 0,
            avg_hr REAL,
            max_hr REAL,
            avg_cadence REAL,
            avg_pace_sec_per_km REAL,
            gap_sec_per_km REAL,
            pace_source TEXT,
            has_instantaneous_pace INTEGER NOT NULL DEFAULT 0,
            is_duplicate INTEGER NOT NULL DEFAULT 0,
            duplicate_of_id TEXT,
            created_at TEXT NOT NULL
        );
        """
        executeRaw(createActivities)

        let createStreams = """
        CREATE TABLE IF NOT EXISTS activity_streams (
            activity_id TEXT PRIMARY KEY,
            stream_json TEXT NOT NULL,
            point_count INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        """
        executeRaw(createStreams)

        let createThresholds = """
        CREATE TABLE IF NOT EXISTS user_thresholds (
            id TEXT PRIMARY KEY,
            lthr REAL NOT NULL,
            aet_hr REAL NOT NULL,
            aet_min REAL NOT NULL,
            aet_max REAL NOT NULL,
            threshold_pace REAL NOT NULL,
            easy_pace_ceiling REAL NOT NULL,
            derivation_method TEXT NOT NULL,
            confidence_score REAL NOT NULL,
            calibration_status TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            valid_from TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
        executeRaw(createThresholds)

        let createAssessments = """
        CREATE TABLE IF NOT EXISTS assessments (
            id TEXT PRIMARY KEY,
            activity_id TEXT UNIQUE NOT NULL,
            threshold_id TEXT NOT NULL,
            verdict TEXT NOT NULL,
            sentence TEXT NOT NULL,
            secondary_sentence TEXT NOT NULL,
            template_id TEXT NOT NULL,
            easy_pct REAL NOT NULL,
            moderate_pct REAL NOT NULL,
            threshold_pct REAL NOT NULL,
            confidence_level TEXT NOT NULL,
            confidence_score REAL NOT NULL,
            flags_json TEXT NOT NULL,
            is_silenced INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """
        executeRaw(createAssessments)

        let createWeatherCache = """
        CREATE TABLE IF NOT EXISTS weather_cache (
            cache_key TEXT PRIMARY KEY,
            weather_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
        executeRaw(createWeatherCache)

        let createFeedbacks = """
        CREATE TABLE IF NOT EXISTS user_feedbacks (
            id TEXT PRIMARY KEY,
            activity_id TEXT NOT NULL,
            feedback_tag TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL
        );
        """
        executeRaw(createFeedbacks)

        let createTelemetry = """
        CREATE TABLE IF NOT EXISTS delivery_telemetry (
            id TEXT PRIMARY KEY,
            activity_id TEXT NOT NULL,
            workout_end_time TEXT NOT NULL,
            notification_time TEXT NOT NULL,
            latency_ms INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        """
        executeRaw(createTelemetry)
    }

    // MARK: - Activities
    public func saveActivity(_ act: NormalizedActivity, stream: [StreamPoint]? = nil) {
        queue.sync {
            let sql = """
            INSERT OR REPLACE INTO activities (
                id, client_activity_id, source_name, sport_type, surface_type, title,
                start_time, elapsed_time_sec, moving_time_sec, distance_meters, elevation_gain_meters,
                has_heart_rate, avg_hr, max_hr, avg_cadence, avg_pace_sec_per_km, gap_sec_per_km,
                pace_source, has_instantaneous_pace, is_duplicate, duplicate_of_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                let nowStr = ISO8601DateFormatter().string(from: Date())
                sqlite3_bind_text(stmt, 1, (act.id as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (act.id as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 3, ((act.sourceName ?? "Unknown") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 4, (act.sportType.rawValue as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 5, (act.surfaceType.rawValue as NSString).utf8String, -1, nil)
                if let t = act.title { sqlite3_bind_text(stmt, 6, (t as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 6) }
                sqlite3_bind_text(stmt, 7, (act.startTime as NSString).utf8String, -1, nil)
                sqlite3_bind_double(stmt, 8, act.elapsedTimeSec)
                sqlite3_bind_double(stmt, 9, act.movingTimeSec)
                sqlite3_bind_double(stmt, 10, act.distanceMeters)
                sqlite3_bind_double(stmt, 11, act.elevationGainMeters)
                sqlite3_bind_int(stmt, 12, act.hasHeartRate ? 1 : 0)
                if let val = act.avgHr { sqlite3_bind_double(stmt, 13, val) } else { sqlite3_bind_null(stmt, 13) }
                if let val = act.maxHr { sqlite3_bind_double(stmt, 14, val) } else { sqlite3_bind_null(stmt, 14) }
                if let val = act.avgCadence { sqlite3_bind_double(stmt, 15, val) } else { sqlite3_bind_null(stmt, 15) }
                if let val = act.avgPaceSecPerKm { sqlite3_bind_double(stmt, 16, val) } else { sqlite3_bind_null(stmt, 16) }
                if let val = act.gapSecPerKm { sqlite3_bind_double(stmt, 17, val) } else { sqlite3_bind_null(stmt, 17) }
                if let val = act.paceSource { sqlite3_bind_text(stmt, 18, (val as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 18) }
                sqlite3_bind_int(stmt, 19, (act.hasInstantaneousPace ?? false) ? 1 : 0)
                sqlite3_bind_int(stmt, 20, act.isDuplicate ? 1 : 0)
                if let val = act.duplicateOfId { sqlite3_bind_text(stmt, 21, (val as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 21) }
                sqlite3_bind_text(stmt, 22, (nowStr as NSString).utf8String, -1, nil)
                sqlite3_step(stmt)
            }
            sqlite3_finalize(stmt)

            if let stream = stream, !stream.isEmpty {
                let streamSql = "INSERT OR REPLACE INTO activity_streams (activity_id, stream_json, point_count, created_at) VALUES (?, ?, ?, ?);"
                var streamStmt: OpaquePointer?
                if sqlite3_prepare_v2(db, streamSql, -1, &streamStmt, nil) == SQLITE_OK {
                    if let data = try? JSONEncoder().encode(stream), let jsonStr = String(data: data, encoding: .utf8) {
                        let nowStr = ISO8601DateFormatter().string(from: Date())
                        sqlite3_bind_text(streamStmt, 1, (act.id as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(streamStmt, 2, (jsonStr as NSString).utf8String, -1, nil)
                        sqlite3_bind_int(streamStmt, 3, Int32(stream.count))
                        sqlite3_bind_text(streamStmt, 4, (nowStr as NSString).utf8String, -1, nil)
                        sqlite3_step(streamStmt)
                    }
                }
                sqlite3_finalize(streamStmt)
            }
        }
    }

    public func getAllActivities(limit: Int = 100) -> [NormalizedActivity] {
        return queue.sync {
            var results: [NormalizedActivity] = []
            let sql = "SELECT id, source_name, sport_type, surface_type, title, start_time, elapsed_time_sec, moving_time_sec, distance_meters, elevation_gain_meters, has_heart_rate, avg_hr, max_hr, avg_cadence, avg_pace_sec_per_km, gap_sec_per_km, pace_source, has_instantaneous_pace, is_duplicate, duplicate_of_id FROM activities ORDER BY start_time DESC LIMIT ?;"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_int(stmt, 1, Int32(limit))
                while sqlite3_step(stmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(stmt, 0))
                    let source = String(cString: sqlite3_column_text(stmt, 1))
                    let sport = SportType(rawValue: String(cString: sqlite3_column_text(stmt, 2))) ?? .run
                    let surface = SurfaceType(rawValue: String(cString: sqlite3_column_text(stmt, 3))) ?? .road
                    let title = sqlite3_column_text(stmt, 4) != nil ? String(cString: sqlite3_column_text(stmt, 4)) : nil
                    let start = String(cString: sqlite3_column_text(stmt, 5))
                    let elapsed = sqlite3_column_double(stmt, 6)
                    let moving = sqlite3_column_double(stmt, 7)
                    let dist = sqlite3_column_double(stmt, 8)
                    let elev = sqlite3_column_double(stmt, 9)
                    let hasHr = sqlite3_column_int(stmt, 10) == 1
                    let avgHr = sqlite3_column_type(stmt, 11) != SQLITE_NULL ? sqlite3_column_double(stmt, 11) : nil
                    let maxHr = sqlite3_column_type(stmt, 12) != SQLITE_NULL ? sqlite3_column_double(stmt, 12) : nil
                    let avgCad = sqlite3_column_type(stmt, 13) != SQLITE_NULL ? sqlite3_column_double(stmt, 13) : nil
                    let avgPace = sqlite3_column_type(stmt, 14) != SQLITE_NULL ? sqlite3_column_double(stmt, 14) : nil
                    let gap = sqlite3_column_type(stmt, 15) != SQLITE_NULL ? sqlite3_column_double(stmt, 15) : nil
                    let paceSrc = sqlite3_column_text(stmt, 16) != nil ? String(cString: sqlite3_column_text(stmt, 16)) : nil
                    let hasInstPace = sqlite3_column_int(stmt, 17) == 1
                    let isDup = sqlite3_column_int(stmt, 18) == 1
                    let dupOf = sqlite3_column_text(stmt, 19) != nil ? String(cString: sqlite3_column_text(stmt, 19)) : nil

                    let act = NormalizedActivity(
                        id: id,
                        sportType: sport,
                        title: title,
                        startTime: start,
                        elapsedTimeSec: elapsed,
                        movingTimeSec: moving,
                        distanceMeters: dist,
                        elevationGainMeters: elev,
                        hasHeartRate: hasHr,
                        avgHr: avgHr,
                        maxHr: maxHr,
                        avgCadence: avgCad,
                        avgPaceSecPerKm: avgPace,
                        gapSecPerKm: gap,
                        surfaceType: surface,
                        hasInstantaneousPace: hasInstPace,
                        sourceName: source,
                        paceSource: paceSrc,
                        isDuplicate: isDup,
                        duplicateOfId: dupOf
                    )
                    results.append(act)
                }
            }
            sqlite3_finalize(stmt)
            return results
        }
    }

    public func getStream(activityId: String) -> [StreamPoint]? {
        return queue.sync {
            let sql = "SELECT stream_json FROM activity_streams WHERE activity_id = ?;"
            var stmt: OpaquePointer?
            var points: [StreamPoint]? = nil
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (activityId as NSString).utf8String, -1, nil)
                if sqlite3_step(stmt) == SQLITE_ROW {
                    if let text = sqlite3_column_text(stmt, 0),
                       let data = String(cString: text).data(using: .utf8) {
                        points = try? JSONDecoder().decode([StreamPoint].self, from: data)
                    }
                }
            }
            sqlite3_finalize(stmt)
            return points
        }
    }

    // MARK: - Thresholds
    public func saveThresholds(_ th: UserThresholds) {
        queue.sync {
            executeRaw("UPDATE user_thresholds SET is_active = 0;")
            let sql = """
            INSERT OR REPLACE INTO user_thresholds (
                id, lthr, aet_hr, aet_min, aet_max, threshold_pace, easy_pace_ceiling,
                derivation_method, confidence_score, calibration_status, is_active, valid_from, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);
            """
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                let nowStr = ISO8601DateFormatter().string(from: Date())
                sqlite3_bind_text(stmt, 1, (th.id as NSString).utf8String, -1, nil)
                sqlite3_bind_double(stmt, 2, th.lthr)
                sqlite3_bind_double(stmt, 3, th.aerobicThresholdHrPoint)
                sqlite3_bind_double(stmt, 4, th.aerobicThresholdHrMin)
                sqlite3_bind_double(stmt, 5, th.aerobicThresholdHrMax)
                sqlite3_bind_double(stmt, 6, th.thresholdPaceGapSecPerKm)
                sqlite3_bind_double(stmt, 7, th.easyPaceCeilingGapSecPerKm)
                sqlite3_bind_text(stmt, 8, (th.derivationMethod.rawValue as NSString).utf8String, -1, nil)
                sqlite3_bind_double(stmt, 9, th.confidenceScore)
                sqlite3_bind_text(stmt, 10, (th.calibrationStatus as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 11, (th.validFrom as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 12, (nowStr as NSString).utf8String, -1, nil)
                sqlite3_step(stmt)
            }
            sqlite3_finalize(stmt)
        }
    }

    public func getActiveThresholds() -> UserThresholds? {
        return queue.sync {
            let sql = "SELECT id, lthr, aet_hr, aet_min, aet_max, threshold_pace, easy_pace_ceiling, derivation_method, confidence_score, calibration_status, valid_from FROM user_thresholds WHERE is_active = 1 LIMIT 1;"
            var stmt: OpaquePointer?
            var th: UserThresholds? = nil
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                if sqlite3_step(stmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(stmt, 0))
                    let lthr = sqlite3_column_double(stmt, 1)
                    let aet = sqlite3_column_double(stmt, 2)
                    let aetMin = sqlite3_column_double(stmt, 3)
                    let aetMax = sqlite3_column_double(stmt, 4)
                    let threshPace = sqlite3_column_double(stmt, 5)
                    let easyCeiling = sqlite3_column_double(stmt, 6)
                    let method = DerivationMethod(rawValue: String(cString: sqlite3_column_text(stmt, 7))) ?? .unverifiedEstimate
                    let conf = sqlite3_column_double(stmt, 8)
                    let status = String(cString: sqlite3_column_text(stmt, 9))
                    let validFrom = String(cString: sqlite3_column_text(stmt, 10))

                    th = UserThresholds(
                        id: id,
                        validFrom: validFrom,
                        hrMaxEstimated: 185,
                        lthr: lthr,
                        aerobicThresholdHrPoint: aet,
                        aerobicThresholdHrMargin: aet - aetMin,
                        aerobicThresholdHrMin: aetMin,
                        aerobicThresholdHrMax: aetMax,
                        thresholdPaceGapSecPerKm: threshPace,
                        easyPaceCeilingGapSecPerKm: easyCeiling,
                        derivationMethod: method,
                        confidenceScore: conf,
                        calibrationStatus: status
                    )
                }
            }
            sqlite3_finalize(stmt)
            return th
        }
    }

    // MARK: - Assessments
    public func saveAssessment(_ asmt: Assessment) {
        queue.sync {
            let sql = """
            INSERT OR REPLACE INTO assessments (
                id, activity_id, threshold_id, verdict, sentence, secondary_sentence,
                template_id, easy_pct, moderate_pct, threshold_pct, confidence_level,
                confidence_score, flags_json, is_silenced, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                let nowStr = ISO8601DateFormatter().string(from: Date())
                let flagsJson = (try? String(data: JSONEncoder().encode(asmt.flags), encoding: .utf8)) ?? "[]"
                sqlite3_bind_text(stmt, 1, (asmt.activityId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (asmt.activityId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 3, (asmt.thresholdId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 4, (asmt.analysisJudgment.rawValue as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 5, (asmt.outputSentence as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 6, (asmt.secondaryCostSentence as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 7, (asmt.templateId as NSString).utf8String, -1, nil)
                sqlite3_bind_double(stmt, 8, asmt.zoneEasyPct)
                sqlite3_bind_double(stmt, 9, asmt.zoneModeratePct)
                sqlite3_bind_double(stmt, 10, asmt.zoneThresholdPct)
                sqlite3_bind_text(stmt, 11, (asmt.confidenceLevel.rawValue as NSString).utf8String, -1, nil)
                sqlite3_bind_double(stmt, 12, asmt.confidenceScore)
                sqlite3_bind_text(stmt, 13, (flagsJson as NSString).utf8String, -1, nil)
                sqlite3_bind_int(stmt, 14, asmt.isSilenced ? 1 : 0)
                sqlite3_bind_text(stmt, 15, (nowStr as NSString).utf8String, -1, nil)
                sqlite3_step(stmt)
            }
            sqlite3_finalize(stmt)
        }
    }

    public func getLatestAssessment() -> Assessment? {
        return queue.sync {
            let sql = """
            SELECT a.activity_id, a.threshold_id, a.verdict, a.sentence, a.secondary_sentence,
                   a.template_id, a.easy_pct, a.moderate_pct, a.threshold_pct, a.confidence_level,
                   a.confidence_score, a.flags_json, a.is_silenced
            FROM assessments a
            JOIN activities act ON a.activity_id = act.id
            WHERE act.is_duplicate = 0
            ORDER BY act.start_time DESC LIMIT 1;
            """
            var stmt: OpaquePointer?
            var asmt: Assessment? = nil
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                if sqlite3_step(stmt) == SQLITE_ROW {
                    let actId = String(cString: sqlite3_column_text(stmt, 0))
                    let thId = String(cString: sqlite3_column_text(stmt, 1))
                    let verdict = AssessmentJudgment(rawValue: String(cString: sqlite3_column_text(stmt, 2))) ?? .accordingToPlan
                    let sent = String(cString: sqlite3_column_text(stmt, 3))
                    let secSent = String(cString: sqlite3_column_text(stmt, 4))
                    let tplId = String(cString: sqlite3_column_text(stmt, 5))
                    let easy = sqlite3_column_double(stmt, 6)
                    let mod = sqlite3_column_double(stmt, 7)
                    let thresh = sqlite3_column_double(stmt, 8)
                    let confLvl = ConfidenceLevel(rawValue: String(cString: sqlite3_column_text(stmt, 9))) ?? .high
                    let confScore = sqlite3_column_double(stmt, 10)
                    let flagsText = String(cString: sqlite3_column_text(stmt, 11))
                    let flags = (try? JSONDecoder().decode([String].self, from: flagsText.data(using: .utf8) ?? Data())) ?? []
                    let silenced = sqlite3_column_int(stmt, 12) == 1

                    asmt = Assessment(
                        activityId: actId,
                        thresholdId: thId,
                        inferredIntent: .easy,
                        definiteEasyPct: easy,
                        uncertainCorridorPct: 0,
                        definiteGrayPct: mod,
                        definiteThresholdPct: thresh,
                        zoneEasyPct: easy,
                        zoneModeratePct: mod,
                        zoneThresholdPct: thresh,
                        analysisJudgment: verdict,
                        templateId: tplId,
                        outputSentence: sent,
                        secondaryCostSentence: secSent,
                        confidenceLevel: confLvl,
                        confidenceScore: confScore,
                        flags: flags,
                        isSilenced: silenced,
                        steadyStateDurationSec: 0
                    )
                }
            }
            sqlite3_finalize(stmt)
            return asmt
        }
    }

    // MARK: - Weather Cache
    public func getCachedWeather(cacheKey: String) -> WeatherSnapshot? {
        return queue.sync {
            let sql = "SELECT weather_json FROM weather_cache WHERE cache_key = ?;"
            var stmt: OpaquePointer?
            var snap: WeatherSnapshot? = nil
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (cacheKey as NSString).utf8String, -1, nil)
                if sqlite3_step(stmt) == SQLITE_ROW {
                    if let text = sqlite3_column_text(stmt, 0),
                       let data = String(cString: text).data(using: .utf8) {
                        snap = try? JSONDecoder().decode(WeatherSnapshot.self, from: data)
                    }
                }
            }
            sqlite3_finalize(stmt)
            return snap
        }
    }

    public func saveCachedWeather(cacheKey: String, weather: WeatherSnapshot) {
        queue.sync {
            guard let data = try? JSONEncoder().encode(weather),
                  let jsonStr = String(data: data, encoding: .utf8) else { return }
            let sql = "INSERT OR REPLACE INTO weather_cache (cache_key, weather_json, created_at) VALUES (?, ?, ?);"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                let nowStr = ISO8601DateFormatter().string(from: Date())
                sqlite3_bind_text(stmt, 1, (cacheKey as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (jsonStr as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 3, (nowStr as NSString).utf8String, -1, nil)
                sqlite3_step(stmt)
            }
            sqlite3_finalize(stmt)
        }
    }

    // MARK: - Telemetry & Privacy (Zero-knowledge Wipe)
    public func saveDeliveryTelemetry(activityId: String, workoutEndTime: Date, notificationTime: Date, latencyMs: Int) {
        queue.sync {
            let sql = "INSERT INTO delivery_telemetry (id, activity_id, workout_end_time, notification_time, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?);"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                let formatter = ISO8601DateFormatter()
                let nowStr = formatter.string(from: Date())
                sqlite3_bind_text(stmt, 1, (UUID().uuidString as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (activityId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 3, (formatter.string(from: workoutEndTime) as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 4, (formatter.string(from: notificationTime) as NSString).utf8String, -1, nil)
                sqlite3_bind_int(stmt, 5, Int32(latencyMs))
                sqlite3_bind_text(stmt, 6, (nowStr as NSString).utf8String, -1, nil)
                sqlite3_step(stmt)
            }
            sqlite3_finalize(stmt)
        }
    }

    public func deleteUserDataCompletely() {
        queue.sync {
            executeRaw("DELETE FROM delivery_telemetry;")
            executeRaw("DELETE FROM user_feedbacks;")
            executeRaw("DELETE FROM assessments;")
            executeRaw("DELETE FROM activity_streams;")
            executeRaw("DELETE FROM activities;")
            executeRaw("DELETE FROM user_thresholds;")
            executeRaw("DELETE FROM weather_cache;")
            executeRaw("VACUUM;")
        }
    }
}
