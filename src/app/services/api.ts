/// <reference types="vite/client" />

export const API_URL = import.meta.env.PROD ? '/api' : 'http://localhost:3001/api';

export interface GenerationResponse {
    status: string;
    message: string;
    data: {
        summary: {
            totalStudents: number;
            totalRooms: number;
            totalCourses: number;
            totalInputStudents?: number;
            unallocatedCount?: number;
            utilizationRate?: number;
            examType?: string;
            examDate?: string;
        };
        courseStats: Array<{
            courseCode: string;
            courseName: string;
            allocatedSeats: number;
            totalStudents?: number;
            unallocated?: number;
        }>;
        rooms: Array<{
            roomNumber: string;
            totalSeats: number;
            rows: number;
            columns: number;
            seats: Array<{
                row: number;
                col: number;
                course: string;
                student: string;
            }>;
        }>;
        warnings?: Array<{
            type: string;
            course?: string;
            courseName?: string;
            message: string;
            count?: number;
            utilizationRate?: number;
        }>;
        unallocatedStudents?: Array<{
            regNo: string;
            name: string;
            course: string;
            courseName: string;
            session: string;
        }>;
    };
}

export async function generateSeatingPlan(formData: FormData): Promise<GenerationResponse> {
    const response = await fetch(`${API_URL}/generate-seating`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Seating generation failed');
    }

    return response.json();
}

export interface StudentSeating {
    student_name: string;
    course_code: string;
    course_name: string;
    session: string;
    exam_date: string;
    exam_type: string;
    room: string;
    seat_row: number;
    seat_column: number;
}

export async function lookupStudentSeat(regNo: string): Promise<StudentSeating[]> {
    const response = await fetch(`${API_URL}/student/${regNo}`);

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Student not found');
        }
        const errorData = await response.json();
        throw new Error(errorData.message || 'Lookup failed');
    }

    return response.json();
}

export interface SeatingStatusResponse {
    hasData: boolean;
    data?: GenerationResponse['data'];
}

export async function fetchCurrentSeating(): Promise<SeatingStatusResponse> {
    const response = await fetch(`${API_URL}/current-seating`);
    if (!response.ok) {
        throw new Error('Failed to fetch seating status');
    }
    return response.json();
}

export async function clearSeatingPlan(date: string, type: string): Promise<{ message: string; deletedCount: number }> {
    const params = new URLSearchParams({ date, type });
    const response = await fetch(`${API_URL}/clear-seating?${params}`, {
        method: 'DELETE',
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to clear seating data');
    }

    return response.json();
}

export interface ViewSeatingResponse {
    found: boolean;
    message?: string;
    data?: GenerationResponse['data'];
}

export async function searchSeatingPlan(date: string, type: string): Promise<ViewSeatingResponse> {
    const params = new URLSearchParams({ date, type });
    const response = await fetch(`${API_URL}/view-seating?${params}`);

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Failed to search seating plan');
    }

    return response.json();
}
