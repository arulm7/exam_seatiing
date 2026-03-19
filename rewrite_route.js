const fs = require('fs');
const file = 'backend/seatingRoutes.js';
let content = fs.readFileSync(file, 'utf8');

const target = `router.post(
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
      const courseNameMap = {};

      students.forEach(s => {
        let rawSession = s["SESSION"] ? String(s["SESSION"]).trim() : "FN";
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

        s["SESSION"] = session;

        if (!studentsBySession[session]) {
          studentsBySession[session] = [];
        }
        studentsBySession[session].push(s);

        // Build course name map
        const courseCode = s["COURSE CODE"];
        const courseName = s["COURSE NAME"];
        if (courseCode && courseName) {
          // Check for consistency
          if (courseNameMap[courseCode] && courseNameMap[courseCode] !== courseName) {
            console.warn(\`Course code \${courseCode} has inconsistent names: "\${courseNameMap[courseCode]}" vs "\${courseName}"\`);
            // Keep the first encountered name
          } else if (!courseNameMap[courseCode]) {
            courseNameMap[courseCode] = courseName;
          }
        }
      });

      const uniqueSessions = Object.keys(studentsBySession).sort((a, b) => b.localeCompare(a));

      /* ---------- CLEAR PREVIOUS SEATING FOR THIS DATE/TYPE ---------- */
      await db.promise().query("DELETE FROM exam_allocation WHERE exam_date = ? AND exam_type = ?", [exam_date, exam_type]);

      /* ---------- PREPARE GLOBAL STATS ---------- */
      let totalAllocatedStudents = 0;
      let roomResults = [];
      const globalCourseStats = {};
      const allUnallocatedStudents = [];
      let batchedInserts = [];

      const allCodes = new Set(students.map(s => s["COURSE CODE"]).filter(Boolean));
      allCodes.forEach(c => {
        globalCourseStats[c] = 0;
      });

      /* ---------- LOOP THROUGH SESSIONS ---------- */
      for (const session of uniqueSessions) {
        let sessionStudents = [...studentsBySession[session]];

        // Sort rooms by capacity (descending)
        const sortedRooms = [...rooms].sort((a, b) =>
          (Number(b["Capacity"]) || 0) - (Number(a["Capacity"]) || 0)
        );

        // Allocate students to rooms
        for (const room of sortedRooms) {
          if (sessionStudents.length === 0) break;

          const roomName = String(room["Class Room"]);
          const capacity = Number(room["Capacity"]);

          if (!roomName || !capacity || capacity <= 0) continue;

          // Allocate room with conditions
          const result = allocateRoomWithConditions(
            roomName,
            capacity,
            sessionStudents,
            session,
            exam_date,
            exam_type,
            courseNameMap
          );

          sessionStudents = result.remainingStudents;
          batchedInserts.push(...result.inserts);

          if (result.allocatedSeats.length > 0) {
            // Verify course limits per room using course groups
            const courseCounts = {};
            result.allocatedSeats.forEach(seat => {
              const groupCode = getCourseGroup(seat.course);
              courseCounts[groupCode] = (courseCounts[groupCode] || 0) + 1;
              globalCourseStats[seat.course] = (globalCourseStats[seat.course] || 0) + 1;
              totalAllocatedStudents++;
            });

            // Check if any course group has more than 8 students
            for (const [groupCode, count] of Object.entries(courseCounts)) {
              if (count > 8) {
                console.error(\`ERROR in room \${roomName}: Course group \${groupCode} has \${count} students (max 8 allowed)\`);
              }
            }

            // Determine session for filtering
            const rawSession = session;
            let mapSession = 'FN';
            let displaySession = rawSession;

            const upperS = rawSession.toUpperCase();
            if (upperS.includes('FN') || upperS.includes('SESSION 1') || upperS.includes('SESSION 2')) {
              mapSession = 'FN';
            } else if (upperS.includes('AN') || upperS.includes('SESSION 3') || upperS.includes('SESSION 4')) {
              mapSession = 'AN';
            }

            roomResults.push({
              roomNumber: roomName,
              totalSeats: result.allocatedSeats.length,
              rows: Math.ceil(result.allocatedSeats.length / 4),
              columns: 4,
              seats: result.allocatedSeats,
              session: mapSession,
              displaySession: displaySession,
              originalRoom: roomName,
              courseCounts: courseCounts // Add course counts for debugging
            });
          }
        }

        // Handle leftover students (Condition 2)
        if (sessionStudents.length > 0 && sessionStudents.length < 28) {
          const redistribution = handleLeftoverStudents(
            roomResults,
            sessionStudents,
            session,
            exam_date,
            exam_type,
            batchedInserts,
            courseNameMap
          );

          roomResults = redistribution.updatedResults;
          batchedInserts = redistribution.updatedInserts;
          sessionStudents = redistribution.finalLeftover;
        }

        // Add any still unallocated students to global list
        if (sessionStudents.length > 0) {
          allUnallocatedStudents.push(...sessionStudents.map(s => ({
            regNo: s["Reg No."],
            name: s["Student Name"],
            course: s["COURSE CODE"],
            courseName: courseNameMap[s["COURSE CODE"]] || s["COURSE NAME"] || "",
            session: s["SESSION"] || session,
            time: s["Time"] || s["Exam Time"] || null
          })));
        }
      }

      // Execute Batch Insert
      if (batchedInserts.length > 0) {
        const chunkSize = 1000;
        for (let i = 0; i < batchedInserts.length; i += chunkSize) {
          const chunk = batchedInserts.slice(i, i + chunkSize);
          await db.promise().query(
            \`INSERT INTO exam_allocation 
             (reg_no, student_name, course_code, course_name, session, room, seat_row, seat_column, exam_date, exam_type, exam_time) 
             VALUES ?\`,
            [chunk]
          );
        }
      }

      /* ---------- WARNINGS & REPORTING ---------- */
      await db.promise().query(\`
        CREATE TABLE IF NOT EXISTS allocation_warnings (\``;

