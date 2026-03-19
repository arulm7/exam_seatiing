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
   HELPER FUNCTIONS FOR SEATING ALLOCATION
   ====================================================== */

// Helper to get course group (first 5 chars)
const getCourseGroup = (courseCode) => {
  if (!courseCode) return "";
  return courseCode.substring(0, 5);
};

// Helper to check neighbor safety
const isSafeNeighbor = (allocatedSeats, row, col, courseGroup) => {
  // Check left neighbor (same row, col-1)
  const left = allocatedSeats.find(s => s.row === row && s.col === col - 1);
  if (left && getCourseGroup(left.course) === courseGroup) return false;

  // Check front neighbor (row-1, same col) - person in front
  const front = allocatedSeats.find(s => s.row === row - 1 && s.col === col);
  if (front && getCourseGroup(front.course) === courseGroup) return false;

  return true;
};

// Helper to validate course consistency (code and name must match)
const validateCourseConsistency = (courseGroups) => {
  const validatedGroups = {};

  for (const [courseCode, students] of Object.entries(courseGroups)) {
    // Group by course name to check consistency
    const nameGroups = {};
    students.forEach(student => {
      const courseName = student["COURSE NAME"] || "";
      if (!nameGroups[courseName]) nameGroups[courseName] = [];
      nameGroups[courseName].push(student);
    });

    // Find the most common course name for this course code
    let maxCount = 0;
    let dominantName = "";

    for (const [courseName, studentList] of Object.entries(nameGroups)) {
      if (studentList.length > maxCount) {
        maxCount = studentList.length;
        dominantName = courseName;
      }
    }

    // Only keep students with the dominant course name
    validatedGroups[courseCode] = nameGroups[dominantName] || [];

    // Log any inconsistencies
    if (Object.keys(nameGroups).length > 1) {
      console.warn(`Course code ${courseCode} has multiple names:`, Object.keys(nameGroups));
      console.warn(`Using dominant name: ${dominantName}`);
    }
  }

  return validatedGroups;
};

// Helper to find optimal course combination for 28-32 students with max 7-8 per course
const findOptimalCourseCombination = (courseGroups, targetStudents) => {
  const courses = Object.keys(courseGroups).sort((a, b) =>
    courseGroups[b].length - courseGroups[a].length
  );

  // Try to find 4 courses that can provide target students with max 8 per course
  for (let i = 0; i < courses.length - 3; i++) {
    const course1 = courses[i];
    const course2 = courses[i + 1];
    const course3 = courses[i + 2];
    const course4 = courses[i + 3];

    // Calculate how many students each course can provide (max 8)
    const available = [
      Math.min(courseGroups[course1].length, 8),
      Math.min(courseGroups[course2].length, 8),
      Math.min(courseGroups[course3].length, 8),
      Math.min(courseGroups[course4].length, 8)
    ];

    const totalAvailable = available.reduce((sum, count) => sum + count, 0);

    if (totalAvailable >= targetStudents) {
      // Distribute students optimally with max 8 per course
      const distribution = [
        { course: course1, count: 0, maxAllowed: available[0] },
        { course: course2, count: 0, maxAllowed: available[1] },
        { course: course3, count: 0, maxAllowed: available[2] },
        { course: course4, count: 0, maxAllowed: available[3] }
      ];

      let remaining = targetStudents;

      // For 28 students: try to give each course 7 students
      if (targetStudents === 28) {
        distribution.forEach((dist, idx) => {
          const allocation = Math.min(7, dist.maxAllowed, remaining);
          dist.count = allocation;
          remaining -= allocation;
        });

        // If we still have remaining, distribute evenly
        while (remaining > 0) {
          for (const dist of distribution) {
            if (remaining <= 0) break;
            if (dist.count < dist.maxAllowed && dist.count < 8) {
              dist.count++;
              remaining--;
            }
          }
        }
      }
      // For 30 students: 7,7,8,8 distribution
      else if (targetStudents === 30) {
        // First give each course at least 7 if possible
        distribution.forEach(dist => {
          const allocation = Math.min(7, dist.maxAllowed, 7);
          dist.count = allocation;
          remaining -= allocation;
        });

        // Then make two courses have 8 students
        let coursesAt8 = 0;
        for (const dist of distribution) {
          if (coursesAt8 < 2 && dist.count === 7 && dist.maxAllowed >= 8) {
            dist.count = 8;
            remaining--;
            coursesAt8++;
          }
        }

        // Distribute any remaining
        while (remaining > 0) {
          for (const dist of distribution) {
            if (remaining <= 0) break;
            if (dist.count < dist.maxAllowed && dist.count < 8) {
              dist.count++;
              remaining--;
            }
          }
        }
      }
      // For 32 students: try to give each course 8 students
      else if (targetStudents === 32) {
        distribution.forEach(dist => {
          const allocation = Math.min(8, dist.maxAllowed, remaining);
          dist.count = allocation;
          remaining -= allocation;
        });
      }
      // For other target numbers
      else {
        // Start with minimum allocation
        distribution.forEach(dist => {
          const minAllocation = Math.min(6, dist.maxAllowed, remaining);
          dist.count = minAllocation;
          remaining -= minAllocation;
        });

        // Distribute remaining
        while (remaining > 0) {
          for (const dist of distribution) {
            if (remaining <= 0) break;
            if (dist.count < dist.maxAllowed && dist.count < 8) {
              dist.count++;
              remaining--;
            }
          }
        }
      }

      // Validate that no course has more than 8 students
      distribution.forEach(dist => {
        if (dist.count > 8) {
          console.warn(`Course ${dist.course} has ${dist.count} students, reducing to 8`);
          dist.count = 8;
        }
      });

      // Calculate final total
      const finalTotal = distribution.reduce((sum, dist) => sum + dist.count, 0);

      if (finalTotal === targetStudents) {
        return distribution.map(({ course, count }) => ({ course, count }));
      }
    }
  }

  return null;
};

