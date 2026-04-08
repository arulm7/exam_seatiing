import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Upload, FileSpreadsheet, Users, Download, Printer, LayoutDashboard, Eye, List, Trash2, Calendar, Sun, Sunset, Filter, GraduationCap, FileText, PenTool, Pencil, Check, X } from 'lucide-react';
import { generateSeatingPlan, fetchCurrentSeating, clearSeatingPlan, searchSeatingPlan, updateRoomNumber } from '../services/api';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface UploadStatus {
    students: 'ready' | 'uploaded' | 'error';
    mcqStudents: 'ready' | 'uploaded' | 'error';
    rooms: 'ready' | 'uploaded' | 'error';
    mcqRooms: 'ready' | 'uploaded' | 'error';
    examDate: 'ready' | 'set' | 'error';
}

interface SummaryStats {
    totalStudents: number;
    totalRooms: number;
    totalCourses: number;
    totalInputStudents?: number;
    unallocatedCount?: number;
    utilizationRate?: number;
    examType?: string;
    examDate?: string;
}

interface CourseStats {
    courseCode: string;
    courseName: string;
    allocatedSeats: number;
    totalStudents?: number;
    unallocated?: number;
}

interface Seat {
    row: number;
    col: number;
    course: string;
    student?: string;
    session?: string;
    time?: string;
}

interface Room {
    roomNumber: string;
    totalSeats: number;
    rows: number;
    columns: number;
    seats: Seat[];
    session?: string;
    displaySession?: string;
    originalRoom?: string;
    examMode?: string;
}

// 7 ROWS × 4 COLUMNS (28 seats)


// Helper to generate consistent colors
const generateCourseStyle = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return {
        backgroundColor: `hsl(${h}, 85%, 94%)`,
        color: `hsl(${h}, 90%, 20%)`,
        borderColor: `hsl(${h}, 70%, 80%)`
    };
};

type Tab = 'create' | 'courses' | 'preview' | 'history';

