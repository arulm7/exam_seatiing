const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const db = require("./db");

/* ======================================================
   MULTER CONFIG
   ====================================================== */
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "_" + file.originalname);
  }
});
const upload = multer({ storage });



/* ======================================================
   POST: GENERATE SEATING (Students + Class Room Excel)
   ====================================================== */
router.post(
  "/generate-seating",
  upload.fields([
    { name: "students", maxCount: 1 },
    { name: "rooms", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { exam_date, exam_type } = req.body;

      /* ---------- BASIC VALIDATION ---------- */
      if (!exam_date || !exam_type || !req.files?.students || !req.files?.rooms) {
        return res.status(400).json({ message: "Missing fields" });
      }

      /* ---------- READ STUDENT EXCEL ---------- */
      const studentWB = XLSX.readFile(req.files.students[0].path);
      const students = XLSX.utils.sheet_to_json(
        studentWB.Sheets[studentWB.SheetNames[0]]
      );

      if (!students.length) {
        return res.status(400).json({ message: "No students found in Excel" });
      }

      /* ---------- READ ROOM EXCEL ---------- */
      const roomWB = XLSX.readFile(req.files.rooms[0].path);
      const rooms = XLSX.utils.sheet_to_json(
        roomWB.Sheets[roomWB.SheetNames[0]]
      );

      if (!rooms.length) {
        return res.status(400).json({ message: "No rooms found in Excel" });
      }

      /* ---------- IDENTIFY & NORMALIZE SESSIONS ---------- */
      const studentsBySession = {};
      const courseNameMap = {}; // Map code to name

      students.forEach(s => {
        let rawSession = s["SESSION"] ? String(s["SESSION"]).trim() : "FN";

        // Normalize Session Value
        let session = "FN";
        const upperRaw = rawSession.toUpperCase();

        if (upperRaw === "1" || upperRaw === "I" || upperRaw.includes("SESSION 1") || upperRaw.includes("SESSION-1") || upperRaw === "S1") {
          session = "FN (Session 1)";
        } else if (upperRaw === "2" || upperRaw === "II" || upperRaw.includes("SESSION 2") || upperRaw.includes("SESSION-2") || upperRaw === "S2") {
          session = "FN (Session 2)";
        } else if (upperRaw === "3" || upperRaw === "III" || upperRaw.includes("SESSION 3") || upperRaw.includes("SESSION-3") || upperRaw === "S3") {
          session = "AN (Session 3)";
        } else if (upperRaw === "4" || upperRaw === "IV" || upperRaw.includes("SESSION 4") || upperRaw.includes("SESSION-4") || upperRaw === "S4") {
          session = "AN (Session 4)";
        } else if (upperRaw === "FN" || upperRaw.includes("FORENOON") || upperRaw.includes("MORNING")) {
          session = "FN";
        } else if (upperRaw === "AN" || upperRaw.includes("AFTERNOON") || upperRaw.includes("EVENING")) {
          session = "AN";
        }

        // Store verbose normalized session back in student object
        s["SESSION"] = session;

        if (!studentsBySession[session]) {
          studentsBySession[session] = [];
        }
        studentsBySession[session].push(s);
        if (s["COURSE CODE"] && s["COURSE NAME"] && !courseNameMap[s["COURSE CODE"]]) {
          courseNameMap[s["COURSE CODE"]] = s["COURSE NAME"];
        }
      });

      // Sort unique sessions so FN comes before AN (F > A)
      const uniqueSessions = Object.keys(studentsBySession).sort((a, b) => b.localeCompare(a));

      /* ---------- CHECK: COURSE STRENGTHS ---------- */
      const courseStrengthMap = {};
      students.forEach(s => {
        const code = s["COURSE CODE"];
        if (code) courseStrengthMap[code] = (courseStrengthMap[code] || 0) + 1;
      });
      //console.log("\n[Capacity Check] Course Strengths:");
      Object.entries(courseStrengthMap).forEach(([code, count]) => {
        //console.log(` - ${code}: ${count} students`);
      });

      /* ---------- PLANNING: OPTIMIZE ROOMS ---------- */
      // Sort rooms by capacity (Descending) to ensure larger rooms are filled first
      rooms.sort((a, b) => (Number(b["Capacity"]) || 0) - (Number(a["Capacity"]) || 0));

      /* ---------- CHECK: CAPACITY ANALYSIS ---------- */
      const totalRoomCapacity = rooms.reduce((sum, r) => sum + (Number(r["Capacity"]) || 0), 0);

      uniqueSessions.forEach(session => {
        const count = studentsBySession[session] ? studentsBySession[session].length : 0;
        if (count > totalRoomCapacity) {
          //console.log(`[Capacity Check] Session ${session}: Students=${count}, Capacity=${totalRoomCapacity} (SHORTAGE)`);
        } else {
          //console.log(`[Capacity Check] Session ${session}: Students=${count}, Capacity=${totalRoomCapacity} (OK)`);
        }
      });

      /* ---------- CLEAR PREVIOUS SEATING FOR THIS DATE/TYPE ---------- */
      await db.promise().query("DELETE FROM exam_allocation WHERE exam_date = ? AND exam_type = ?", [exam_date, exam_type]);

      /* ---------- PREPARE GLOBAL STATS ---------- */
      let totalAllocatedStudents = 0;
      const roomResults = [];
      const globalCourseStats = {};
      const totalStudentsByCourse = {};
      const allUnallocatedStudents = [];
      const batchedInserts = [];

      const allCodes = new Set(students.map(s => s["COURSE CODE"]).filter(Boolean));
      allCodes.forEach(c => {
        globalCourseStats[c] = 0;
        totalStudentsByCourse[c] = students.filter(s => s["COURSE CODE"] === c).length;
      });

      /* ---------- LOOP THROUGH SESSIONS ---------- */
      for (const session of uniqueSessions) {
        const sessionStudents = studentsBySession[session];

        // Group by course for this session
        const sessionCourseMap = {};
        sessionStudents.forEach(s => {
          const code = s["COURSE CODE"];
          if (!code) return;
          if (!sessionCourseMap[code]) sessionCourseMap[code] = [];
          sessionCourseMap[code].push(s);
        });

        const sessionCourses = Object.keys(sessionCourseMap).sort((a, b) =>
          sessionCourseMap[b].length - sessionCourseMap[a].length
        );

        if (sessionCourses.length === 0) continue;

        // Bucketing for session
        const buckets = [[], [], [], []];
        const bucketCounts = [0, 0, 0, 0];
        for (const c of sessionCourses) {
          let minIdx = 0;
          for (let i = 1; i < 4; i++) {
            if (bucketCounts[i] < bucketCounts[minIdx]) minIdx = i;
          }
          buckets[minIdx].push(c);
          bucketCounts[minIdx] += sessionCourseMap[c].length;
        }

        /* ---------- ALLOCATE ROOMS FOR SESSION ---------- */
        for (const r of rooms) {
          const roomName = String(r["Class Room"]);
          const capacity = Number(r["Capacity"]);
          if (!roomName || !capacity || capacity <= 0) continue;

          // Check if session still has students
          if (!sessionCourses.some(c => sessionCourseMap[c].length > 0)) break;

          const columns = 4;
          const rows = Math.ceil(capacity / columns);
          const roomAllocatedSeats = [];

          const PATTERN_MATRIX = [
            [0, 1, 2, 3], [2, 3, 0, 1], [0, 1, 2, 3], [2, 3, 0, 1],
            [0, 1, 2, 3], [2, 3, 0, 1], [0, 1, 2, 3]
          ];

          for (let i = 1; i <= rows; i++) {
            for (let j = 1; j <= columns; j++) {
              if (roomAllocatedSeats.length >= capacity) break;

              const bucketIdx = PATTERN_MATRIX[(i - 1) % 7][(j - 1) % 4];
              const bucketCourses = buckets[bucketIdx];
              let selectedStudent = null;

              // Helper to check neighbors
              const isSafe = (courseCode) => {
                // Check Left (i, j-1)
                const left = roomAllocatedSeats.find(s => s.row === i && s.col === j - 1);
                if (left && left.course === courseCode) return false;
                // Check Top/Front (i-1, j) - this prevents "sitting behind same course" (rows increase 1..N)
                // If I am at row i, row i-1 is physically in front of me in many layouts, 
                // but effectively "Back" in terms of "person behind me checking my paper" depending on perspective.
                // User said "not come for that studen back or side".
                // Checking (i-1) ensures the person in front is different. 
                const top = roomAllocatedSeats.find(s => s.row === i - 1 && s.col === j);
                if (top && top.course === courseCode) return false;
                return true;
              };

              // 1. Try Preferred Bucket with Safety Check
              for (const c of bucketCourses) {
                if (sessionCourseMap[c] && sessionCourseMap[c].length > 0) {
                  if (isSafe(c)) {
                    selectedStudent = sessionCourseMap[c].shift();
                    break;
                  }
                }
              }

              // 2. Fallback: Try ANY largest available course with Safety Check
              if (!selectedStudent) {
                for (const c of sessionCourses) {
                  if (sessionCourseMap[c] && sessionCourseMap[c].length > 0) {
                    if (isSafe(c)) {
                      selectedStudent = sessionCourseMap[c].shift();
                      break;
                    }
                  }
                }
              }

              if (selectedStudent) {
                // Use the full verbose session string as the DB session value
                let dbSession = session;

                // Do NOT append session to room name (User Request: "take the an from the session column... dont add the session with the room number")
                const renamedRoom = roomName;

                // Capture Exam Time from student fields
                const examTime = selectedStudent["Time"] || selectedStudent["Exam Time"] || selectedStudent["EXAM TIME"] || null;

                // LOGIC NOTE: 
                // Since we removed session from room name, distinct sessions (1 & 2) in the same physical room 
                // will now rely solely on the `session` column for separation in the `processSeatingData` logic. 
                // We enabled this multi-key grouping in Step 324, so this is safe and correct.

                // Collect for Batch Insert
                batchedInserts.push([
                  selectedStudent["Reg No."],
                  selectedStudent["Student Name"],
                  selectedStudent["COURSE CODE"],
                  selectedStudent["COURSE NAME"],
                  dbSession, // Stores "FN (Session 1)" etc.
                  renamedRoom, // Clean room name

                  i,
                  j,
                  exam_date,
                  exam_type,
                  examTime // We can potentially store "Session 1" here if original "time" is empty? No, examTime is for 10:00 AM etc.
                ]);

                roomAllocatedSeats.push({
                  row: i, col: j,
                  course: selectedStudent["COURSE CODE"],
                  student: selectedStudent["Reg No."],
                  session: dbSession, // FN, AN
                  originalSession: session, // 1, 2, 3, 4 (kept in memory for display logic)
                  time: examTime
                });
                globalCourseStats[selectedStudent["COURSE CODE"]]++;
                totalAllocatedStudents++;
              }
            }
          }

          if (roomAllocatedSeats.length > 0) {
            // Ensure immediate response reflects the new verbose session logic
            // The seat objects already have `session` set to "FN (Session 1)" etc. from the loop above.

            const rawSession = roomAllocatedSeats[0].session; // e.g., "FN (Session 1)"
            let mapSession = 'FN'; // For filtering
            let displaySession = rawSession; // Checks out: "FN (Session 1)"

            const upperS = rawSession.toUpperCase();
            if (upperS.includes('FN') || upperS.includes('SESSION 1') || upperS.includes('SESSION 2')) {
              mapSession = 'FN';
            } else if (upperS.includes('AN') || upperS.includes('SESSION 3') || upperS.includes('SESSION 4')) {
              mapSession = 'AN';
            }

            roomResults.push({
              roomNumber: roomName, // Clean room name (no suffix)
              totalSeats: capacity,
              rows,
              columns,
              seats: roomAllocatedSeats.map(s => ({ ...s, session: s.session })),
              session: mapSession,
              displaySession: displaySession,
              originalRoom: roomName
            });
          }
        }

        // Collect unallocated for this session
        sessionCourses.forEach(c => {
          if (sessionCourseMap[c].length > 0) {
            allUnallocatedStudents.push(...sessionCourseMap[c].map(s => ({
              regNo: s["Reg No."], name: s["Student Name"],
              course: c, courseName: courseNameMap[c], session: s["SESSION"] || session,
              time: s["Time"] || s["Exam Time"]
            })));
          }
        });
      }

      // Execute Batch Insert
      if (batchedInserts.length > 0) {
        const chunkSize = 1000;
        for (let i = 0; i < batchedInserts.length; i += chunkSize) {
          const chunk = batchedInserts.slice(i, i + chunkSize);
          await db.promise().query(
            `INSERT INTO exam_allocation 
             (reg_no, student_name, course_code, course_name, session, room, seat_row, seat_column, exam_date, exam_type, exam_time) 
             VALUES ?`,
            [chunk]
          );
        }
      }

      /* ---------- WARNINGS & REPORTING ---------- */
      // Note: Warning table might need to support tracking by exam_date/type if we want history.
      // For now, we'll just clear valid warnings to keep it simple, or maybe we shouldn't clear?
      // User requested "from the db remove the auto delete" previously, but warnings are transient.
      // We will wipe for now as warnings are usually immediate feedback.
      const warnings = [];
      await db.promise().query(`
        CREATE TABLE IF NOT EXISTS allocation_warnings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          type VARCHAR(50), message TEXT, details JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.promise().query("DELETE FROM allocation_warnings");

      if (allUnallocatedStudents.length > 0) {
        // Group by course
        const unByCourse = {};
        allUnallocatedStudents.forEach(s => {
          if (!unByCourse[s.course]) unByCourse[s.course] = [];
          unByCourse[s.course].push(s);
        });

        for (const code in unByCourse) {
          const list = unByCourse[code];
          const m = `${list.length} student(s) from ${code} could not be allocated due to room capacity limits.`;
          const warningObj = { type: 'capacity_shortage', course: code, courseName: courseNameMap[code], message: m, count: list.length, unallocatedList: list };
          warnings.push(warningObj);
          await db.promise().query("INSERT INTO allocation_warnings (type, message, details) VALUES (?, ?, ?)", ['capacity_shortage', m, JSON.stringify(warningObj)]);
        }
      }

      const totalCap = rooms.reduce((sum, r) => sum + Number(r["Capacity"] || 0), 0);
      const util = totalCap > 0 ? (totalAllocatedStudents / totalCap * 100).toFixed(1) : 0;
      if (parseFloat(util) < 50) {
        const m = `Room utilization is low (${util}%).`;
        const warningObj = { type: 'low_utilization', message: m, utilizationRate: parseFloat(util) };
        warnings.push(warningObj);
        await db.promise().query("INSERT INTO allocation_warnings (type, message, details) VALUES (?, ?, ?)", ['low_utilization', m, JSON.stringify(warningObj)]);
      }

      const summary = {
        totalStudents: totalAllocatedStudents,
        totalRooms: roomResults.length,
        totalCourses: allCodes.size,
        totalInputStudents: students.length,
        unallocatedCount: allUnallocatedStudents.length,
        utilizationRate: parseFloat(util),
        examType: exam_type,
        examDate: exam_date
      };

      const courseStatsList = Array.from(allCodes).map(c => ({
        courseCode: c, courseName: courseNameMap[c] || '', allocatedSeats: globalCourseStats[c],
        totalStudents: totalStudentsByCourse[c], unallocated: totalStudentsByCourse[c] - globalCourseStats[c]
      }));

      res.json({
        status: warnings.length > 0 ? "success_with_warnings" : "success",
        message: warnings.length > 0 ? `Seating allocation completed with ${warnings.length} warning(s)` : "Seating allocation generated successfully",
        data: { summary, courseStats: courseStatsList, rooms: roomResults, warnings, unallocatedStudents: allUnallocatedStudents }
      });

    } catch (err) {
      console.error("SEATING ERROR:", err);
      res.status(500).json({
        message: "Seating generation failed",
        error: err.message
      });
    }
  }
);

/* ======================================================
   GET: STUDENT SEATING BY REGISTER NUMBER
   ====================================================== */
router.get("/student/:regno", async (req, res) => {
  try {
    const regno = req.params.regno;

    const [rows] = await db.promise().query(
      `SELECT 
        student_name,
        course_code,
        course_name,
        session,
        room,
        seat_row,
        seat_column,
        exam_date,
        exam_type,
        exam_time
    FROM exam_allocation
    WHERE reg_no = ?`,
      [regno]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: "No seating found for this register number"
      });
    }

    // Map sessions for student view too if needed, or leave raw?
    // User: "in the student sheet it self i will add the exam time and in that it self i will give the session 1 to 4... show the exam time in the student lookup"
    // I will pass the raw session as stored in DB (1, 2, 3, 4) because the user said "i will give the session 1 to 4".
    // AND I will add the 'displaySession' helper here too potentially?
    // Since rows are sent directly, I'll map them.

    const mappedRows = rows.map(r => {
      let disp = r.session;
      if (r.session === '1' || r.session === '2') disp = `FN (Session ${r.session})`;
      if (r.session === '3' || r.session === '4') disp = `AN (Session ${r.session})`;
      return {
        ...r,
        display_session: disp
      };
    });

    res.json(mappedRows);
  } catch (err) {
    console.error("STUDENT LOOKUP ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ======================================================
   HELPER: PROCESS SEATING DATA
   ====================================================== */
/* ======================================================
   HELPER: PROCESS SEATING DATA
   ====================================================== */
async function processSeatingData(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  // Calculate stats from rows
  const totalStudents = rows.length;
  // uniqueRooms count might be tricky if room names are reused across sessions using the same name.
  // Ideally, uniqueRooms is unique physical rooms.
  const uniqueRooms = new Set(rows.map(r => r.room)).size;
  const uniqueCourses = new Set(rows.map(r => r.course_code)).size;
  const examDate = rows[0].exam_date;
  const examType = rows[0].exam_type;

  // Course Stats
  const courseStatsMap = {};
  rows.forEach(r => {
    if (!courseStatsMap[r.course_code]) {
      courseStatsMap[r.course_code] = { courseCode: r.course_code, courseName: r.course_name, allocatedSeats: 0 };
    }
    courseStatsMap[r.course_code].allocatedSeats++;
  });
  const courseStats = Object.values(courseStatsMap);

  // Room Data - Group by Room AND Session to prevent merging different sessions
  const roomsMap = {};
  rows.forEach(row => {
    // Composite key to separate sessions
    const key = `${row.room}|${row.session}`;

    if (!roomsMap[key]) {
      roomsMap[key] = {
        roomNumber: row.room,
        session: row.session, // Store logic session
        seats: [],
        maxRow: 0,
        maxCol: 0
      };
    }
    roomsMap[key].seats.push({
      row: row.seat_row,
      col: row.seat_column,
      course: row.course_code,
      student: row.reg_no,
      session: row.session,
      time: row.exam_time
    });
    if (row.seat_row > roomsMap[key].maxRow) roomsMap[key].maxRow = row.seat_row;
    if (row.seat_column > roomsMap[key].maxCol) roomsMap[key].maxCol = row.seat_column;
  });

  const rooms = Object.values(roomsMap).map(r => {
    const forcedCapacity = 28;
    const forcedRows = 7;
    const forcedCols = 4;
    const finalRows = Math.max(r.maxRow, forcedRows);
    const finalCols = Math.max(r.maxCol, forcedCols);
    const finalCapacity = Math.max(r.seats.length, finalRows * finalCols);

    const rawSession = r.session || 'FN';

    // Determine Filterable Session (FN/AN) and Display Session from the stored string
    // Stored string might be: "FN (Session 1)", "FN", "1", "AN (Session 3)", etc.
    let mappedSession = 'FN'; // Default
    let displaySession = rawSession;

    const upperS = rawSession.toUpperCase();
    if (upperS.includes('FN') || upperS.includes('SESSION 1') || upperS.includes('SESSION 2') || upperS === '1' || upperS === '2') {
      mappedSession = 'FN';
    } else if (upperS.includes('AN') || upperS.includes('SESSION 3') || upperS.includes('SESSION 4') || upperS === '3' || upperS === '4') {
      mappedSession = 'AN';
    }

    return {
      roomNumber: r.roomNumber,
      totalSeats: finalCapacity,
      rows: finalRows,
      columns: finalCols,
      seats: r.seats,

      // The frontend uses 'session' for filtering (expected: FN or AN)
      session: mappedSession,

      // The frontend uses 'displaySession' for UI (e.g. "FN (Session 1)")
      // Since we are storing the verbose string in DB now, rawSession IS the displaySession.
      displaySession: displaySession,

      originalRoom: r.roomNumber
    };
  });

  return {
    summary: {
      totalStudents,
      totalRooms: uniqueRooms,
      totalCourses: uniqueCourses,
      examType,
      examDate
    },
    courseStats,
    rooms
  };
}

/* ======================================================
   GET: FETCH LATEST SEATING PLAN
   ====================================================== */
router.get("/current-seating", async (req, res) => {
  try {
    // Fetch latest exam details
    const [latest] = await db.promise().query("SELECT exam_date, exam_type FROM exam_allocation ORDER BY exam_date DESC LIMIT 1");

    if (latest.length === 0) {
      return res.json({ hasData: false });
    }

    const { exam_date, exam_type } = latest[0];
    const dateObj = new Date(exam_date);
    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

    // Fetch data for this latest plan
    const [rows] = await db.promise().query(
      "SELECT * FROM exam_allocation WHERE exam_date = ? AND exam_type = ?",
      [dateStr, exam_type]
    );

    const processed = await processSeatingData(rows);

    // Fetch Warnings (legacy/global for now)
    const [warningRows] = await db.promise().query("SELECT * FROM allocation_warnings");
    const warnings = warningRows.map(w => ({ type: w.type, message: w.message, ...w.details }));
    let unallocatedStudents = [];
    warningRows.forEach(w => {
      if (w.details && w.details.unallocatedList) {
        unallocatedStudents = [...unallocatedStudents, ...w.details.unallocatedList];
      }
    });

    res.json({
      hasData: true,
      data: {
        ...processed,
        warnings,
        unallocatedStudents
      }
    });

  } catch (err) {
    console.error("FETCH CURRENT SEATING ERROR:", err);
    res.status(500).json({ message: "Failed to fetch current seating" });
  }
});

/* ======================================================
   GET: SEARCH SEATING PLAN BY DATE & TYPE
   ====================================================== */
router.get("/view-seating", async (req, res) => {
  try {
    const { date, type } = req.query;

    if (!date || !type) {
      return res.status(400).json({ message: "Date and Exam Type are required" });
    }

    const [rows] = await db.promise().query(
      "SELECT * FROM exam_allocation WHERE exam_date = ? AND exam_type = ?",
      [date, type]
    );

    if (rows.length === 0) {
      return res.json({
        found: false,
        message: "On that day no exam scheduled"
      });
    }

    const processed = await processSeatingData(rows);

    // We don't link warnings to historical plans yet, so send empty or check if it matches current
    const warnings = [];
    const unallocatedStudents = [];

    res.json({
      found: true,
      data: {
        ...processed,
        warnings,
        unallocatedStudents
      }
    });

  } catch (err) {
    console.error("SEARCH SEATING ERROR:", err);
    res.status(500).json({ message: "Failed to search seating plan" });
  }
});

/* ======================================================
   DELETE: CLEAR SPECIFIC SEATING PLAN BY DATE & TYPE
   ====================================================== */
router.delete("/clear-seating", async (req, res) => {
  try {
    const { date, type } = req.query;

    if (!date || !type) {
      return res.status(400).json({
        message: "Exam date and exam type are required to delete a seating plan"
      });
    }

    // Check if the seating plan exists
    const [rows] = await db.promise().query(
      "SELECT COUNT(*) as count FROM exam_allocation WHERE exam_date = ? AND exam_type = ?",
      [date, type]
    );

    if (rows[0].count === 0) {
      return res.status(404).json({
        message: "No seating plan found for the specified date and exam type"
      });
    }

    // Delete the specific seating plan
    await db.promise().query(
      "DELETE FROM exam_allocation WHERE exam_date = ? AND exam_type = ?",
      [date, type]
    );

    // Note: We're keeping allocation_warnings as they're global/transient
    // If you want to link warnings to specific plans in the future, update this

    res.json({
      message: `Seating plan for ${type} on ${date} deleted successfully`,
      deletedCount: rows[0].count
    });
  } catch (err) {
    console.error("CLEAR SEATING ERROR:", err);
    res.status(500).json({ message: "Failed to clear seating data" });
  }
});

module.exports = router;