// Main room allocation function with conditions
const allocateRoomWithConditions = (roomName, capacity, students, session, exam_date, exam_type, courseNameMap, examMode = "NORMAL") => {
  const allocatedSeats = [];
  const columns = 4;
  const targetCapacity = examMode === "MCQ" ? 32 : 28;
  const rows = examMode === "MCQ" ? 8 : 7;
  capacity = Math.min(capacity, targetCapacity);
  const inserts = [];

  // Group students by course and validate consistency
  const courseGroups = {};
  students.forEach(student => {
    const courseCode = student["COURSE CODE"];
    if (!courseCode) return;
    if (!courseGroups[courseCode]) courseGroups[courseCode] = [];
    courseGroups[courseCode].push(student);

    // Update course name map
    if (student["COURSE NAME"] && !courseNameMap[courseCode]) {
      courseNameMap[courseCode] = student["COURSE NAME"];
    }
  });

  // Validate course consistency (code + name must match)
  const validatedGroupsTemp = validateCourseConsistency(courseGroups);

  // Replace courseCode with groupCode internally for allocation
  const validatedGroups = {};
  for (const [courseCode, studentsArr] of Object.entries(validatedGroupsTemp)) {
    const groupCode = getCourseGroup(courseCode);
    if (!validatedGroups[groupCode]) {
      validatedGroups[groupCode] = [];
    }
    validatedGroups[groupCode].push(...studentsArr);
  }

  // Determine target number of students for this room
  let targetStudents;
  const totalAvailable = Object.values(validatedGroups).reduce((sum, arr) => sum + arr.length, 0);

  if (examMode === "MCQ") {
    targetStudents = Math.min(totalAvailable, capacity, 32);
  } else {
    targetStudents = Math.min(totalAvailable, capacity, 28);
  }

  // Find optimal course combination
  const courseDistribution = findOptimalCourseCombination(validatedGroups, targetStudents);

  if (!courseDistribution) {
    // If can't find optimal combination, use whatever is available with max 8 per course
    const availableCourses = Object.keys(validatedGroups).sort((a, b) =>
      validatedGroups[b].length - validatedGroups[a].length
    );

    let remainingStudents = Math.min(targetStudents, totalAvailable);
    const tempDistribution = [];

    for (const course of availableCourses) {
      if (remainingStudents <= 0) break;
      // Max 8 students per course
      const toTake = Math.min(validatedGroups[course].length, 8, remainingStudents);
      tempDistribution.push({ course, count: toTake });
      remainingStudents -= toTake;
    }

    // Use temp distribution
    const studentsToAllocate = [];
    tempDistribution.forEach(dist => {
      const studentsFromCourse = validatedGroups[dist.course].splice(0, dist.count);
      studentsFromCourse.forEach(student => {
        studentsToAllocate.push({ ...student, assignedCourse: dist.course });
      });
    });

    // Allocate seats
    let studentIndex = 0;
    for (let i = 1; i <= rows && studentIndex < studentsToAllocate.length; i++) {
      for (let j = 1; j <= columns && studentIndex < studentsToAllocate.length; j++) {
        if (allocatedSeats.length >= capacity) break;

        // Find safe student
        let selectedStudent = null;
        let selectedIdx = -1;

        for (let k = studentIndex; k < studentsToAllocate.length; k++) {
          const student = studentsToAllocate[k];
          if (isSafeNeighbor(allocatedSeats, i, j, student.assignedCourse)) {
            selectedStudent = student;
            selectedIdx = k;
            break;
          }
        }

        if (!selectedStudent && studentIndex < studentsToAllocate.length) {
          selectedStudent = studentsToAllocate[studentIndex];
          selectedIdx = studentIndex;
        }

        if (selectedStudent) {
          studentsToAllocate.splice(selectedIdx, 1);

          const examTime = selectedStudent["Time"] || selectedStudent["Exam Time"] || selectedStudent["EXAM TIME"] || null;

          inserts.push([
            selectedStudent["Reg No."],
            selectedStudent["Student Name"],
            selectedStudent["COURSE CODE"],
            selectedStudent["COURSE NAME"] || courseNameMap[selectedStudent["COURSE CODE"]] || "",
            session,
            roomName,
            i,
            j,
            exam_date,
            exam_type,
            examTime,
            examMode
          ]);

          allocatedSeats.push({
            row: i,
            col: j,
            course: selectedStudent["COURSE CODE"],
            courseName: selectedStudent["COURSE NAME"] || courseNameMap[selectedStudent["COURSE CODE"]] || "",
            student: selectedStudent["Reg No."],
            session: session,
            time: examTime
          });
        }
      }
    }

    // Return remaining students
    const remaining = [];
    Object.keys(validatedGroups).forEach(course => {
      remaining.push(...validatedGroups[course]);
    });
    remaining.push(...studentsToAllocate);

    return { allocatedSeats, remainingStudents: remaining, inserts };
  }

  // Use the optimal course distribution
  const studentsToAllocate = [];
  courseDistribution.forEach(dist => {
    const studentsFromCourse = validatedGroups[dist.course].splice(0, dist.count);
    studentsFromCourse.forEach(student => {
      studentsToAllocate.push({ ...student, assignedCourse: dist.course });
    });
  });

  // Verify no course has more than 8 students
  const courseCounts = {};
  studentsToAllocate.forEach(student => {
    courseCounts[student.assignedCourse] = (courseCounts[student.assignedCourse] || 0) + 1;
  });

  for (const [course, count] of Object.entries(courseCounts)) {
    if (count > 8) {
      console.error(`ERROR: Course ${course} has ${count} students, exceeding maximum of 8`);
      // Remove excess students
      const excess = count - 8;
      for (let i = 0; i < excess; i++) {
        const index = studentsToAllocate.findIndex(s => s.assignedCourse === course);
        if (index !== -1) {
          validatedGroups[course].push(studentsToAllocate[index]);
          studentsToAllocate.splice(index, 1);
        }
      }
    }
  }

  // Shuffle students within their courses to mix them
  const shuffledStudents = [];
  const byCourse = {};
  studentsToAllocate.forEach(student => {
    if (!byCourse[student.assignedCourse]) byCourse[student.assignedCourse] = [];
    byCourse[student.assignedCourse].push(student);
  });

  // Interleave students from different courses
  const maxPerCourse = Math.max(...Object.values(byCourse).map(arr => arr.length));
  for (let i = 0; i < maxPerCourse; i++) {
    Object.keys(byCourse).forEach(course => {
      if (byCourse[course][i]) {
        shuffledStudents.push(byCourse[course][i]);
      }
    });
  }

  // Allocate seats with pattern
  const PATTERN_MATRIX = [
    [0, 1, 2, 3], [2, 3, 0, 1], [0, 1, 2, 3], [2, 3, 0, 1],
    [0, 1, 2, 3], [2, 3, 0, 1], [0, 1, 2, 3]
  ];

  let studentIndex = 0;
  for (let i = 1; i <= rows && studentIndex < shuffledStudents.length; i++) {
    for (let j = 1; j <= columns && studentIndex < shuffledStudents.length; j++) {
      if (allocatedSeats.length >= capacity) break;

      // Find safe student using pattern-based preference
      const patternIdx = PATTERN_MATRIX[(i - 1) % 7][(j - 1) % 4];
      const preferredCourses = courseDistribution.map(d => d.course);

      let selectedStudent = null;
      let selectedIdx = -1;

      // Try to match pattern
      for (let k = studentIndex; k < shuffledStudents.length; k++) {
        const student = shuffledStudents[k];
        const courseIndex = preferredCourses.indexOf(student.assignedCourse);
        if (courseIndex % 4 === patternIdx && isSafeNeighbor(allocatedSeats, i, j, student.assignedCourse)) {
          selectedStudent = student;
          selectedIdx = k;
          break;
        }
      }

      // Fallback: any safe student
      if (!selectedStudent) {
        for (let k = studentIndex; k < shuffledStudents.length; k++) {
          const student = shuffledStudents[k];
          if (isSafeNeighbor(allocatedSeats, i, j, student.assignedCourse)) {
            selectedStudent = student;
            selectedIdx = k;
            break;
          }
        }
      }

      // Last resort: take next student
      if (!selectedStudent && studentIndex < shuffledStudents.length) {
        selectedStudent = shuffledStudents[studentIndex];
        selectedIdx = studentIndex;
      }

      if (selectedStudent) {
        shuffledStudents.splice(selectedIdx, 1);

        const examTime = selectedStudent["Time"] || selectedStudent["Exam Time"] || selectedStudent["EXAM TIME"] || null;
        const courseName = selectedStudent["COURSE NAME"] || courseNameMap[selectedStudent["COURSE CODE"]] || "";

        inserts.push([
          selectedStudent["Reg No."],
          selectedStudent["Student Name"],
          selectedStudent["COURSE CODE"],
          courseName,
          session,
          roomName,
          i,
          j,
          exam_date,
          exam_type,
          examTime,
          examMode
        ]);

        allocatedSeats.push({
          row: i,
          col: j,
          course: selectedStudent["COURSE CODE"],
          courseName: courseName,
          student: selectedStudent["Reg No."],
          session: session,
          time: examTime
        });
      }
    }
  }

  // Return remaining students
  const remaining = [];
  Object.keys(validatedGroups).forEach(course => {
    remaining.push(...validatedGroups[course]);
  });
  remaining.push(...shuffledStudents);

  return { allocatedSeats, remainingStudents: remaining, inserts };
};

