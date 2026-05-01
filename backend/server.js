require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const companyDataRoutes = require("./routes/companyData");
const logsRoutes = require("./routes/logs");
const syncRoutes = require("./routes/sync");
const cultivationRoutes = require("./routes/cultivation");
const migrateRoutes = require("./routes/migrate");
const sourceBatchRoutes = require("./routes/sourceBatches");
const extractionRoutes = require("./routes/extraction");
const packagingRoutes = require("./routes/packaging");
const configRoutes = require("./routes/config");

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://10.0.0.170:3000",
  "http://10.0.0.170:3001",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Company-Id"],
  })
);


app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Cannabis CPU Backend",
    time: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/data", companyDataRoutes);
app.use("/api/logs", logsRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/cultivation", cultivationRoutes);
app.use("/api/migrate", migrateRoutes);
app.use("/api/source-batches", sourceBatchRoutes);
app.use("/api/extraction", extractionRoutes);
app.use("/api/packaging", packagingRoutes);
app.use("/api/config", configRoutes);

const port = process.env.PORT || 4000;

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Cannabis CPU backend running on http://localhost:${port}`);
  console.log(`Network backend available at http://10.0.0.170:${port}`);
});

server.on("error", (error) => {
  console.error("Backend server error:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

setInterval(() => {}, 1000);