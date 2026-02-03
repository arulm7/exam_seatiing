import { useState } from 'react';
import { motion } from 'motion/react';
import { Search, MapPin, Calendar, BookOpen, Users } from 'lucide-react';

import { lookupStudentSeat, StudentSeating } from '../services/api';

interface SeatResult extends StudentSeating { }

export function StudentLookup() {
  const [registerNumber, setRegisterNumber] = useState('');
  const [results, setResults] = useState<StudentSeating[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<StudentSeating | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerNumber.trim()) return;

    setLoading(true);
    setNotFound(false);
    setError('');
    setResults([]);
    setSelectedPlan(null);

    try {
      const data = await lookupStudentSeat(registerNumber.trim());
      setResults(data);
    } catch (err: any) {
      if (err.message === 'Student not found') {
        setNotFound(true);
      } else {
        setError(err.message || 'An error occurred while searching');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex items-center justify-center overflow-hidden">
      {/* Background Image with Overlay */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat z-0"
        style={{ backgroundImage: "url('/background.jpg')" }}
      />
      <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-0" />

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 w-full max-w-2xl p-4"
      >
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex p-3 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl mb-4">
              <Search className="size-8 text-white" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900">Find Your Exam Seat</h2>
            <p className="text-gray-600 mt-2">Enter your register number to locate your assigned seat</p>
          </div>

          <form onSubmit={handleSearch} className="space-y-6">
            <div className="flex flex-col gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
                <input
                  id="registerNumber"
                  type="text"
                  value={registerNumber}
                  onChange={(e) => setRegisterNumber(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="Enter Register Number"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full px-8 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-xl hover:from-indigo-600 hover:to-violet-700 transition-all disabled:opacity-50 font-semibold shadow-lg shadow-indigo-100"
              >
                {loading ? 'Searching...' : 'Find'}
              </button>
            </div>
          </form>

          {notFound && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-6 bg-red-50 border border-red-200 rounded-xl text-center"
            >
              <p className="text-red-700">
                No seat allocation found for: <span className="font-semibold">{registerNumber}</span>
              </p>
            </motion.div>
          )}

          {results.length > 0 && !selectedPlan && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 space-y-6"
            >
              <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50 flex items-center gap-3">
                <div className="size-10 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold">
                  {results[0].student_name.charAt(0)}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Candidate Profile</p>
                  <p className="text-lg font-bold text-gray-900">{results[0].student_name}</p>
                </div>
              </div>

              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 px-1">
                <Calendar className="size-5 text-indigo-600" />
                Select Your Exam
              </h3>
              <div className="grid gap-4">
                {results.map((plan, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedPlan(plan)}
                    className="w-full text-left p-5 bg-white border border-gray-100 rounded-xl hover:border-indigo-400 hover:shadow-md transition-all group relative overflow-hidden"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 transform -translate-x-full group-hover:translate-x-0 transition-transform" />
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">
                          {plan.course_name}
                        </p>
                        <p className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                          <span className="font-medium text-indigo-500">{plan.course_code}</span>
                          <span>•</span>
                          <span>{formatDate(plan.exam_date)}</span>
                          <span>•</span>
                          <span className="bg-gray-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase">{plan.session}</span>
                        </p>
                        <p className="text-xs text-gray-400 mt-2 font-medium italic">{plan.exam_type}</p>
                      </div>
                      <div className="p-2 bg-gray-50 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-all">
                        <Search className="size-5" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {selectedPlan && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-8 space-y-6"
            >
              <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl">
                <button
                  onClick={() => setSelectedPlan(null)}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  ← Back to Exams
                </button>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Seating Details</span>
              </div>

              {/* Header Section */}
              <div className="p-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl text-white shadow-xl shadow-indigo-100">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-sm font-medium opacity-80 mb-1">{selectedPlan.exam_type}</p>
                    <h3 className="text-2xl font-bold">{selectedPlan.course_name}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">Candidate Name</p>
                    <p className="text-lg font-bold">{selectedPlan.student_name}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm font-medium">
                  <div className="flex items-center gap-1.5 bg-white/20 px-3 py-1 rounded-full">
                    <Calendar className="size-4" />
                    {formatDate(selectedPlan.exam_date)}
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/20 px-3 py-1 rounded-full">
                    <Users className="size-4" />
                    {/* Use backend formatted display if available, else raw session */}
                    {(selectedPlan as any).display_session || selectedPlan.session}
                    {(selectedPlan as any).exam_time && (
                      <span className="ml-1 opacity-90 font-light border-l border-white/30 pl-2">
                        {(selectedPlan as any).exam_time}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/20 px-3 py-1 rounded-full">
                    <BookOpen className="size-4" />
                    {selectedPlan.course_code}
                  </div>
                </div>
              </div>

              {/* Seat Location Card - Simple Style */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                  <MapPin className="size-5 text-indigo-600" />
                  <h4 className="font-bold text-gray-900">Your Seating</h4>
                </div>

                <div className="p-8 space-y-8">
                  {/* Room on its own line */}
                  <div className="text-center pb-6 border-b border-gray-50">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Room Seating</p>
                    <p className="text-6xl font-black text-indigo-600 tracking-tight">{selectedPlan.room}</p>
                  </div>

                  {/* Row and Column side by side */}
                  <div className="grid grid-cols-2 gap-8">
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Row Number</p>
                      <p className="text-4xl font-black text-gray-900">{selectedPlan.seat_row}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Column ID</p>
                      <p className="text-4xl font-black text-gray-900">{selectedPlan.seat_column}</p>
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                    <p className="text-sm text-gray-500">
                      Report to the room <span className="font-semibold text-gray-700">15 minutes</span> before the exam starts.
                    </p>
                  </div>
                </div>

                <div className="px-6 py-3 bg-emerald-50 text-emerald-700 text-xs font-bold text-center border-t border-emerald-100 flex items-center justify-center gap-2">
                  <div className="size-1.5 bg-emerald-500 rounded-full" />
                  Seating Verified
                </div>
              </div>
            </motion.div>
          )}

          {/* {!selectedPlan && results.length === 0 && (
            <div className="mt-8 grid grid-cols-2 gap-4 opacity-50">
              <div className="border border-dashed border-indigo-200 rounded-xl p-4 flex flex-col items-center justify-center gap-2">
                <BookOpen className="size-6 text-indigo-300" />
                <p className="text-[10px] uppercase font-bold text-indigo-400">All Exams</p>
              </div>
              <div className="border border-dashed border-indigo-200 rounded-xl p-4 flex flex-col items-center justify-center gap-2">
                <MapPin className="size-6 text-indigo-300" />
                <p className="text-[10px] uppercase font-bold text-indigo-400">Instant Locating</p>
              </div>
            </div>
          )} */}
          {/* <div className="mt-8 p-4 bg-indigo-50/50 rounded-xl">
            <p className="text-[10px] text-gray-500 text-center uppercase font-bold tracking-widest mb-1">Sample Register Numbers</p>
            <div className="flex justify-center gap-3">
              <span className="text-xs text-indigo-600 font-medium">2021CS001</span>
              <span className="text-xs text-gray-300">|</span>
              <span className="text-xs text-indigo-600 font-medium">2021CS002</span>
              <span className="text-xs text-gray-300">|</span>
              <span className="text-xs text-indigo-600 font-medium">2021EE001</span>
            </div>
          </div> */}
        </div>
      </motion.div>
    </div>
  );
}