// Function to handle leftover students (Condition 2)
const handleLeftoverStudents = (roomResults, leftoverStudents, session, exam_date, exam_type, batchedInserts, courseNameMap, examMode = "NORMAL") => {
  const targetCapacity = examMode === "MCQ" ? 32 : 28;
  const targetPerCourse = examMode === "MCQ" ? 8 : 7;

  if (leftoverStudents.length === 0 || leftoverStudents.length >= targetCapacity) {
    return { updatedResults: roomResults, updatedInserts: batchedInserts, finalLeftover: leftoverStudents };
  }

  // Try to find rooms with exactly target capacity students that we can modify
  for (let i = 0; i < roomResults.length && leftoverStudents.length > 0; i++) {
    const room = roomResults[i];

    if (room.seats.length === targetCapacity) {
      // Count courses in this room using course groups
      const courseCounts = {};
      room.seats.forEach(seat => {
        const groupCode = getCourseGroup(seat.course);
        courseCounts[groupCode] = (courseCounts[groupCode] || 0) + 1;
      });

      // Find a course group with targetPerCourse students that doesn't match leftover students' course groups
      const leftoverGroups = new Set(leftoverStudents.map(s => getCourseGroup(s["COURSE CODE"])));
      const candidateGroup = Object.keys(courseCounts).find(groupCode =>
        courseCounts[groupCode] === targetPerCourse && !leftoverGroups.has(groupCode)
      );

      if (candidateGroup) {
        // Remove 4 students from this course group
        const seatsToRemove = [];
        const keptSeats = [];

        for (const seat of room.seats) {
          if (getCourseGroup(seat.course) === candidateGroup && seatsToRemove.length < 4) {
            seatsToRemove.push(seat);
          } else {
            keptSeats.push(seat);
          }
        }

        // Get the actual student objects for the removed seats
        const removedStudents = seatsToRemove.map(seat => {
          return {
            "Reg No.": seat.student,
            "Student Name": seat.studentName || "Unknown",
            "COURSE CODE": seat.course,
            "COURSE NAME": seat.courseName || "",
            "SESSION": session,
            "Time": seat.time || null
          };
        });

        // Combine leftover students with removed students
        const combinedStudents = [...leftoverStudents, ...removedStudents];

        // Try to reallocate this room with combined students
        const tempResult = allocateRoomWithConditions(
          room.roomNumber,
          room.totalSeats,
          combinedStudents,
          session,
          exam_date,
          exam_type,
          courseNameMap,
          examMode
        );

        if (tempResult.allocatedSeats.length >= keptSeats.length) {
          // Success - update the room
          room.seats = tempResult.allocatedSeats;
          room.totalSeats = tempResult.allocatedSeats.length;
          room.rows = Math.ceil(room.totalSeats / 4);

          // Remove old inserts for this room
          for (let j = batchedInserts.length - 1; j >= 0; j--) {
            if (batchedInserts[j][5] === room.roomNumber && batchedInserts[j][4] === session) {
              batchedInserts.splice(j, 1);
            }
          }

          // Add new inserts
          batchedInserts.push(...tempResult.inserts);

          // Update leftover students
          leftoverStudents = tempResult.remainingStudents;

          console.log(`Redistributed room ${room.roomNumber} to accommodate leftover students`);
        }
      }
    }
  }

  return { updatedResults: roomResults, updatedInserts: batchedInserts, finalLeftover: leftoverStudents };
};

