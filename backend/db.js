const mysql = require("mysql2");

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "exam_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

pool.getConnection((err, connection) => {
  if (err) {
    console.error("DB Connection Failed :", err);
  } else {
    console.log("MySQL Connected (Pool)");
    // Optimize: Add Index on reg_no if not exists
    connection.query("CREATE INDEX IF NOT EXISTS idx_reg_no ON exam_allocation (reg_no)", (idxErr) => {
      if (!idxErr) console.log("Index verified on reg_no");
      connection.release();
    });
  }
});

module.exports = pool;


