import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Search } from 'lucide-react';

export function Home() {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
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
        className="relative z-10 max-w-4xl w-full p-4"
      >
        <div className="text-center mb-12">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring' }}
            className="inline-flex mb-6"
          >
            <img src="/logo.png" alt="University Logo" className="size-32 object-contain drop-shadow-xl" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-4xl font-bold text-gray-900 mb-4 drop-shadow-sm"
          >
            Exam Seating Portal
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-lg text-gray-800 font-medium"
          >
            Seamless exam seat allocation and lookup system
          </motion.p>
        </div>

        <div className="flex justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="w-full max-w-md"
          >
            <Link
              to="/student"
              className="block group"
            >
              <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 p-8 hover:shadow-2xl hover:scale-105 transition-all">
                <div className="p-3 bg-indigo-100 rounded-xl w-fit mb-4 group-hover:bg-indigo-200 transition-colors">
                  <Search className="size-8 text-indigo-600" />
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">Student Lookup</h2>
                <p className="text-gray-600 italic">
                  Find your exam seat using your register number
                </p>
                <div className="mt-4 flex items-center text-indigo-600 group-hover:translate-x-2 transition-transform">
                  <span className="font-medium">Find your seat</span>
                  <span className="ml-2">→</span>
                </div>
              </div>
            </Link>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-12 text-center"
        >
          {/* Footer content if needed */}
        </motion.div>
      </motion.div>
    </div>
  );
}