/* ======================================================
   POST: GENERATE SEATING (Students + Class Room Excel)
   ====================================================== */
router.post(
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
                  console.error(`ERROR in room ${roomName} (${mode}): Course group ${groupCode} has ${count} students (max 8 allowed)`);
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
            `INSERT INTO exam_allocation 
             (reg_no, student_name, course_code, course_name, session, room, seat_row, seat_column, exam_date, exam_type, exam_time, exam_mode) 
             VALUES ?`,
            [chunk]
          );
        }
      }

      /* ---------- WARNINGS & REPORTING ---------- */
      await db.promise().query(`
        CREATE TABLE IF NOT EXISTS allocation_warnings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          type VARCHAR(50), message TEXT, details JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.promise().query("DELETE FROM allocation_warnings");

      const warnings = [];

      if (allUnallocatedStudents.length > 0) {
        const unByCourse = {};
        allUnallocatedStudents.forEach(s => {
          if (!unByCourse[s.course]) unByCourse[s.course] = [];
          unByCourse[s.course].push(s);
        });

        for (const code in unByCourse) {
          const list = unByCourse[code];
          const m = `${list.length} student(s) from ${code} could not be allocated due to room capacity or distribution constraints.`;
          const warningObj = {
            type: 'capacity_shortage',
            course: code,
            courseName: courseNameMap[code] || code,
            message: m,
            count: list.length,
            unallocatedList: list
          };
          warnings.push(warningObj);
          await db.promise().query(
            "INSERT INTO allocation_warnings (type, message, details) VALUES (?, ?, ?)",
            ['capacity_shortage', m, JSON.stringify(warningObj)]
          );
        }
      }

      const courseStatsList = Array.from(allCodes).map(c => ({
        courseCode: c,
        courseName: courseNameMap[c] || '',
        allocatedSeats: globalCourseStats[c] || 0,
        totalStudents: totalStudentsByCourse[c] || 0,
        unallocated: (totalStudentsByCourse[c] || 0) - (globalCourseStats[c] || 0)
      }));

      const summary = {
        totalStudents: totalAllocatedStudents,
        totalRooms: roomResults.length,
        totalCourses: allCodes.size,
        totalInputStudents: normalStudents.length + mcqStudents.length,
        unallocatedCount: allUnallocatedStudents.length,
        examType: exam_type,
        examDate: exam_date
      };

      res.json({
        status: warnings.length > 0 ? "success_with_warnings" : "success",
        message: warnings.length > 0 ? `Seating allocation completed with ${warnings.length} warning(s)` : "Seating allocation generated successfully",
        data: {
          summary,
          courseStats: courseStatsList,
          rooms: roomResults,
          warnings,
          unallocatedStudents: allUnallocatedStudents
        }
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
        exam_time,
        exam_mode
    FROM exam_allocation
    WHERE reg_no = ?`,
      [regno]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: "No seating found for this register number"
      });
    }

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
async function processSeatingData(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  const totalStudents = rows.length;
  const uniqueRooms = new Set(rows.map(r => r.room)).size;
  const uniqueCourses = new Set(rows.map(r => r.course_code)).size;
  const examDate = rows[0].exam_date;
  const examType = rows[0].exam_type;

  const courseStatsMap = {};
  rows.forEach(r => {
    if (!courseStatsMap[r.course_code]) {
      courseStatsMap[r.course_code] = { courseCode: r.course_code, courseName: r.course_name, allocatedSeats: 0 };
    }
    courseStatsMap[r.course_code].allocatedSeats++;
  });
  const courseStats = Object.values(courseStatsMap);

  const roomsMap = {};
  rows.forEach(row => {
    const examMode = row.exam_mode || 'NORMAL';
    const key = `${row.room}|${row.session}|${examMode}`;

    if (!roomsMap[key]) {
      roomsMap[key] = {
        roomNumber: row.room,
        session: row.session,
        seats: [],
        maxRow: 0,
        maxCol: 0,
        examMode: row.exam_mode || 'NORMAL'
      };
    }
    roomsMap[key].seats.push({
      row: row.seat_row,
      col: row.seat_column,
      course: row.course_code,
      courseName: row.course_name,
      student: row.reg_no,
      session: row.session,
      time: row.exam_time
    });
    if (row.seat_row > roomsMap[key].maxRow) roomsMap[key].maxRow = row.seat_row;
    if (row.seat_column > roomsMap[key].maxCol) roomsMap[key].maxCol = row.seat_column;
  });

  const rooms = Object.values(roomsMap).map(r => {
    const isMCQ = r.examMode === 'MCQ';
    const forcedCapacity = isMCQ ? 32 : 28;
    const forcedRows = isMCQ ? 8 : 7;
    const forcedCols = 4;
    const finalRows = Math.max(r.maxRow, forcedRows);
    const finalCols = Math.max(r.maxCol, forcedCols);
    const finalCapacity = Math.max(r.seats.length, finalRows * finalCols);

    const rawSession = r.session || 'FN';

    let mappedSession = 'FN';
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
      session: mappedSession,
      displaySession: displaySession,
      originalRoom: r.roomNumber,
      examMode: r.examMode
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
    const [latest] = await db.promise().query("SELECT exam_date, exam_type FROM exam_allocation ORDER BY exam_date DESC LIMIT 1");

    if (latest.length === 0) {
      return res.json({ hasData: false });
    }

    const { exam_date, exam_type } = latest[0];
    const dateObj = new Date(exam_date);
    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

    const [rows] = await db.promise().query(
      "SELECT * FROM exam_allocation WHERE exam_date = ? AND exam_type = ?",
      [dateStr, exam_type]
    );

    const processed = await processSeatingData(rows);

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

    const [rows] = await db.promise().query(
      "SELECT COUNT(*) as count FROM exam_allocation WHERE exam_date = ? AND exam_type = ?",
      [date, type]
    );

    if (rows[0].count === 0) {
      return res.status(404).json({
        message: "No seating plan found for the specified date and exam type"
      });
    }

    await db.promise().query(
      "DELETE FROM exam_allocation WHERE exam_date = ? AND exam_type = ?",
      [date, type]
    );

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