const replacement = `router.post(
  "/generate-seating",
  upload.fields([
    { name: "normal_students", maxCount: 1 },
    { name: "mcq_students", maxCount: 1 },
    { name: "normal_rooms", maxCount: 1 },
    { name: "mcq_rooms", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { exam_date, exam_type } = req.body;

      /* ---------- BASIC VALIDATION ---------- */
      if (!exam_date || !exam_type) {
        return res.status(400).json({ message: "Missing fields" });
      }

      const parseExcel = (fileField) => {
        if (!req.files?.[fileField] || req.files[fileField].length === 0) return [];
        const wb = XLSX.readFile(req.files[fileField][0].path);
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      };

      const normalStudents = parseExcel("normal_students");
      const mcqStudents = parseExcel("mcq_students");
      const normalRooms = parseExcel("normal_rooms");
      const mcqRooms = parseExcel("mcq_rooms");

      if (!normalStudents.length && !mcqStudents.length) {
        return res.status(400).json({ message: "No students found in any Excel" });
      }
      if (!normalRooms.length && !mcqRooms.length) {
        return res.status(400).json({ message: "No rooms found in any Excel" });
      }

      /* ---------- CLEAR PREVIOUS SEATING FOR THIS DATE/TYPE ---------- */
      await db.promise().query("DELETE FROM exam_allocation WHERE exam_date = ? AND exam_type = ?", [exam_date, exam_type]);

      let totalAllocatedStudents = 0;
      let roomResults = [];
      const globalCourseStats = {};
      const allUnallocatedStudents = [];
      let batchedInserts = [];
      const courseNameMap = {};
      const totalStudentsByCourse = {};

      const datasets = [
        { mode: "NORMAL", students: normalStudents, rooms: normalRooms },
        { mode: "MCQ", students: mcqStudents, rooms: mcqRooms }
      ];

      const allCodes = new Set([
        ...normalStudents.map(s => s["COURSE CODE"]).filter(Boolean),
        ...mcqStudents.map(s => s["COURSE CODE"]).filter(Boolean)
      ]);
      allCodes.forEach(c => {
        globalCourseStats[c] = 0;
      });

      for (const dataset of datasets) {
        const { mode, students, rooms } = dataset;
        if (!students.length || !rooms.length) continue;

        /* ---------- IDENTIFY & NORMALIZE SESSIONS ---------- */
        const studentsBySession = {};
        students.forEach(s => {
          let rawSession = s["SESSION"] ? String(s["SESSION"]).trim() : "FN";
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

          s["SESSION"] = session;

          if (!studentsBySession[session]) {
            studentsBySession[session] = [];
          }
          studentsBySession[session].push(s);

          const courseCode = s["COURSE CODE"];
          const courseName = s["COURSE NAME"];
          if (courseCode && courseName) {
            if (!courseNameMap[courseCode]) courseNameMap[courseCode] = courseName;
          }
          if (courseCode) {
             totalStudentsByCourse[courseCode] = (totalStudentsByCourse[courseCode] || 0) + 1;
          }
        });

        const uniqueSessions = Object.keys(studentsBySession).sort((a, b) => b.localeCompare(a));

        /* ---------- LOOP THROUGH SESSIONS ---------- */
        for (const session of uniqueSessions) {
          let sessionStudents = [...studentsBySession[session]];

          // Sort rooms by capacity (descending)
          const sortedRooms = [...rooms].sort((a, b) =>
            (Number(b["Capacity"]) || 0) - (Number(a["Capacity"]) || 0)
          );

          // Allocate students to rooms
          for (const room of sortedRooms) {
            if (sessionStudents.length === 0) break;

            const roomName = String(room["Class Room"]);
            const capacity = Number(room["Capacity"]);

            if (!roomName || !capacity || capacity <= 0) continue;

            const result = allocateRoomWithConditions(
              roomName,
              capacity,
              sessionStudents,
              session,
              exam_date,
              exam_type,
              courseNameMap,
              mode
            );

            sessionStudents = result.remainingStudents;
            batchedInserts.push(...result.inserts);

            if (result.allocatedSeats.length > 0) {
              const courseCounts = {};
              result.allocatedSeats.forEach(seat => {
                const groupCode = getCourseGroup(seat.course);
                courseCounts[groupCode] = (courseCounts[groupCode] || 0) + 1;
                globalCourseStats[seat.course] = (globalCourseStats[seat.course] || 0) + 1;
                totalAllocatedStudents++;
              });

              for (const [groupCode, count] of Object.entries(courseCounts)) {
                if (count > 8) {
                  console.error(\`ERROR in room \${roomName} (\${mode}): Course group \${groupCode} has \${count} students (max 8 allowed)\`);
                }
              }

              const rawSession = session;
              let mapSession = 'FN';
              let displaySession = rawSession;

              const upperS = rawSession.toUpperCase();
              if (upperS.includes('FN') || upperS.includes('SESSION 1') || upperS.includes('SESSION 2')) {
                mapSession = 'FN';
              } else if (upperS.includes('AN') || upperS.includes('SESSION 3') || upperS.includes('SESSION 4')) {
                mapSession = 'AN';
              }

              roomResults.push({
                roomNumber: roomName,
                totalSeats: result.allocatedSeats.length,
                rows: Math.ceil(result.allocatedSeats.length / 4),
                columns: 4,
                seats: result.allocatedSeats,
                session: mapSession,
                displaySession: displaySession,
                originalRoom: roomName,
                courseCounts: courseCounts,
                examMode: mode
              });
            }
          }

          // Handle leftover students (Condition 2)
          if (sessionStudents.length > 0 && sessionStudents.length < (mode === 'MCQ' ? 32 : 28)) {
            const redistribution = handleLeftoverStudents(
              roomResults,
              sessionStudents,
              session,
              exam_date,
              exam_type,
              batchedInserts,
              courseNameMap,
              mode
            );

            roomResults = redistribution.updatedResults;
            batchedInserts = redistribution.updatedInserts;
            sessionStudents = redistribution.finalLeftover;
          }

          // Add any still unallocated students to global list
          if (sessionStudents.length > 0) {
            allUnallocatedStudents.push(...sessionStudents.map(s => ({
              regNo: s["Reg No."],
              name: s["Student Name"],
              course: s["COURSE CODE"],
              courseName: courseNameMap[s["COURSE CODE"]] || s["COURSE NAME"] || "",
              session: s["SESSION"] || session,
              time: s["Time"] || s["Exam Time"] || null
            })));
          }
        }
      }

      // Execute Batch Insert
      if (batchedInserts.length > 0) {
        const chunkSize = 1000;
        for (let i = 0; i < batchedInserts.length; i += chunkSize) {
          const chunk = batchedInserts.slice(i, i + chunkSize);
          await db.promise().query(
            \`INSERT INTO exam_allocation 
             (reg_no, student_name, course_code, course_name, session, room, seat_row, seat_column, exam_date, exam_type, exam_time, exam_mode) 
             VALUES ?\`,
            [chunk]
          );
        }
      }

      /* ---------- WARNINGS & REPORTING ---------- */
      await db.promise().query(\`
        CREATE TABLE IF NOT EXISTS allocation_warnings (\``;


if (content.indexOf(target) === -1) {
  console.log('Target not found! Try seeing diffs');
} else {
  content = content.replace(target, replacement);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Success Replaced Route');
}
