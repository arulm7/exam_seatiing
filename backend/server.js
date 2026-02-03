const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const db = require("./db");

const app = express();
app.use(cors());

app.use("/api", require("./seatingRoutes"));

// Daily Cron Job at Midnight to Clear Expired Seating
cron.schedule("0 0 * * *", async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [rows] = await db.promise().query("SELECT DISTINCT exam_date FROM exam_allocation LIMIT 1");
    if (rows.length > 0) {
      const examDate = new Date(rows[0].exam_date);
      examDate.setHours(0, 0, 0, 0);

      if (examDate < today) {
        console.log("Cron: Auto-truncating expired seating data...");
        await db.promise().query("DELETE FROM exam_allocation");
        await db.promise().query("DELETE FROM allocation_warnings");
      }
    }
  } catch (err) {
    console.error("Cron Auto-truncate error:", err);
  }
});
// Serve static files from the React app
const path = require("path");
app.use(express.static(path.join(__dirname, "../dist")));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