export function AdminDashboard() {
    const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
        students: 'ready',
        mcqStudents: 'ready',
        rooms: 'ready',
        mcqRooms: 'ready',
        examDate: 'ready',
    });
    const [examDate, setExamDate] = useState<string>('');
    const [studentFile, setStudentFile] = useState<File | null>(null);
    const [mcqStudentFile, setMcqStudentFile] = useState<File | null>(null);
    const [roomFile, setRoomFile] = useState<File | null>(null);
    const [mcqRoomFile, setMcqRoomFile] = useState<File | null>(null);
    const [seatingGenerated, setSeatingGenerated] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const [courseStats, setCourseStats] = useState<CourseStats[]>([]);
    const [summary, setSummary] = useState<SummaryStats>({
        totalStudents: 0,
        totalRooms: 0,
        totalCourses: 0,
    });
    const [rooms, setRooms] = useState<Room[]>([]);
    const [activeTab, setActiveTab] = useState<Tab>('create');
    const [warnings, setWarnings] = useState<any[]>([]);
    const [unallocatedStudents, setUnallocatedStudents] = useState<any[]>([]);
    const [clearedMessage, setClearedMessage] = useState<string>('');
    const [examType, setExamType] = useState<string>('');
    const [sessionFilter, setSessionFilter] = useState<'ALL' | 'FN' | 'AN' | '1' | '2' | '3' | '4'>('ALL');
    const [examModeFilter, setExamModeFilter] = useState<'ALL' | 'NORMAL' | 'MCQ'>('ALL');
    const [breakdownModeFilter, setBreakdownModeFilter] = useState<'ALL' | 'NORMAL' | 'MCQ'>('ALL');

    // Helper to filter rooms based on session
    const isRoomInSession = (room: Room, filter: string) => {
        if (filter === 'ALL') return true;
        if (filter === 'FN') return room.session === 'FN'; // Matches FN (Session 1) and FN (Session 2) because backend sets session='FN'
        if (filter === 'AN') return room.session === 'AN';

        // Detailed checks using displaySession
        // room.displaySession example: "FN (Session 1)"
        if (filter === '1') return room.displaySession ? room.displaySession.includes('Session 1') : false;
        if (filter === '2') return room.displaySession ? room.displaySession.includes('Session 2') : false;
        if (filter === '3') return room.displaySession ? room.displaySession.includes('Session 3') : false;
        if (filter === '4') return room.displaySession ? room.displaySession.includes('Session 4') : false;

        return false;
    };

    const [selectedExamCategory, setSelectedExamCategory] = useState<'university' | 'model' | 'other'>('university');
    const [deleteDate, setDeleteDate] = useState('');
    const [deleteType, setDeleteType] = useState('University Examination');
    const [deleteCategory, setDeleteCategory] = useState<'university' | 'model' | 'other'>('university');

    // Search State
    const [searchDate, setSearchDate] = useState('');
    const [searchType, setSearchType] = useState('University Examination');
    const [searchCategory, setSearchCategory] = useState<'university' | 'model' | 'other'>('university');
    const [searchResult, setSearchResult] = useState<string | null>(null);
    const [isInitialLoading, setIsInitialLoading] = useState(true);

    // Edit Room State
    const [editingRoom, setEditingRoom] = useState<string | null>(null);
    const [tempRoomName, setTempRoomName] = useState<string>('');

    const handleUpdateRoom = async (oldRoomNumber: string, session?: string, examMode?: string) => {
        if (!tempRoomName || !tempRoomName.trim()) {
            toast.error("Room number cannot be empty");
            return;
        }

        const roomToUpdate = rooms.find(r => 
            r.roomNumber === oldRoomNumber && 
            r.session === session && 
            (r.examMode || 'NORMAL') === (examMode || 'NORMAL')
        );

        if (tempRoomName === oldRoomNumber) {
            setEditingRoom(null);
            return;
        }

        try {
            setLoading(true);
            // We pass the displaySession (e.g. "FN (Session 1)") and examMode to the backend so it only updates those specific records
            await updateRoomNumber(oldRoomNumber, tempRoomName, examDate, examType, session, examMode);
            
            // Update local state ONLY for that specific room/session/mode combination
            setRooms(prevRooms => prevRooms.map(room => {
                const roomSession = room.displaySession || room.session;
                if (room.roomNumber === oldRoomNumber && 
                    roomSession === session && 
                    (room.examMode || 'NORMAL') === (examMode || 'NORMAL')) {
                    return { ...room, roomNumber: tempRoomName };
                }
                return room;
            }));

            toast.success(`Room renamed to ${tempRoomName}`);
            setEditingRoom(null);
        } catch (err: any) {
            toast.error(err.message || "Failed to update room number");
        } finally {
            setLoading(false);
        }
    };


    // Initialize default exam type
    useEffect(() => {
        if (!seatingGenerated) {
            setExamType('University Examination');
        }
    }, []);

    // Fetch current seating on mount
    useEffect(() => {
        checkCurrentSeating();
    }, []);

    // ... (keeping other lines same)


    const checkCurrentSeating = async () => {
        try {
            setIsInitialLoading(true);
            const result = await fetchCurrentSeating();
            if (result.hasData && result.data) {
                setCourseStats(result.data.courseStats as CourseStats[]);
                setRooms(result.data.rooms as Room[]);
                setSummary(result.data.summary);
                setWarnings(result.data.warnings || []);
                setUnallocatedStudents(result.data.unallocatedStudents || []);
                setSeatingGenerated(true);
                if (result.data.summary.examType) {
                    setExamType(result.data.summary.examType);
                }
                if (result.data.summary.examDate) {
                    const dateObj = new Date(result.data.summary.examDate);
                    const year = dateObj.getFullYear();
                    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const day = String(dateObj.getDate()).padStart(2, '0');
                    const formattedDate = `${year}-${month}-${day}`;
                    setExamDate(formattedDate);
                    setUploadStatus(prev => ({ ...prev, examDate: 'set' }));
                }
                // Auto-switch to breakdown tab if data exists to show the allocations immediately
                setActiveTab('courses');
            }
        } catch (err) {
            console.error("Failed to load current seating", err);
        } finally {
            setIsInitialLoading(false);
        }
    };

    const handleSearchSeating = async () => {
        if (!searchDate || !searchType) {
            toast.error("Please enter both date and exam type");
            return;
        }

        setLoading(true);
        setSearchResult(null);
        try {
            const result = await searchSeatingPlan(searchDate, searchType);
            if (result.found && result.data) {
                setCourseStats(result.data.courseStats as CourseStats[]);
                setRooms(result.data.rooms as Room[]);
                setSummary(result.data.summary);
                setWarnings(result.data.warnings || []);
                setUnallocatedStudents(result.data.unallocatedStudents || []);
                setSeatingGenerated(true);
                setExamDate(searchDate); // Update display context
                setExamType(searchType);
                setActiveTab('courses'); // Switch to view
                toast.success("Seating plan loaded");
            } else {
                setSearchResult("No exam scheduled on that day for the given type.");
                toast.info("No exam scheduled on that day");
                // Optionally clear view if search failed? 
                // For now, let's just show the message.
            }
        } catch (err: any) {
            setError("Search failed: " + err.message);
            toast.error("Search failed");
        } finally {
            setLoading(false);
        }
    };

    const handleExamDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const date = e.target.value;
        setExamDate(date);
        if (date) {
            setUploadStatus(prev => ({ ...prev, examDate: 'set' }));
            setError('');
        }
    };

    const handleStudentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.match(/\.(xlsx|xls)$/i)) {
                setUploadStatus(prev => ({ ...prev, students: 'error' }));
                setError('Student file must be Excel format (.xlsx or .xls)');
                return;
            }
            setStudentFile(file);
            setUploadStatus(prev => ({ ...prev, students: 'uploaded' }));
            setError('');
        }
    };

    const handleRoomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.match(/\.(xlsx|xls)$/i)) {
                setUploadStatus(prev => ({ ...prev, rooms: 'error' }));
                setError('Room file must be Excel format (.xlsx or .xls)');
                return;
            }
            setRoomFile(file);
            setUploadStatus(prev => ({ ...prev, rooms: 'uploaded' }));
            setError('');
        }
    };

    const handleMcqStudentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.match(/\.(xlsx|xls)$/i)) {
                setUploadStatus(prev => ({ ...prev, mcqStudents: 'error' }));
                setError('MCQ Student file must be Excel format (.xlsx or .xls)');
                return;
            }
            setMcqStudentFile(file);
            setUploadStatus(prev => ({ ...prev, mcqStudents: 'uploaded' }));
            setError('');
        }
    };

    const handleMcqRoomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.match(/\.(xlsx|xls)$/i)) {
                setUploadStatus(prev => ({ ...prev, mcqRooms: 'error' }));
                setError('MCQ Room file must be Excel format (.xlsx or .xls)');
                return;
            }
            setMcqRoomFile(file);
            setUploadStatus(prev => ({ ...prev, mcqRooms: 'uploaded' }));
            setError('');
        }
    };

    const generateSeating = async () => {
        if (!examDate || !examType || (!studentFile && !mcqStudentFile) || (!roomFile && !mcqRoomFile)) {
            setError('Please fill all required fields and provide at least one set of files (NORMAL or MCQ)');
            return;
        }

        // Check if a seating plan exists for this specific exam date and type
        try {
            const existingPlan = await searchSeatingPlan(examDate, examType);
            if (existingPlan.found) {
                const confirmMessage = `A seating plan already exists for ${examType} on ${new Date(examDate).toLocaleDateString('en-IN')}.\n\nGenerating a new plan will REPLACE the existing plan for this specific date and exam type.\n\nOther exam plans will remain intact.\n\nDo you want to proceed?`;
                if (!window.confirm(confirmMessage)) {
                    return;
                }
            }
        } catch (err) {
            console.error('Error checking existing plan:', err);
            // Continue with generation even if check fails
        }

        setLoading(true);
        setError('');
        setWarnings([]);
        setUnallocatedStudents([]);

        try {
            const formData = new FormData();
            formData.append('exam_date', examDate);
            formData.append('exam_type', examType);
            if (studentFile) formData.append('normal_students', studentFile);
            if (roomFile) formData.append('normal_rooms', roomFile);
            if (mcqStudentFile) formData.append('mcq_students', mcqStudentFile);
            if (mcqRoomFile) formData.append('mcq_rooms', mcqRoomFile);

            const response = await generateSeatingPlan(formData);

            setCourseStats(response.data.courseStats as CourseStats[]);
            setRooms(response.data.rooms as Room[]);
            setSummary(response.data.summary);
            setWarnings(response.data.warnings || []);
            setUnallocatedStudents(response.data.unallocatedStudents || []);
            setSeatingGenerated(true);
            setActiveTab('courses');
            toast.success('Seating plan generated successfully!');
        } catch (err: any) {
            setError(err.message || 'Failed to generate seating plan');
            toast.error('Generation failed: ' + (err.message || 'Unknown error'));
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleClearSeating = async () => {
        if (!deleteDate || !deleteType) {
            toast.error('Please enter both Exam Date and Exam Type to delete');
            return;
        }

        const formattedDate = new Date(deleteDate).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        const confirmMessage = `Are you sure you want to COMPLETELY DELETE the seating plan for:\n\n${deleteType}\nDate: ${formattedDate}\n\nThis action is PERMANENT and cannot be undone. All student allocations for this specific exam will be removed.`;

        if (!window.confirm(confirmMessage)) {
            return;
        }

        setLoading(true);
        setError('');
        try {
            const result = await clearSeatingPlan(deleteDate, deleteType);

            // Reset delete inputs
            setDeleteDate('');
            setDeleteType('');

            // If the deleted plan was the one currently being viewed, clear the view
            if (summary.examDate === deleteDate && summary.examType === deleteType) {
                setSeatingGenerated(false);
                setCourseStats([]);
                setRooms([]);
                setSummary({ totalStudents: 0, totalRooms: 0, totalCourses: 0 });
                setWarnings([]);
                setUnallocatedStudents([]);
                setUploadStatus({
                    students: 'ready',
                    mcqStudents: 'ready',
                    rooms: 'ready',
                    mcqRooms: 'ready',
                    examDate: 'ready',
                });
                setExamDate('');
                setExamType('');
            }

            toast.success(`Deleted ${result.deletedCount} allocation(s) for ${deleteType} on ${formattedDate}`);

            // Check if there are other seating plans available to show
            checkCurrentSeating();
        } catch (err: any) {
            setError(err.message || 'Failed to delete seating data');
            toast.error(err.message || 'Failed to delete seating plan');
        } finally {
            setLoading(false);
        }
    };

    const getExportData = () => {
        const headers = ['S.No', 'Course Code', 'Course Name', 'Exam Mode', 'Total', 'Allocated', 'Unallocated', 'Room Breakdown'];
        
        const filteredRooms = rooms.filter(r => {
            const modeMatch = breakdownModeFilter === 'ALL' ? true : breakdownModeFilter === 'MCQ' ? r.examMode === 'MCQ' : (r.examMode || 'NORMAL') === 'NORMAL';
            const sessionMatch = isRoomInSession(r, sessionFilter);
            return modeMatch && sessionMatch;
        });

        const rows = courseStats.filter((course) => {
            return filteredRooms.some(r => r.seats.some(s => s.course === course.courseCode));
        }).map((course, index) => {
            const courseRooms: string[] = [];
            let examMode = 'DESCRIPTIVE';
            let allocatedInFiltered = 0;

            filteredRooms.forEach(r => {
                const count = r.seats.filter(s => s.course === course.courseCode).length;
                if (count > 0) {
                    courseRooms.push(`${r.roomNumber} (${count})`);
                    if (r.examMode) examMode = r.examMode === 'NORMAL' ? 'DESCRIPTIVE' : r.examMode;
                    allocatedInFiltered += count;
                }
            });

            return [
                (index + 1).toString(),
                course.courseCode,
                course.courseName,
                examMode,
                (course.totalStudents || 0).toString(),
                allocatedInFiltered.toString(),
                ((course.totalStudents || course.allocatedSeats || 0) - allocatedInFiltered).toString(),
                courseRooms.join(', ')
            ];
        });
        return { headers, rows };
    };

    const handleDownloadPDF = () => {
        const doc = new jsPDF();
        const { headers, rows } = getExportData();

        // SIMATS banner_1
        doc.addImage('/banner_1.png', 'PNG', 10, 5, 190, 30);

        // Enhanced PDF Header
        const title = summary.examType || 'University Exam Seating Plan';
        doc.setFontSize(22);
        doc.setTextColor(30, 27, 75); // Indigo-950
        doc.text(title, 105, 45, { align: 'center' });

        doc.setFontSize(14);
        doc.setTextColor(79, 70, 229); // Indigo-600
        doc.text('Allocated Courses Summary', 105, 53, { align: 'center' });

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Date: ${new Date(examDate).toLocaleDateString('en-IN')} | Total Students: ${summary.totalStudents} | Total Rooms: ${summary.totalRooms}`, 105, 60, { align: 'center' });

        autoTable(doc, {
            head: [headers],
            body: rows,
            startY: 70,
            styles: { fontSize: 9, cellPadding: 3, halign: 'center' },
            headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [249, 250, 251] },
            theme: 'grid'
        });

        // Add Warnings if any
        if (warnings && warnings.length > 0) {
            doc.addPage();
            doc.addImage('/banner_1_1.png', 'PNG', 10, 5, 190, 30);
            
            doc.setFontSize(16);
            doc.setTextColor(180, 83, 9); // Amber-700
            doc.text('Allocation Warnings', 14, 45);

            let currentY = 55;
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            warnings.forEach(w => {
                doc.text(`• ${w.message}`, 14, currentY, { maxWidth: 180 });
                currentY += 12;
            });
        }

        // Add Unallocated Students if any
        if (unallocatedStudents && unallocatedStudents.length > 0) {
            doc.addPage();
            doc.addImage('/banner_1.png', 'PNG', 10, 5, 190, 30);
            
            doc.setFontSize(16);
            doc.setTextColor(220, 38, 38); // Red-600
            doc.text('Unallocated Students', 14, 45);

            const unallocatedHeaders = [['Reg No', 'Name', 'Course', 'Session']];
            const unallocatedRows = unallocatedStudents.map(s => [s.regNo, s.name, s.course, s.session]);

            autoTable(doc, {
                head: unallocatedHeaders,
                body: unallocatedRows,
                startY: 55,
                styles: { fontSize: 9 },
                headStyles: { fillColor: [220, 38, 38] }
            });
        }

        doc.save(`seating-plan-summary-${examDate}.pdf`);
    };

    const handleExportExcel = () => {
        const { headers, rows } = getExportData();
        const wb = XLSX.utils.book_new();

        // Summary Header for Excel
        const title = summary.examType || 'University Exam Seating Plan';
        const headerData = [
            [title],
            ['Allocated Courses Summary'],
            [`Date: ${new Date(examDate).toLocaleDateString('en-IN')}`],
            [],
            headers
        ];

        const wsData = [...headerData, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Merge title cells
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } }
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Allocated Summary");

        // Unallocated Students Sheet if any
        if (unallocatedStudents && unallocatedStudents.length > 0) {
            const unHeaders = ['Reg No', 'Name', 'Course', 'Session'];
            const unRows = unallocatedStudents.map(s => [s.regNo, s.name, s.course, s.session]);
            const unWs = XLSX.utils.aoa_to_sheet([unHeaders, ...unRows]);
            XLSX.utils.book_append_sheet(wb, unWs, "Unallocated Students");
        }

        // Warnings Sheet
        if (warnings && warnings.length > 0) {
            const wData = [['Type', 'Message'], ...warnings.map(w => [w.type, w.message])];
            const wWs = XLSX.utils.aoa_to_sheet(wData);
            XLSX.utils.book_append_sheet(wb, wWs, "Warnings");
        }

        XLSX.writeFile(wb, `seating-plan-summary-${examDate}.xlsx`);
    };

    const handlePrintView = () => {
        const { headers, rows } = getExportData();

        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${summary.examType || 'Seating Plan'}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #1f2937; }
            .summary-header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #4f46e5; padding-bottom: 20px; }
            .summary-header h1 { margin: 0; font-size: 28px; color: #1e1b4b; text-transform: uppercase; letter-spacing: 1px; }
            .summary-header h2 { margin: 10px 0; font-size: 20px; color: #4f46e5; font-weight: 600; }
            .summary-header p { margin: 5px 0; color: #6b7280; font-size: 14px; }
            h3 { color: #4338ca; border-bottom: 2px solid #e0e7ff; padding-bottom: 8px; margin-top: 30px; font-size: 18px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 20px; background: white; }
            th, td { border: 1px solid #e2e8f0; padding: 12px 8px; text-align: center; }
            th { background-color: #f8fafc; font-weight: bold; color: #334155; text-transform: uppercase; font-size: 10px; }
            tr:nth-child(even) { background-color: #fcfcfd; }
            .warning { color: #b45309; background: #fffbeb; padding: 12px; border: 1px solid #fde68a; border-radius: 8px; margin-bottom: 10px; font-size: 12px; }
            .unallocated { color: #b91c1c; font-weight: bold; }
            @media print { body { padding: 0; } .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="/banner_1.png" style="width: 100%; max-width: 800px; height: auto;">
          </div>
          <div class="summary-header">
            <h1>${summary.examType || 'University Exam Seating Plan'}</h1>
            <h2 style="color: #4f46e5; margin-top: -10px;">Allocated Courses Summary</h2>
            <p style="text-align:center; font-size: 14px; color: #6b7280;">
              Date: <strong>${new Date(examDate).toLocaleDateString('en-IN')}</strong> | 
              Total Students: <strong>${summary.totalStudents}</strong> | 
              Total Rooms: <strong>${summary.totalRooms}</strong>
            </p>
          </div>
          
          <table>
            <thead><tr>${headers.map((h: string) => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((row: string[]) => `<tr>${row.map((cell: string) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>

          ${warnings.length > 0 ? `
            <h3>Allocation Warnings</h3>
            ${warnings.map(w => `<div class="warning">${w.message}</div>`).join('')}
          ` : ''}

          ${unallocatedStudents.length > 0 ? `
            <h3 class="unallocated">Unallocated Students</h3>
            <table>
              <thead>
                <tr>
                  <th>Reg No</th>
                  <th>Student Name</th>
                  <th>Course</th>
                  <th>Session</th>
                </tr>
              </thead>
              <tbody>
                ${unallocatedStudents.map(s => `
                  <tr>
                    <td>${s.regNo}</td>
                    <td>${s.name}</td>
                    <td>${s.course}</td>
                    <td>${s.session}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : ''}

          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `;

        printWindow.document.write(htmlContent);
        printWindow.document.close();
    };




    const handlePreviewDownloadPDF = () => {
        try {
            const doc = new jsPDF();
            const startY = 40;

            rooms
                .filter(room => {
                    const sessionMatch = isRoomInSession(room, sessionFilter);
                    const modeMatch = examModeFilter === 'ALL' ? true : examModeFilter === 'MCQ' ? room.examMode === 'MCQ' : (room.examMode || 'NORMAL') === 'NORMAL';
                    return sessionMatch && modeMatch;
                })
                .forEach((room, index) => {
                    if (index > 0) doc.addPage();

                    // ADD banner_1
                    doc.addImage('/banner_1.png', 'PNG', 10, 2, 190, 25); // Smaller and higher

                    // Helper to get Exam Time
                    const examTime = room.seats.find(s => s.time)?.time || 'N/A';

                    // DEPARTMENT HEADER
                    doc.setFontSize(10);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(0, 0, 0);
                    doc.text('DEPARTMENT OF CONTROLLER OF EXAMINATIONS', 105, 31, { align: 'center' }); 
                    doc.line(70, 32, 140, 32); // Underline

                    // Exam Type
                    doc.setFontSize(11); // Slightly smaller
                    doc.setTextColor(79, 70, 229); // indigo-600
                    doc.text((summary.examType || 'University Examination').toUpperCase(), 105, 38, { align: 'center' });                    // Info Box (Room, Session, Date, Time)
                    doc.setFillColor(249, 250, 251); 
                    doc.setDrawColor(229, 231, 235); 
                    doc.roundedRect(20, 42, 170, 13, 2, 2, 'FD'); // Shorter box (16 -> 13)

                    doc.setFontSize(8); // Smaller labels
                    doc.setTextColor(107, 114, 128); 
                    doc.text('ROOM NUMBER', 35, 46, { align: 'center' });
                    doc.text('SESSION', 80, 46, { align: 'center' });
                    doc.text('DATE', 125, 46, { align: 'center' });
                    doc.text('TIME', 165, 46, { align: 'center' });

                    doc.setFontSize(10); // Smaller values
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(17, 24, 39); 
                    doc.text(room.roomNumber, 35, 52, { align: 'center' });
;

                    // Clean up session text for PDF
                    const sessionText = room.displaySession ? room.displaySession.replace(/[()]/g, '') : (room.session || 'N/A');
                    doc.text(sessionText, 80, 52, { align: 'center' });

                    doc.text(new Date(examDate).toLocaleDateString('en-IN'), 125, 52, { align: 'center' });
                    doc.text(examTime, 165, 52, { align: 'center' });

                    // Separators
                    doc.setDrawColor(209, 213, 219);
                    doc.line(55, 42, 55, 55);
                    doc.line(100, 42, 100, 55);
                    doc.line(145, 42, 145, 55);

                    // Meta Info
                    doc.setFontSize(8);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(55, 65, 81);
                    doc.text(`Capacity: ${room.totalSeats}   |   Allocated: ${room.seats.length}`, 105, 59, { align: 'center' });

                    // Horizontal Line (removed, layout flows into grid)

                    // Dynamic Scaling to fit any room size on a single A4 page
                    const labelWidth = 10; // Space for row labels
                    const labelHeight = 8; // Space for column labels
                    const availableWidth = 170 - labelWidth;
                    const availableHeight = 150 - labelHeight; // Significantly reduced (180 -> 150)
                    const currentGap = room.rows > 10 || room.columns > 6 ? 2 : 3;

                    const calcBoxWidth = (availableWidth - (room.columns - 1) * currentGap) / room.columns;
                    const calcBoxHeight = (availableHeight - (room.rows - 1) * currentGap) / room.rows;

                    // Cap sizes for aesthetic reasons
                    const finalBoxWidth = Math.min(calcBoxWidth, 38);
                    const finalBoxHeight = Math.min(calcBoxHeight, 28);

                    // Center the grid
                    const gridWidth = room.columns * finalBoxWidth + (room.columns - 1) * currentGap;
                    const gridHeight = room.rows * finalBoxHeight + (room.rows - 1) * currentGap;
                    const currentStartX = (210 - gridWidth - labelWidth) / 2 + labelWidth;
                    const currentStartY = 68; // Shifted up (85 -> 68)

                    // Draw Column Labels
                    doc.setFontSize(8);
                    doc.setTextColor(100, 100, 100);
                    doc.setFont('helvetica', 'bold');
                    for (let c = 1; c <= room.columns; c++) {
                        const x = currentStartX + (c - 1) * (finalBoxWidth + currentGap);
                        doc.text(`Col ${c}`, x + finalBoxWidth / 2, 68 - 2, { align: 'center' });
                    }

                    // Draw seats with row labels
                    for (let r = 1; r <= room.rows; r++) {
                        const y = currentStartY + (r - 1) * (finalBoxHeight + currentGap);

                        // Draw Row Label
                        doc.setFontSize(8);
                        doc.setTextColor(100, 100, 100);
                        doc.setFont('helvetica', 'bold');
                        doc.text(`Row ${r}`, currentStartX - 8, y + finalBoxHeight / 2, { align: 'center' });

                        for (let c = 1; c <= room.columns; c++) {
                            const seat = room.seats.find(s => s.row === r && s.col === c);
                            const x = currentStartX + (c - 1) * (finalBoxWidth + currentGap);

                            // Draw Box
                            if (seat) {
                                doc.setFillColor(243, 244, 246);
                                doc.rect(x, y, finalBoxWidth, finalBoxHeight, 'F');
                                doc.setDrawColor(209, 213, 219);
                                doc.rect(x, y, finalBoxWidth, finalBoxHeight, 'S');

                                // Responsive text sizing
                                const nameFontSize = finalBoxHeight < 15 ? 8 : 11;
                                const courseFontSize = finalBoxHeight < 15 ? 6 : 8;

                                doc.setFont('helvetica', 'bold');
                                doc.setFontSize(nameFontSize);
                                doc.setTextColor(17, 24, 39);
                                doc.text(seat.student || '', x + finalBoxWidth / 2, y + (finalBoxHeight * 0.4), { align: 'center', maxWidth: finalBoxWidth - 2 });

                                doc.setFont('helvetica', 'normal');
                                doc.setFontSize(courseFontSize);
                                doc.setTextColor(79, 70, 229);
                                doc.text(seat.course, x + finalBoxWidth / 2, y + (finalBoxHeight * 0.75), { align: 'center', maxWidth: finalBoxWidth - 2 });


                            } else {
                                doc.setDrawColor(229, 231, 235);
                                doc.rect(x, y, finalBoxWidth, finalBoxHeight, 'S');
                                doc.setFontSize(finalBoxHeight < 15 ? 5 : 7);
                                doc.setTextColor(209, 213, 219);
                                doc.text('Empty', x + finalBoxWidth / 2, y + finalBoxHeight / 2, { align: 'center' });
                            }
                        }
                    }

                    // Add Course Breakdown Section - Tabular Format
                    const breakdownStartY = currentStartY + gridHeight + 15;

                    doc.setFontSize(11);
                    doc.setTextColor(30, 27, 75);
                    doc.setFont('helvetica', 'bold');
                    doc.text('Course Breakdown', 20, breakdownStartY - 4);

                    // Table Constants
                    const tStartY = breakdownStartY;
                    const rowHeight = 7;
                    const col1W = 40;  // Course Code
                    const col3W = 30;  // Students
                    const col2W = 170 - col1W - col3W; // Course Name (~100)

                    // Header Background
                    doc.setFillColor(243, 244, 246);
                    doc.rect(20, tStartY, 170, rowHeight, 'F');
                    doc.setDrawColor(209, 213, 219);
                    doc.rect(20, tStartY, 170, rowHeight, 'S'); // Header Border

                    // Header Text
                    doc.setFontSize(9);
                    doc.setTextColor(17, 24, 39);
                    doc.text('Course Code', 25, tStartY + 5);
                    doc.text('Course Name', 25 + col1W, tStartY + 5);
                    doc.text('Students', 20 + col1W + col2W + (col3W / 2), tStartY + 5, { align: 'center' });

                    // Header Vertical Lines
                    doc.line(20 + col1W, tStartY, 20 + col1W, tStartY + rowHeight);
                    doc.line(20 + col1W + col2W, tStartY, 20 + col1W + col2W, tStartY + rowHeight);

                    // Rows
                    const uniqueCourses = Array.from(new Set(room.seats.map(s => s.course))).sort();

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(9);
                    doc.setTextColor(55, 65, 81);

                    let currentY = tStartY + rowHeight;

                    uniqueCourses.forEach((code, index) => {
                        // Skip if we run out of space (basic check)
                        if (currentY > 285) return;

                        const count = room.seats.filter(s => s.course === code).length;
                        const courseInfo = courseStats.find((c: any) => c.courseCode === code);
                        const name = courseInfo ? courseInfo.courseName : '';
                        const displayName = name.length > 55 ? name.substring(0, 52) + '...' : name;

                        // Zebra Striping for rows
                        if (index % 2 === 0) {
                            doc.setFillColor(249, 250, 251); // Very light gray (gray-50)
                            doc.rect(20, currentY, 170, rowHeight, 'F');
                        }

                        // Draw Row Border
                        doc.setDrawColor(229, 231, 235);
                        doc.rect(20, currentY, 170, rowHeight, 'S');

                        // Text
                        doc.text(code, 25, currentY + 5);
                        doc.text(displayName, 25 + col1W, currentY + 5);
                        doc.text(count.toString(), 20 + col1W + col2W + (col3W / 2), currentY + 5, { align: 'center' });

                        // Vertical Lines
                        doc.line(20 + col1W, currentY, 20 + col1W, currentY + rowHeight);
                        doc.line(20 + col1W + col2W, currentY, 20 + col1W + col2W, currentY + rowHeight);

                        currentY += rowHeight;
                    });

                });

            doc.save(`seating-plan-layout-${examDate}.pdf`);
        } catch (err: any) {
            console.error("PDF Generation Error:", err);
            toast.error("Failed to generate PDF: " + err.message);
        }
    };

    const handlePreviewExportExcel = () => {
        const wb = XLSX.utils.book_new();

        rooms
            .filter(room => {
                const sessionMatch = isRoomInSession(room, sessionFilter);
                const modeMatch = examModeFilter === 'ALL' ? true : examModeFilter === 'MCQ' ? room.examMode === 'MCQ' : (room.examMode || 'NORMAL') === 'NORMAL';
                return sessionMatch && modeMatch;
            })
            .forEach(room => {
                const wsData: any[][] = [];

                // Detailed Room Header for Excel
                const title = summary.examType || 'Examination Seating Plan';
                // Use Verbose Display Session
                const sessionText = room.displaySession || (room.session ? ` - ${room.session === 'FN' ? 'FORENOON' : room.session === 'AN' ? 'AFTERNOON' : room.session}` : '');

                // Get Exam Time
                const examTime = room.seats.find(s => s.time)?.time || 'N/A';

                wsData.push([title]);
                wsData.push([`Room: ${room.roomNumber}${sessionText} | Seating Layout`]);
                wsData.push([`Date: ${new Date(examDate).toLocaleDateString('en-IN')} | Time: ${examTime} | Capacity: ${room.totalSeats} | Allocated: ${room.seats.length}`]);
                wsData.push([]); // Spacer

                // Grid
                for (let r = 1; r <= room.rows; r++) {
                    const rowData: string[] = [];
                    for (let c = 1; c <= room.columns; c++) {
                        const seat = room.seats.find(s => s.row === r && s.col === c);
                        if (seat) {
                            rowData.push(`${seat.student}\n${seat.course}`);
                        } else {
                            rowData.push('EMPTY');
                        }
                    }
                    wsData.push(rowData);
                }

                const ws = XLSX.utils.aoa_to_sheet(wsData);

                // Style columns (approx width)
                const wscols = Array(room.columns).fill({ wch: 20 });
                ws['!cols'] = wscols;

                // Clean room number for sheet name (remove special chars)
                const cleanRoomNum = room.roomNumber.replace(/[\\/*[\]:?]/g, '_');
                XLSX.utils.book_append_sheet(wb, ws, `Room ${cleanRoomNum.substring(0, 30)}`);

                // Add Course Breakdown to Excel
                wsData.push([]); // Spacer
                wsData.push(["Course Breakdown"]);
                wsData.push(["Course Code", "Course Name", "Total Students"]);

                const uniqueCourses = Array.from(new Set(room.seats.map(s => s.course))).sort();
                uniqueCourses.forEach(code => {
                    const count = room.seats.filter(s => s.course === code).length;
                    const courseInfo = courseStats.find((c: any) => c.courseCode === code);
                    const name = courseInfo ? courseInfo.courseName : '';
                    wsData.push([code, name, count]);
                });

                // Update worksheet with new data of breakdown
                const newWs = XLSX.utils.aoa_to_sheet(wsData);
                newWs['!cols'] = wscols;
                wb.Sheets[`Room ${cleanRoomNum.substring(0, 30)}`] = newWs;
            });

        XLSX.writeFile(wb, `seating-plan-layout-${examDate}.xlsx`);
    };

    const handlePreviewPrintView = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const roomGrids = rooms
            .filter(room => {
                const sessionMatch = isRoomInSession(room, sessionFilter);
                const modeMatch = examModeFilter === 'ALL' ? true : examModeFilter === 'MCQ' ? room.examMode === 'MCQ' : (room.examMode || 'NORMAL') === 'NORMAL';
                return sessionMatch && modeMatch;
            })
            .map(room => {
                // Generate column headers
                const columnHeaders = Array.from({ length: room.columns }).map((_, idx) =>
                    `<div class="col-label">Col ${idx + 1}</div>`
                ).join('');

                // Generate rows with row labels and seats
                const rowsHtml = Array.from({ length: room.rows }).map((_, rowIdx) => {
                    const currentRow = rowIdx + 1;
                    const seatsInRow = Array.from({ length: room.columns }).map((_, colIdx) => {
                        const currentCol = colIdx + 1;
                        const seat = room.seats.find(s => s.row === currentRow && s.col === currentCol);

                        return seat
                            ? `<div class="seat filled">
                  <div class="student">${seat.student}</div>
                  <div class="course">${seat.course}</div>
                 </div>`
                            : `<div class="seat empty">Empty</div>`;
                    }).join('');

                    return `
            <div class="row-container">
              <div class="row-label">Row ${currentRow}</div>
              <div class="seats-row">
                ${seatsInRow}
              </div>
            </div>
          `;
                }).join('');

                // Use Verbose Display Session for Print View
                const sessionText = room.displaySession || (room.session ? ` (${room.session === 'FN' ? 'FORENOON' : room.session === 'AN' ? 'AFTERNOON' : room.session})` : '');

                // Get Exam Time
                const examTime = room.seats.find(s => s.time)?.time || 'N/A';

                return `
          <div class="room-container">
            <div style="text-align: center; margin-bottom: 20px;">
              <img src="/banner_1.png" style="width: 100%; max-width: 800px; height: auto;">
            </div>
            <div class="room-header-premium">
               <!-- Exam Title / Type - Prominent Display -->
               <h1 style="font-size: 24px; font-weight: 800; margin: 0 0 15px 0; color: #1e1b4b; text-transform: uppercase; letter-spacing: 0.5px; text-align: center;">${summary.examType || 'University Examination'}</h1>

               <div class="header-row" style="border: 1px solid #e5e7eb; padding: 10px; border-radius: 6px; background: #f9fafb; display: flex; justify-content: space-around; align-items: center;">
                 <div style="text-align: center;">
                    <div style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Room Number</div>
                    <div style="font-size: 18px; font-weight: bold; color: #111;">${room.roomNumber}</div>
                 </div>
                 
                 <div style="height: 30px; width: 1px; background: #d1d5db;"></div>

                 <div style="text-align: center;">
                    <div style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Session</div>
                    <div style="font-size: 14px; font-weight: bold; color: #111;">${sessionText ? sessionText.replace(/[()]/g, '') : (room.session || 'N/A')}</div>
                 </div>

                 <div style="height: 30px; width: 1px; background: #d1d5db;"></div>

                 <div style="text-align: center;">
                    <div style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Date</div>
                    <div style="font-size: 14px; font-weight: bold; color: #111;">${new Date(examDate).toLocaleDateString('en-IN')}</div>
                 </div>

                 <div style="height: 30px; width: 1px; background: #d1d5db;"></div>

                 <div style="text-align: center;">
                    <div style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Time</div>
                    <div style="font-size: 14px; font-weight: bold; color: #111;">${examTime}</div>
                 </div>
               </div>

             <div class="meta-info" style="margin-top: 5px;">
               <span>Capacity: <strong>${room.totalSeats}</strong></span>
               <span style="margin: 0 10px;">|</span>
               <span>Allocated: <strong>${room.seats.length}</strong></span>
             </div>
          </div>
          <div class="seating-layout">
            <div class="column-headers">
              <div class="corner-spacer"></div>
              ${columnHeaders}
            </div>
            ${rowsHtml}
          </div>
          
          <!-- Course Breakdown Table -->
          <div class="course-breakdown">
             <h3>Course Breakdown</h3>
             <table>
               <thead>
                 <tr>
                   <th style="width: 15%">Course Code</th>
                   <th style="width: 70%">Course Name</th>
                   <th style="width: 15%; text-align: center;">Students</th>
                 </tr>
               </thead>
               <tbody>
                 ${Array.from(new Set(room.seats.map(s => s.course))).sort().map(code => {
                    const count = room.seats.filter(s => s.course === code).length;
                    const courseInfo = courseStats.find((c: any) => c.courseCode === code);
                    const name = courseInfo ? courseInfo.courseName : '';
                    return `
                     <tr>
                       <td style="font-weight: bold; color: #374151;">${code}</td>
                       <td>${name}</td>
                       <td style="text-align: center; font-weight: bold;">${count}</td>
                     </tr>
                   `;
                }).join('')}
               </tbody>
             </table>
          </div>
        </div>
      `;
            }).join('');

        const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${summary.examType || 'Seating Preview'}</title>
          <style>
            body { font-family: 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; color: #1f2937; }
            .room-container { 
              page-break-after: always; 
              display: flex; 
              flex-direction: column; 
              box-sizing: border-box; 
              max-width: 1200px;
              margin: 0 auto;
            }
            .room-header-premium { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #4f46e5; padding-bottom: 15px; flex-shrink: 0; }
            .room-header-premium h1 { margin: 0; font-size: 26px; color: #1e1b4b; text-transform: uppercase; letter-spacing: 1px; }
            .room-header-premium h2 { margin: 8px 0; font-size: 20px; color: #4f46e5; }
            .header-row { display: flex; justify-content: center; align-items: center; gap: 15px; margin: 5px 0; }
            .session-tag { font-size: 12px; font-weight: bold; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid; }
            .session-tag.fn { background: #e0f2fe; color: #0284c7; border-color: #bae6fd; }
            .session-tag.an { background: #ffedd5; color: #c2410c; border-color: #fed7aa; }
            .meta-info { display: flex; justify-content: center; gap: 30px; font-size: 13px; color: #6b7280; margin-top: 10px; }
            
            .seating-layout { flex-grow: 1; display: flex; flex-direction: column; }
            
            .column-headers { 
              display: flex; 
              margin-bottom: 8px; 
              gap: 8px;
            }
            .corner-spacer { 
              width: 60px; 
              flex-shrink: 0; 
            }
            .col-label { 
              flex: 1; 
              text-align: center; 
              font-weight: bold; 
              font-size: 11px; 
              color: #6b7280; 
            }
            
            .row-container { 
              display: flex; 
              gap: 8px; 
              margin-bottom: 8px; 
            }
            .row-label { 
              width: 60px; 
              flex-shrink: 0; 
              display: flex; 
              align-items: center; 
              justify-content: center; 
              font-weight: bold; 
              font-size: 11px; 
              color: #6b7280; 
            }
            .seats-row { 
              flex: 1; 
              display: grid; 
              gap: 8px; 
              grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); 
            }
            
            .seat {
              border: 2px solid #e5e7eb;
              border-radius: 12px;
              padding: 12px;
              text-align: center;
              min-height: 70px;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              position: relative;
            }
            .seat.filled { background-color: #f8fafc; border-color: #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
            .seat.empty { background-color: #ffffff; color: #e5e7eb; border-style: dashed; }
            .student { font-weight: 800; font-size: 16px; color: #111827; margin-bottom: 4px; }
            .course { font-size: 11px; font-weight: 600; color: #6366f1; background: #eef2ff; padding: 2px 8px; border-radius: 4px; }
            .seat-session-badge { position: absolute; top: -6px; right: -6px; font-size: 9px; font-weight: bold; padding: 2px 6px; border-radius: 10px; border: 1px solid; }
            .seat-session-badge.fn { background: #0ea5e9; color: #fff; border-color: #0284c7; }
            .seat-session-badge.an { background: #f97316; color: #fff; border-color: #ea580c; }
            
            @media print {
              body { padding: 0; }
              .seat { -webkit-print-color-adjust: exact; print-color-adjust: exact; border: 1px solid #999 !important; }
              
              /* Print optimizations to fit on one page */
              .room-container {
                padding: 10px !important; // Reduced padding
                min-height: auto !important;
                height: auto; // Allow auto height to fit breakdown
                max-height: 100vh;
                page-break-after: always;
                page-break-inside: avoid;
                display: flex;
                flex-direction: column;
                justify-content: flex-start; // Start from top
              }
              
              .room-header-premium { margin-bottom: 5px; padding-bottom: 5px; border-bottom-width: 1px; }
              .room-header-premium h1 { font-size: 16px; margin-bottom: 2px; }
              .room-header-premium h2 { font-size: 14px; margin: 2px 0; }
              .header-row { padding: 4px !important; margin-bottom: 4px !important; }
              .meta-info { font-size: 10px; margin-top: 2px; gap: 15px; }
              
              /* Compact Seating Grid */
              .seating-layout { flex-grow: 0; margin-bottom: 5px; } 
              .row-container { margin-bottom: 4px; gap: 4px; }
              .seats-row { gap: 4px; }
              .seat { 
                min-height: 45px; 
                padding: 4px; 
                border-width: 1px;
                border-radius: 6px;
              }
              .student { font-size: 12px; margin-bottom: 2px; }
              .course { font-size: 9px; padding: 1px 4px; }
              .seat.empty { font-size: 10px; }
              
              .col-label, .row-label { font-size: 9px; }
              .corner-spacer, .row-label { width: 40px; }
              
              /* Compact Course Breakdown */
              .course-breakdown { 
                margin-top: 10px; 
                padding-top: 10px; 
                border-top-width: 1px;
                page-break-inside: avoid;
              }
              .course-breakdown h3 { font-size: 14px; margin-bottom: 5px; }
              .course-breakdown th, .course-breakdown td { padding: 4px 6px; font-size: 10px; }
            }
            
            /* Screen-only styles for non-print view to remain larger */
            @media screen {
               .room-container { min-height: 100vh; padding: 40px; }
            }
            
            .course-breakdown { margin-top: 30px; border-top: 2px solid #e5e7eb; padding-top: 20px; page-break-inside: avoid; }
            .course-breakdown h3 { margin: 0 0 10px 0; font-size: 16px; color: #1e1b4b; text-transform: uppercase; }
            .course-breakdown table { width: 100%; border-collapse: collapse; font-size: 12px; }
            .course-breakdown th { text-align: left; padding: 8px; background-color: #f3f4f6; border-bottom: 2px solid #e5e7eb; color: #374151; }
            .course-breakdown td { padding: 8px; border-bottom: 1px solid #e5e7eb; color: #4b5563; }
            .course-breakdown tr:nth-child(even) { background-color: #f9fafb; }
          </style>
        </head>
        <body>
          ${roomGrids}
          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
      </html>
    `;

        printWindow.document.write(htmlContent);
        printWindow.document.close();
    };

    const canGenerate =
        uploadStatus.students === 'uploaded' &&
        uploadStatus.rooms === 'uploaded' &&
        uploadStatus.examDate === 'set' &&
        examType.trim().length > 0 &&
        !loading;

    if (isInitialLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-violet-50 flex flex-col items-center justify-center p-6 text-center">
                <motion.div
                    animate={{
                        scale: [1, 1.1, 1],
                        rotate: [0, 180, 360]
                    }}
                    transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                    className="size-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-200 mb-6"
                >
                    <LayoutDashboard className="size-8 text-white" />
                </motion.div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Syncing Dashboard Data</h2>
                <p className="text-gray-500 max-w-xs mx-auto animate-pulse">
                    Retrieving the latest seating plans and student allocations from the database...
                </p>
            </div>
        );
    }

    return (
        <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-indigo-50 via-violet-50 to-purple-50 p-6">
            <div className="max-w-7xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8"
                >
                    <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
                    <p className="text-gray-600 mt-2">Controller of Examinations Portal</p>
                </motion.div>

                {/* Tab Navigation */}
                <div className="flex flex-wrap gap-4 mb-8">
                    <button
                        onClick={() => setActiveTab('create')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${activeTab === 'create'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                            : 'bg-white text-gray-600 hover:bg-indigo-50'
                            }`}
                    >
                        <LayoutDashboard className="size-5" />
                        Generator
                    </button>

                    <button
                        onClick={() => setActiveTab('history')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${activeTab === 'history'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                            : 'bg-white text-gray-600 hover:bg-indigo-50'
                            }`}
                    >
                        <Calendar className="size-5" />
                        History
                    </button>

                    <button
                        onClick={() => seatingGenerated && setActiveTab('courses')}
                        disabled={!seatingGenerated}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${activeTab === 'courses'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                            : seatingGenerated
                                ? 'bg-white text-gray-600 hover:bg-indigo-50'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        <FileSpreadsheet className="size-5" />
                        Breakdown
                    </button>

                    <button
                        onClick={() => seatingGenerated && setActiveTab('preview')}
                        disabled={!seatingGenerated}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${activeTab === 'preview'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                            : seatingGenerated
                                ? 'bg-white text-gray-600 hover:bg-indigo-50'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        <Eye className="size-5" />
                        Preview
                    </button>
                </div>

                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-6 p-4 bg-red-50 border border-red-300 rounded-xl flex items-start gap-3"
                    >
                        <span className="text-red-600 text-sm">⚠️</span>
                        <p className="text-red-700 font-medium">{error}</p>
                    </motion.div>
                )}

                {clearedMessage && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="mb-6 p-4 bg-green-50 border border-green-300 rounded-xl flex items-center gap-3"
                    >
                        <span className="text-green-600 text-sm font-bold">✓</span>
                        <p className="text-green-700 font-medium">{clearedMessage}</p>
                    </motion.div>
                )}

                {/* Exam Date Input */}
                {/* CREATE PLAN VIEW */}

                {activeTab === 'history' && (
                    <div className="space-y-6">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                                <Calendar className="w-6 h-6 text-indigo-600" />
                                View Previous Seating Plans
                            </h2>

                            <div className="mb-8">
                                <label className="block text-sm font-medium text-gray-700 mb-3">Type of Examination</label>
                                <div className="grid grid-cols-3 gap-3 mb-6">
                                    <button
                                        onClick={() => {
                                            setSearchCategory('university');
                                            setSearchType('University Examination');
                                        }}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${searchCategory === 'university'
                                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                            : 'border-gray-200 hover:border-indigo-200 text-gray-600'
                                            }`}
                                    >
                                        <GraduationCap className="size-6 mb-2" />
                                        <span className="text-xs font-bold">University Exam</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setSearchCategory('model');
                                            setSearchType('Model Examination');
                                        }}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${searchCategory === 'model'
                                            ? 'border-purple-500 bg-purple-50 text-purple-700'
                                            : 'border-gray-200 hover:border-purple-200 text-gray-600'
                                            }`}
                                    >
                                        <FileText className="size-6 mb-2" />
                                        <span className="text-xs font-bold">Model Exam</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setSearchCategory('other');
                                            setSearchType('');
                                        }}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${searchCategory === 'other'
                                            ? 'border-orange-500 bg-orange-50 text-orange-700'
                                            : 'border-gray-200 hover:border-orange-200 text-gray-600'
                                            }`}
                                    >
                                        <PenTool className="size-6 mb-2" />
                                        <span className="text-xs font-bold">Other</span>
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Exam Date</label>
                                        <input
                                            type="date"
                                            value={searchDate}
                                            onChange={(e) => setSearchDate(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-transparent"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Exam Type Name</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. University Examination"
                                            value={searchType}
                                            disabled={searchCategory !== 'other'}
                                            onChange={(e) => setSearchType(e.target.value)}
                                            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all ${searchCategory === 'other'
                                                ? 'border-gray-300 bg-white'
                                                : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                                                }`}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={handleSearchSeating}
                                    disabled={loading}
                                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 font-medium"
                                >
                                    <Eye className="size-4" />
                                    {loading ? 'Searching...' : 'Search Plan'}
                                </button>
                            </div>

                            {searchResult && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="mt-6 p-4 bg-orange-50 border border-orange-100 rounded-lg text-orange-700 text-center"
                                >
                                    <p className="font-medium flex items-center justify-center gap-2">
                                        <Sun className="w-5 h-5" />
                                        {searchResult}
                                    </p>
                                </motion.div>
                            )}
                        </div>

                        {/* Danger Zone: Delete Seating Plan */}
                        <div className="bg-red-50 rounded-xl shadow-sm border border-red-100 p-6">
                            <h2 className="text-xl font-bold text-red-700 mb-6 flex items-center gap-2">
                                <Trash2 className="w-6 h-6 text-red-600" />
                                Delete Seating Plan
                            </h2>

                            <p className="text-sm text-red-600 mb-6 bg-red-100/50 p-3 rounded-lg border border-red-200">
                                <strong>Warning:</strong> To delete a seating plan, you must manually enter the exact Exam Date and Exam Type. This action will permanently remove all student seat allocations for that exam.
                            </p>

                            <div className="mb-8">
                                <label className="block text-sm font-medium text-red-900 mb-3">Type of Examination to Delete</label>
                                <div className="grid grid-cols-3 gap-3 mb-6">
                                    <button
                                        onClick={() => {
                                            setDeleteCategory('university');
                                            setDeleteType('University Examination');
                                        }}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${deleteCategory === 'university'
                                            ? 'border-red-500 bg-red-50 text-red-700'
                                            : 'border-gray-200 hover:border-red-200 text-gray-600'
                                            }`}
                                    >
                                        <GraduationCap className="size-6 mb-2" />
                                        <span className="text-xs font-bold">University Exam</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setDeleteCategory('model');
                                            setDeleteType('Model Examination');
                                        }}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${deleteCategory === 'model'
                                            ? 'border-red-500 bg-red-50 text-red-700'
                                            : 'border-gray-200 hover:border-red-200 text-gray-600'
                                            }`}
                                    >
                                        <FileText className="size-6 mb-2" />
                                        <span className="text-xs font-bold">Model Exam</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setDeleteCategory('other');
                                            setDeleteType('');
                                        }}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${deleteCategory === 'other'
                                            ? 'border-red-500 bg-red-50 text-red-700'
                                            : 'border-gray-200 hover:border-red-200 text-gray-600'
                                            }`}
                                    >
                                        <PenTool className="size-6 mb-2" />
                                        <span className="text-xs font-bold">Other</span>
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-red-900 mb-2">Exam Date to Delete</label>
                                        <input
                                            type="date"
                                            value={deleteDate}
                                            onChange={(e) => setDeleteDate(e.target.value)}
                                            className="w-full px-4 py-2 border border-red-200 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none bg-white font-medium"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-red-900 mb-2">Exam Type Name to Delete</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. University Examination"
                                            value={deleteType}
                                            disabled={deleteCategory !== 'other'}
                                            onChange={(e) => setDeleteType(e.target.value)}
                                            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none font-medium transition-all ${deleteCategory === 'other'
                                                ? 'border-red-200 bg-white cursor-text'
                                                : 'border-gray-100 bg-gray-50 text-gray-500 cursor-not-allowed'
                                                }`}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={handleClearSeating}
                                    disabled={loading || !deleteDate || !deleteType}
                                    className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 font-medium shadow-sm transition-all"
                                >
                                    <Trash2 className="size-4" />
                                    {loading ? 'Deleting...' : 'Permanently Delete Plan'}
                                </button>
                            </div>
                        </div>

                        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6">
                            <h3 className="text-lg font-semibold text-indigo-900 mb-2">Instructions</h3>
                            <p className="text-indigo-700 mb-2">
                                Enter the Date and Exam Type of a previously generated seating plan to view it.
                            </p>
                            <ul className="list-disc list-inside text-indigo-600 space-y-1">
                                <li>Ensure the Exam Type matches exactly (e.g. "University Examination").</li>
                                <li>If a plan is found, you will be automatically redirected to the View tab.</li>
                                <li>If no plan exists for that date, you will see a notification.</li>
                            </ul>
                        </div>
                    </div>
                )}

                {activeTab === 'create' && (
                    <>
                        {/* Exam Date Input */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 }}
                            className="mb-6"
                        >
                            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-indigo-100 rounded-lg">
                                            <Calendar className="size-5 text-indigo-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">Exam Date</h3>
                                            <p className="text-sm text-gray-600">Select the examination date</p>
                                        </div>
                                    </div>
                                    {examDate && (
                                        <button
                                            onClick={() => { setExamDate(''); setUploadStatus(p => ({ ...p, examDate: 'ready' })); }}
                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                            title="Clear date"
                                        >
                                            <Trash2 className="size-4" />
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="date"
                                    value={examDate}
                                    onChange={handleExamDateChange}
                                    className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none transition-colors ${uploadStatus.examDate === 'set'
                                        ? 'border-green-300 bg-green-50'
                                        : uploadStatus.examDate === 'error'
                                            ? 'border-red-300 bg-red-50'
                                            : 'border-gray-300 bg-white'
                                        }`}
                                />

                                <div className="mt-6 pt-6 border-t border-indigo-50">
                                    <div className="flex items-center gap-2 mb-3">
                                        <LayoutDashboard className="size-4 text-indigo-500" />
                                        <h4 className="font-semibold text-gray-900">Type of Examination</h4>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3 mb-4">
                                        <button
                                            onClick={() => {
                                                setSelectedExamCategory('university');
                                                setExamType('University Examination');
                                            }}
                                            className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${selectedExamCategory === 'university'
                                                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                                : 'border-gray-200 hover:border-indigo-200 text-gray-600'
                                                }`}
                                        >
                                            <GraduationCap className="size-6 mb-2" />
                                            <span className="text-xs font-bold">University Exam</span>
                                        </button>

                                        <button
                                            onClick={() => {
                                                setSelectedExamCategory('model');
                                                setExamType('Model Examination');
                                            }}
                                            className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${selectedExamCategory === 'model'
                                                ? 'border-purple-500 bg-purple-50 text-purple-700'
                                                : 'border-gray-200 hover:border-purple-200 text-gray-600'
                                                }`}
                                        >
                                            <FileText className="size-6 mb-2" />
                                            <span className="text-xs font-bold">Model Exam</span>
                                        </button>

                                        <button
                                            onClick={() => {
                                                setSelectedExamCategory('other');
                                                setExamType('');
                                            }}
                                            className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${selectedExamCategory === 'other'
                                                ? 'border-orange-500 bg-orange-50 text-orange-700'
                                                : 'border-gray-200 hover:border-orange-200 text-gray-600'
                                                }`}
                                        >
                                            <PenTool className="size-6 mb-2" />
                                            <span className="text-xs font-bold">Other</span>
                                        </button>
                                    </div>

                                    {selectedExamCategory === 'other' && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                        >
                                            <input
                                                type="text"
                                                required
                                                placeholder="Enter custom examination title..."
                                                value={examType}
                                                onChange={(e) => setExamType(e.target.value)}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none transition-all bg-white/50 focus:bg-white"
                                                autoFocus
                                            />
                                        </motion.div>
                                    )}

                                    <p className="mt-2 text-xs text-gray-500 font-medium">
                                        Selected: <strong className="text-indigo-600">{examType || '(None)'}</strong>
                                    </p>
                                </div>

                                {examDate && (
                                    <p className="mt-2 text-sm text-gray-600">
                                        Selected: <span className="font-medium">{new Date(examDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                    </p>
                                )}
                            </div>
                        </motion.div>

                        {/* Upload Section */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="grid md:grid-cols-2 gap-6 mb-6"
                        >
                            {/* Normal Student Nominal Roll Upload */}
                            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-100 rounded-lg">
                                            <Users className="size-6 text-blue-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">Descriptive Students</h3>
                                            <p className="text-sm text-gray-600">Upload Excel file</p>
                                        </div>
                                    </div>
                                    {studentFile && (
                                        <button
                                            onClick={(e) => { e.preventDefault(); setStudentFile(null); setUploadStatus(p => ({ ...p, students: 'ready' })); }}
                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                            title="Remove file"
                                        >
                                            <Trash2 className="size-4" />
                                        </button>
                                    )}
                                </div>

                                <label className="block">
                                    <div className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${uploadStatus.students === 'uploaded'
                                        ? 'border-green-300 bg-green-50'
                                        : uploadStatus.students === 'error'
                                            ? 'border-red-300 bg-red-50'
                                            : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                                        }`}>
                                        <Upload className={`size-6 mx-auto mb-2 ${uploadStatus.students === 'uploaded' ? 'text-green-600' : 'text-gray-400'
                                            }`} />
                                        <p className="text-sm font-medium text-gray-700">
                                            {uploadStatus.students === 'uploaded'
                                                ? `✓ ${studentFile?.name}`
                                                : 'Drop file or click'}
                                        </p>
                                    </div>
                                    <input type="file" accept=".xlsx,.xls" onChange={handleStudentUpload} className="hidden" />
                                </label>
                            </div>

                            {/* MCQ Student Nominal Roll Upload */}
                            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-pink-100 rounded-lg">
                                            <Users className="size-6 text-pink-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">MCQ Students</h3>
                                            <p className="text-sm text-gray-600">Upload Excel file</p>
                                        </div>
                                    </div>
                                    {mcqStudentFile && (
                                        <button
                                            onClick={(e) => { e.preventDefault(); setMcqStudentFile(null); setUploadStatus(p => ({ ...p, mcqStudents: 'ready' })); }}
                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                            title="Remove file"
                                        >
                                            <Trash2 className="size-4" />
                                        </button>
                                    )}
                                </div>

                                <label className="block">
                                    <div className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${uploadStatus.mcqStudents === 'uploaded'
                                        ? 'border-green-300 bg-green-50'
                                        : uploadStatus.mcqStudents === 'error'
                                            ? 'border-red-300 bg-red-50'
                                            : 'border-gray-300 hover:border-pink-400 hover:bg-pink-50'
                                        }`}>
                                        <Upload className={`size-6 mx-auto mb-2 ${uploadStatus.mcqStudents === 'uploaded' ? 'text-green-600' : 'text-gray-400'
                                            }`} />
                                        <p className="text-sm font-medium text-gray-700">
                                            {uploadStatus.mcqStudents === 'uploaded'
                                                ? `✓ ${mcqStudentFile?.name}`
                                                : 'Drop file or click'}
                                        </p>
                                    </div>
                                    <input type="file" accept=".xlsx,.xls" onChange={handleMcqStudentUpload} className="hidden" />
                                </label>
                            </div>

                            {/* Normal Room Details Upload */}
                            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-purple-100 rounded-lg">
                                            <FileSpreadsheet className="size-6 text-purple-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">Descriptive Rooms</h3>
                                            <p className="text-sm text-gray-600">Upload Excel file</p>
                                        </div>
                                    </div>
                                    {roomFile && (
                                        <button
                                            onClick={(e) => { e.preventDefault(); setRoomFile(null); setUploadStatus(p => ({ ...p, rooms: 'ready' })); }}
                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                            title="Remove file"
                                        >
                                            <Trash2 className="size-4" />
                                        </button>
                                    )}
                                </div>

                                <label className="block">
                                    <div className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${uploadStatus.rooms === 'uploaded'
                                        ? 'border-green-300 bg-green-50'
                                        : uploadStatus.rooms === 'error'
                                            ? 'border-red-300 bg-red-50'
                                            : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'
                                        }`}>
                                        <Upload className={`size-6 mx-auto mb-2 ${uploadStatus.rooms === 'uploaded' ? 'text-green-600' : 'text-gray-400'
                                            }`} />
                                        <p className="text-sm font-medium text-gray-700">
                                            {uploadStatus.rooms === 'uploaded'
                                                ? `✓ ${roomFile?.name}`
                                                : 'Drop file or click'}
                                        </p>
                                    </div>
                                    <input type="file" accept=".xlsx,.xls" onChange={handleRoomUpload} className="hidden" />
                                </label>
                            </div>

                            {/* MCQ Room Details Upload */}
                            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-orange-100 rounded-lg">
                                            <FileSpreadsheet className="size-6 text-orange-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">MCQ Rooms</h3>
                                            <p className="text-sm text-gray-600">Upload Excel file</p>
                                        </div>
                                    </div>
                                    {mcqRoomFile && (
                                        <button
                                            onClick={(e) => { e.preventDefault(); setMcqRoomFile(null); setUploadStatus(p => ({ ...p, mcqRooms: 'ready' })); }}
                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                            title="Remove file"
                                        >
                                            <Trash2 className="size-4" />
                                        </button>
                                    )}
                                </div>

                                <label className="block">
                                    <div className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${uploadStatus.mcqRooms === 'uploaded'
                                        ? 'border-green-300 bg-green-50'
                                        : uploadStatus.mcqRooms === 'error'
                                            ? 'border-red-300 bg-red-50'
                                            : 'border-gray-300 hover:border-orange-400 hover:bg-orange-50'
                                        }`}>
                                        <Upload className={`size-6 mx-auto mb-2 ${uploadStatus.mcqRooms === 'uploaded' ? 'text-green-600' : 'text-gray-400'
                                            }`} />
                                        <p className="text-sm font-medium text-gray-700">
                                            {uploadStatus.mcqRooms === 'uploaded'
                                                ? `✓ ${mcqRoomFile?.name}`
                                                : 'Drop file or click'}
                                        </p>
                                    </div>
                                    <input type="file" accept=".xlsx,.xls" onChange={handleMcqRoomUpload} className="hidden" />
                                </label>
                            </div>
                        </motion.div>

                        {/* Action Buttons */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="flex flex-col sm:flex-row gap-4 mb-6"
                        >
                            <button
                                onClick={generateSeating}
                                disabled={!canGenerate}
                                className={`flex-1 py-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 ${canGenerate
                                    ? 'bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 cursor-pointer shadow-lg shadow-indigo-200'
                                    : 'bg-gray-400 cursor-not-allowed opacity-50'
                                    }`}
                            >
                                {loading ? (
                                    <>
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                        Processing...
                                    </>
                                ) : seatingGenerated ? (
                                    'Regenerate Seating Plan'
                                ) : (
                                    'Generate Seating Plan'
                                )}
                            </button>

                        </motion.div>
                    </>
                )}

                {/* ALLOCATED COURSES VIEW */}
                {(activeTab === 'courses' || activeTab === 'preview') && seatingGenerated && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-6 p-6 bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                        <div>
                            <h2 className="text-xl font-bold text-gray-900">{examType || 'Examination Seating Plan'}</h2>
                            <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                                <span className="flex items-center gap-1.5">
                                    <Calendar className="size-4 text-indigo-500" />
                                    {examDate ? new Date(examDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'No date set'}
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <Users className="size-4 text-indigo-500" />
                                    {summary.totalStudents} Students
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full border border-green-200 uppercase tracking-wider">
                                Active Plan
                            </span>
                        </div>
                    </motion.div>
                )}

                {/* ALLOCATED COURSES VIEW */}
                {activeTab === 'courses' && seatingGenerated && (
                    <>
                        {/* Summary Section */}
                        {(() => {
                            let displayStudents = summary.totalStudents;
                            let displayInputStudents = summary.totalInputStudents || summary.totalStudents;
                            let displayRooms = summary.totalRooms;
                            let displayCourses = summary.totalCourses;

                            if (breakdownModeFilter !== 'ALL' || sessionFilter !== 'ALL') {
                                const isTargetMCQ = breakdownModeFilter === 'MCQ';
                                const isTargetNormal = breakdownModeFilter === 'NORMAL';
                                
                                const targetRooms = rooms.filter(r => {
                                    const modeMatch = isTargetMCQ ? r.examMode === 'MCQ' : isTargetNormal ? (r.examMode || 'NORMAL') === 'NORMAL' : true;
                                    const sessionMatch = isRoomInSession(r, sessionFilter);
                                    return modeMatch && sessionMatch;
                                });
                                
                                displayRooms = targetRooms.length;
                                displayStudents = targetRooms.reduce((sum, r) => sum + r.seats.length, 0);
                                
                                const targetCoursesList = courseStats.filter((course) => {
                                    const inTargetRooms = targetRooms.some(r => r.seats.some(s => s.course === course.courseCode));
                                    return inTargetRooms;
                                });
                                displayCourses = targetCoursesList.length;
                                displayInputStudents = targetCoursesList.reduce((sum, c) => sum + (c.totalStudents || c.allocatedSeats), 0);
                            }

                            return (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.1 }}
                                    className="grid md:grid-cols-3 gap-6 mb-6"
                                >
                                    <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 p-6">
                                        <p className="text-gray-600 text-sm mb-2">Allocated Students</p>
                                        <p className="text-4xl font-bold text-indigo-600">
                                            {displayStudents} <span className="text-sm font-normal text-gray-500">/ {displayInputStudents}</span>
                                        </p>
                                        {breakdownModeFilter === 'ALL' && summary.unallocatedCount ? (
                                            <p className="mt-2 text-xs text-red-600 font-medium">{summary.unallocatedCount} unallocated</p>
                                        ) : (
                                            <p className="mt-2 text-xs text-green-600 font-medium">All allocated ✓</p>
                                        )}
                                    </div>
                                    <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 p-6">
                                        <p className="text-gray-600 text-sm mb-2">Total Rooms Used</p>
                                        <p className="text-4xl font-bold text-violet-600">{displayRooms}</p>
                                        <p className="mt-2 text-xs text-gray-500">Across all sessions</p>
                                    </div>
                                    <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 p-6">
                                        <p className="text-gray-600 text-sm mb-2">Total Courses</p>
                                        <p className="text-4xl font-bold text-purple-600">{displayCourses}</p>
                                        {breakdownModeFilter === 'ALL' && summary.utilizationRate && (
                                            <p className="mt-2 text-xs text-indigo-600 font-medium">{summary.utilizationRate}% Capacity used</p>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })()}

                        {/* Warnings Section */}
                        {warnings.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.32 }}
                                className="mb-6"
                            >
                                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-6">
                                    <div className="flex items-start gap-3 mb-4">
                                        <span className="text-2xl">⚠️</span>
                                        <div>
                                            <h3 className="text-lg font-bold text-yellow-900">Allocation Warnings</h3>
                                            <p className="text-sm text-yellow-700">The following issues were detected during seating generation:</p>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        {warnings.map((warning, idx) => (
                                            <div key={idx} className="bg-white rounded-lg p-4 border border-yellow-200">
                                                <p className="text-sm font-medium text-gray-900">{warning.message}</p>
                                                {warning.type === 'capacity_shortage' && (
                                                    <div className="mt-2 text-xs text-gray-600">
                                                        <span className="font-semibold">{warning.course}</span> - {warning.courseName}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Unallocated Students List */}
                                    {unallocatedStudents.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-yellow-300">
                                            <h4 className="text-sm font-bold text-yellow-900 mb-3">
                                                Unallocated Students ({unallocatedStudents.length})
                                            </h4>
                                            <div className="max-h-60 overflow-y-auto overflow-x-auto bg-white rounded-lg border border-yellow-200">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-yellow-50 sticky top-0">
                                                        <tr>
                                                            <th className="text-left p-2 font-semibold text-gray-700">Reg No</th>
                                                            <th className="text-left p-2 font-semibold text-gray-700">Student Name</th>
                                                            <th className="text-left p-2 font-semibold text-gray-700">Course</th>
                                                            <th className="text-left p-2 font-semibold text-gray-700">Session</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {unallocatedStudents.map((student, idx) => (
                                                            <tr key={idx} className="border-t border-yellow-100 hover:bg-yellow-50">
                                                                <td className="p-2 font-medium text-gray-900">{student.regNo}</td>
                                                                <td className="p-2 text-gray-700">{student.name}</td>
                                                                <td className="p-2 text-gray-600">{student.course}</td>
                                                                <td className="p-2 text-gray-600">{student.session}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {/* Course Statistics & Room Breakdown */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.35 }}
                            className="mb-8"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    <FileSpreadsheet className="size-5 text-indigo-600" />
                                    Allocated Courses
                                </h2>
                                
                                <div className="flex flex-wrap items-center gap-3">
                                    {/* Session Filter for Breakdown */}
                                    <div className="flex bg-gray-100 p-1 rounded-lg">
                                        <button
                                            onClick={() => setSessionFilter('ALL')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${sessionFilter === 'ALL'
                                                ? 'bg-white text-indigo-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            <Filter className="size-3" />
                                            All Sessions
                                        </button>
                                        <button
                                            onClick={() => setSessionFilter('FN')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${sessionFilter === 'FN' || sessionFilter === '1' || sessionFilter === '2'
                                                ? 'bg-white text-sky-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            <Sun className="size-3" />
                                            FN
                                        </button>
                                        <button
                                            onClick={() => setSessionFilter('AN')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${sessionFilter === 'AN' || sessionFilter === '3' || sessionFilter === '4'
                                                ? 'bg-white text-orange-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            <Sunset className="size-3" />
                                            AN
                                        </button>
                                    </div>

                                    <div className="flex bg-gray-100 p-1 rounded-lg">
                                        <button
                                            onClick={() => setBreakdownModeFilter('ALL')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${breakdownModeFilter === 'ALL'
                                                ? 'bg-white text-indigo-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            <Filter className="size-3" />
                                            All Modes
                                        </button>
                                        <button
                                            onClick={() => setBreakdownModeFilter('NORMAL')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${breakdownModeFilter === 'NORMAL'
                                                ? 'bg-white text-indigo-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            Descriptive
                                        </button>
                                        <button
                                            onClick={() => setBreakdownModeFilter('MCQ')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${breakdownModeFilter === 'MCQ'
                                                ? 'bg-white text-pink-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            MCQ
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {courseStats.filter((course) => {
                                    const inTargetRooms = rooms.some(r => {
                                        const modeMatch = breakdownModeFilter === 'ALL' ? true : breakdownModeFilter === 'MCQ' ? r.examMode === 'MCQ' : (r.examMode || 'NORMAL') === 'NORMAL';
                                        const sessionMatch = isRoomInSession(r, sessionFilter);
                                        return modeMatch && sessionMatch && r.seats.some(s => s.course === course.courseCode);
                                    });
                                    return inTargetRooms;
                                }).map((course) => {
                                    // Calculate room breakdown for this course
                                    const courseRooms: Record<string, number> = {};
                                    rooms.forEach(r => {
                                        if (!isRoomInSession(r, sessionFilter)) return;
                                        const count = r.seats.filter(s => s.course === course.courseCode).length;
                                        if (count > 0) courseRooms[r.roomNumber] = count;
                                    });

                                    return (
                                        <div
                                            key={course.courseCode}
                                            className="bg-white/80 backdrop-blur-xl rounded-xl shadow-sm border border-indigo-100 overflow-hidden hover:shadow-md transition-shadow"
                                        >
                                            <div className="p-6">
                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                                                    <div className="flex items-start gap-4">
                                                        <div className="p-3 rounded-xl border-2" style={generateCourseStyle(course.courseCode)}>
                                                            <span className="font-bold text-lg">{course.courseCode}</span>
                                                        </div>
                                                        <div>
                                                            <h3 className="text-lg font-bold text-gray-900">{course.courseName}</h3>
                                                            <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                                                                <span className="flex items-center gap-1">
                                                                    <Users className="size-4" />
                                                                    {course.allocatedSeats} Students Allocated
                                                                </span>
                                                                <span className="flex items-center gap-1">
                                                                    <div className="w-1 h-1 rounded-full bg-gray-400" />
                                                                    {Object.keys(courseRooms).length} Rooms
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="bg-gray-50 rounded-lg p-4">
                                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Room Breakdown</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {Object.entries(courseRooms).map(([roomNum, count]) => (
                                                            <div key={roomNum} className="flex items-center bg-white border border-gray-200 rounded-md px-3 py-1.5 shadow-sm">
                                                                <span className="font-semibold text-gray-700 mr-2">{roomNum}</span>
                                                                <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                                                                    {count} students
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </motion.div>

                        {/* Export Actions */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                            className="flex gap-4 mb-6"
                        >
                            <button
                                onClick={handleDownloadPDF}
                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/70 backdrop-blur-xl border border-indigo-100 rounded-xl hover:bg-indigo-50 transition-colors cursor-pointer"
                            >
                                <Download className="size-5" />
                                Download PDF
                            </button>
                            <button
                                onClick={handleExportExcel}
                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/70 backdrop-blur-xl border border-indigo-100 rounded-xl hover:bg-green-50 transition-colors cursor-pointer"
                            >
                                <FileSpreadsheet className="size-5" />
                                Export Excel
                            </button>
                            <button
                                onClick={handlePrintView}
                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/70 backdrop-blur-xl border border-indigo-100 rounded-xl hover:bg-blue-50 transition-colors cursor-pointer"
                            >
                                <Printer className="size-5" />
                                Print View
                            </button>
                        </motion.div>
                    </>
                )}

                {/* SEATING PREVIEW VIEW */}
                {activeTab === 'preview' && seatingGenerated && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="space-y-6"
                    >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-wrap items-center gap-4">
                                    <h2 className="text-xl font-semibold text-gray-900">Seating Preview</h2>

                                    {/* Session Filter Buttons */}
                                <div className="flex bg-gray-100 p-1 rounded-lg">
                                    <button
                                        onClick={() => setSessionFilter('ALL')}
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${sessionFilter === 'ALL'
                                            ? 'bg-white text-indigo-600 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        <Filter className="size-3" />
                                        All
                                    </button>
                                    <button
                                        onClick={() => setSessionFilter('FN')}
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${sessionFilter === 'FN' || sessionFilter === '1' || sessionFilter === '2'
                                            ? 'bg-white text-sky-600 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        <Sun className="size-3" />
                                        FN (Session 1 & 2)
                                    </button>
                                    <button
                                        onClick={() => setSessionFilter('AN')}
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${sessionFilter === 'AN' || sessionFilter === '3' || sessionFilter === '4'
                                            ? 'bg-white text-orange-600 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        <Sunset className="size-3" />
                                        AN (Session 3 & 4)
                                    </button>
                                </div>

                                {/* Sub-Filters for FN */}
                                {(sessionFilter === 'FN' || sessionFilter === '1' || sessionFilter === '2') && (
                                    <div className="flex bg-sky-100/50 p-1 rounded-lg animate-in fade-in slide-in-from-top-1">
                                        <button
                                            onClick={() => setSessionFilter('FN')}
                                            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${sessionFilter === 'FN'
                                                ? 'bg-white text-sky-600 shadow-sm ring-1 ring-sky-100'
                                                : 'text-sky-600/70 hover:text-sky-700'
                                                }`}
                                        >
                                            All FN
                                        </button>
                                        <button
                                            onClick={() => setSessionFilter('1')}
                                            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${sessionFilter === '1'
                                                ? 'bg-white text-sky-600 shadow-sm ring-1 ring-sky-100'
                                                : 'text-sky-600/70 hover:text-sky-700'
                                                }`}
                                        >
                                            Session 1
                                        </button>
                                        <button
                                            onClick={() => setSessionFilter('2')}
                                            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${sessionFilter === '2'
                                                ? 'bg-white text-sky-600 shadow-sm ring-1 ring-sky-100'
                                                : 'text-sky-600/70 hover:text-sky-700'
                                                }`}
                                        >
                                            Session 2
                                        </button>
                                    </div>
                                )}

                                {/* Sub-Filters for AN */}
                                {(sessionFilter === 'AN' || sessionFilter === '3' || sessionFilter === '4') && (
                                    <div className="flex bg-orange-100/50 p-1 rounded-lg animate-in fade-in slide-in-from-top-1">
                                        <button
                                            onClick={() => setSessionFilter('AN')}
                                            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${sessionFilter === 'AN'
                                                ? 'bg-white text-orange-600 shadow-sm ring-1 ring-orange-100'
                                                : 'text-orange-600/70 hover:text-orange-700'
                                                }`}
                                        >
                                            All AN
                                        </button>
                                        <button
                                            onClick={() => setSessionFilter('3')}
                                            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${sessionFilter === '3'
                                                ? 'bg-white text-orange-600 shadow-sm ring-1 ring-orange-100'
                                                : 'text-orange-600/70 hover:text-orange-700'
                                                }`}
                                        >
                                            Session 3
                                        </button>
                                        <button
                                            onClick={() => setSessionFilter('4')}
                                            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${sessionFilter === '4'
                                                ? 'bg-white text-orange-600 shadow-sm ring-1 ring-orange-100'
                                                : 'text-orange-600/70 hover:text-orange-700'
                                                }`}
                                        >
                                            Session 4
                                        </button>
                                    </div>
                                )}
                                </div>

                                <div className="flex flex-wrap items-center gap-4">
                                    {/* Exam Mode Filter Buttons */}
                                    <div className="flex bg-gray-100 p-1 rounded-lg">
                                        <button
                                            onClick={() => setExamModeFilter('ALL')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${examModeFilter === 'ALL'
                                                ? 'bg-white text-indigo-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            <Filter className="size-3" />
                                            All Modes
                                        </button>
                                        <button
                                            onClick={() => setExamModeFilter('NORMAL')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${examModeFilter === 'NORMAL'
                                                ? 'bg-white text-indigo-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            Descriptive
                                        </button>
                                        <button
                                            onClick={() => setExamModeFilter('MCQ')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${examModeFilter === 'MCQ'
                                                ? 'bg-white text-pink-600 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            MCQ
                                        </button>
                                    </div>

                                    {/* Separate Counts Display */}
                                    {(() => {
                                        const visibleRooms = rooms.filter(room => isRoomInSession(room, sessionFilter));
                                        const normalRoomsList = visibleRooms.filter(r => (r.examMode || 'NORMAL') === 'NORMAL');
                                        const mcqRoomsList = visibleRooms.filter(r => r.examMode === 'MCQ');
                                        
                                        const normalAlloc = normalRoomsList.reduce((acc, r) => acc + r.seats.length, 0);
                                        const normalTotal = normalRoomsList.reduce((acc, r) => acc + r.totalSeats, 0);
                                        
                                        const mcqAlloc = mcqRoomsList.reduce((acc, r) => acc + r.seats.length, 0);
                                        const mcqTotal = mcqRoomsList.reduce((acc, r) => acc + r.totalSeats, 0);

                                        return (
                                            <div className="flex flex-wrap gap-2 text-xs font-medium">
                                                <div className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-md border border-indigo-100 flex items-center gap-1">
                                                    <span className="font-bold">DESCRIPTIVE:</span>
                                                    <span>{normalAlloc} / {normalTotal} seats</span>
                                                    <span className="text-indigo-500 ml-1">({normalRoomsList.length} rooms)</span>
                                                </div>
                                                <div className="px-3 py-1.5 bg-pink-50 text-pink-700 rounded-md border border-pink-100 flex items-center gap-1">
                                                    <span className="font-bold">MCQ:</span>
                                                    <span>{mcqAlloc} / {mcqTotal} seats</span>
                                                    <span className="text-pink-500 ml-1">({mcqRoomsList.length} rooms)</span>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    onClick={handlePreviewDownloadPDF}
                                    className="flex items-center gap-2 px-4 py-2 bg-white/70 backdrop-blur-xl border border-indigo-100 rounded-lg hover:bg-indigo-50 transition-colors text-sm font-medium cursor-pointer"
                                >
                                    <Download className="size-4" />
                                    PDF
                                </button>
                                <button
                                    onClick={handlePreviewExportExcel}
                                    className="flex items-center gap-2 px-4 py-2 bg-white/70 backdrop-blur-xl border border-indigo-100 rounded-lg hover:bg-green-50 transition-colors text-sm font-medium cursor-pointer"
                                >
                                    <FileSpreadsheet className="size-4" />
                                    Excel
                                </button>
                                <button
                                    onClick={handlePreviewPrintView}
                                    className="flex items-center gap-2 px-4 py-2 bg-white/70 backdrop-blur-xl border border-indigo-100 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium cursor-pointer"
                                >
                                    <Printer className="size-4" />
                                    Print
                                </button>
                            </div>
                        </div>

                        {rooms
                            .filter(room => isRoomInSession(room, sessionFilter))
                            .filter(room => examModeFilter === 'ALL' || (room.examMode || 'NORMAL') === examModeFilter)
                            .map((room) => {
                                const uniqueCourses = Array.from(new Set(room.seats.map(s => s.course))).sort();

                                const courseBreakdown = uniqueCourses.reduce((acc, code) => {
                                    acc[code] = room.seats.filter(s => s.course === code).length;
                                    return acc;
                                }, {} as Record<string, number>);

                                const isFN = room.session === 'FN';
                                const isAN = room.session === 'AN';

                                return (
                                    <div
                                        key={`${room.roomNumber}-${room.displaySession || room.session}-${room.examMode || 'NORMAL'}`}
                                        className={`backdrop-blur-xl rounded-2xl shadow-lg border p-6 transition-colors duration-300 group ${isFN
                                            ? 'bg-sky-50/80 border-sky-200'
                                            : isAN
                                                ? 'bg-orange-50/80 border-orange-200'
                                                : 'bg-white/70 border-indigo-100'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-6">
                                            <div>
                                <h3 className={`text-lg font-bold flex items-center gap-3 ${isFN ? 'text-sky-900' : isAN ? 'text-orange-900' : 'text-gray-900'
                                                    }`}>
                                                    {(() => {
                                                        const currentRoomId = `${room.roomNumber}|${room.displaySession || room.session}|${room.examMode || 'NORMAL'}`;
                                                        return editingRoom === currentRoomId ? (
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={tempRoomName}
                                                                    onChange={(e) => setTempRoomName(e.target.value)}
                                                                    className="px-2 py-1 rounded border border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium w-40"
                                                                    autoFocus
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') handleUpdateRoom(room.roomNumber, room.displaySession || room.session, room.examMode);
                                                                        if (e.key === 'Escape') setEditingRoom(null);
                                                                    }}
                                                                />
                                                                <button 
                                                                    onClick={() => handleUpdateRoom(room.roomNumber, room.displaySession || room.session, room.examMode)}
                                                                    className="p-1 hover:bg-green-100 rounded-full text-green-600 transition-colors"
                                                                >
                                                                    <Check className="size-4" />
                                                                </button>
                                                                <button 
                                                                    onClick={() => setEditingRoom(null)}
                                                                    className="p-1 hover:bg-red-100 rounded-full text-red-600 transition-colors"
                                                                >
                                                                    <X className="size-4" />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                Room {room.roomNumber}
                                                                <button 
                                                                    onClick={() => {
                                                                        setEditingRoom(currentRoomId);
                                                                        setTempRoomName(room.roomNumber);
                                                                    }}
                                                                    className="p-1.5 hover:bg-white/50 rounded-lg text-gray-500 hover:text-indigo-600 transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                                                                >
                                                                    <Pencil className="size-3.5" />
                                                                </button>
                                                            </>
                                                        );
                                                    })()}
                                                        {room.session && (
                                                            <span className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1 ${room.session === 'FN'
                                                                ? 'bg-sky-100 text-sky-700 border-sky-200'
                                                                : 'bg-orange-100 text-orange-700 border-orange-200'
                                                                }`}>
                                                                {room.displaySession ? (room.displaySession.includes('FN') ? '☀️ ' : '🌅 ') + room.displaySession : (room.session === 'FN' ? '☀️ FORENOON' : '🌅 AFTERNOON')}
                                                            </span>
                                                        )}
                                                        <span className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1 ${room.examMode === 'MCQ'
                                                            ? 'bg-pink-100 text-pink-700 border-pink-200'
                                                            : 'bg-indigo-100 text-indigo-700 border-indigo-200'
                                                            }`}>
                                                            {(!room.examMode || room.examMode === 'NORMAL') ? 'DESCRIPTIVE' : room.examMode}
                                                        </span>
                                                    </h3>
                                                    <p className="text-sm text-gray-600 mt-1">
                                                        Total Seats: {room.seats.length} | Allocated: {room.seats.length}
                                                    </p>
                                            </div>
                                        </div>

                                        {/* Course Breakdown Stats */}
                                        <div className="mb-6 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                                            <h4 className="font-semibold text-gray-900 mb-3">Course Breakdown in {room.roomNumber}</h4>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                {uniqueCourses.map((code) => {
                                                    const courseStat = courseStats.find(c => c.courseCode === code);
                                                    return (
                                                        <div key={code} className="text-center">
                                                            <div className="rounded-lg p-2 mb-2 border" style={generateCourseStyle(code)}>
                                                                <div className="font-bold text-lg">{code}</div>
                                                                <div className="text-xs">{courseStat?.courseName || code}</div>
                                                            </div>
                                                            <div className="text-sm font-semibold text-gray-700">
                                                                {courseBreakdown[code]} students
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>

                                        {/* Row and Column Labels Grid */}
                                        <div className="max-w-5xl mx-auto overflow-x-auto pb-4">
                                            {/* Column Headers */}
                                            <div className="flex mb-2 ml-12">
                                                <div className="flex-1 grid gap-3" style={{ gridTemplateColumns: `repeat(${room.columns}, minmax(120px, 1fr))` }}>
                                                    {Array.from({ length: room.columns }).map((_, idx) => (
                                                        <div key={`col-${idx}`} className="text-center text-sm font-bold text-gray-600">
                                                            Col {idx + 1}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Main Grid with Row Labels */}
                                            {Array.from({ length: room.rows }).map((_, rowIdx) => {
                                                const currentRow = rowIdx + 1;
                                                return (
                                                    <div key={`row-${currentRow}`} className="flex items-center mb-3">
                                                        {/* Row Label */}
                                                        <div className="w-12 text-center text-sm font-bold text-gray-600 mr-2">
                                                            Row {currentRow}
                                                        </div>

                                                        {/* Seats in this row */}
                                                        <div className="flex-1 grid gap-3" style={{ gridTemplateColumns: `repeat(${room.columns}, minmax(120px, 1fr))` }}>
                                                            {Array.from({ length: room.columns }).map((_, colIdx) => {
                                                                const currentCol = colIdx + 1;
                                                                const seat = room.seats.find(s => s.row === currentRow && s.col === currentCol);

                                                                if (!seat) {
                                                                    return (
                                                                        <div
                                                                            key={`${currentRow}-${currentCol}`}
                                                                            className="border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center bg-gray-50/50 p-4 min-h-[90px]"
                                                                            title={`Row ${currentRow}, Col ${currentCol} (Empty)`}
                                                                        >
                                                                            <span className="text-sm text-gray-400 font-medium">Empty</span>
                                                                        </div>
                                                                    );
                                                                }

                                                                return (
                                                                    <div
                                                                        key={`${seat.row}-${seat.col}`}
                                                                        className="border-2 rounded-xl p-4 text-center flex flex-col items-center justify-center shadow-md transition-all hover:scale-105 hover:shadow-lg min-h-[90px] relative"
                                                                        style={generateCourseStyle(seat.course)}
                                                                        title={`Row ${seat.row}, Col ${seat.col} - ${seat.course} - ${seat.student} - ${seat.session || 'N/A'}`}
                                                                    >

                                                                        <div className="font-extrabold text-gray-900 text-base leading-tight mb-1">{seat.student}</div>
                                                                        <div className="font-bold text-sm opacity-90">{seat.course}</div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                    </motion.div>
                )}
            </div>
        </div >
    );
}