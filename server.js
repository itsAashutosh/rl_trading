const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const app = express();
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json());
["uploads", "models", "results"].forEach(dir => {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});
const upload = multer({ dest: path.join(__dirname, "uploads") });
const DATA_FILE = path.join(__dirname, "uploaded_data.csv");
const QTABLE_FILE = path.join(__dirname, "models", "q_table.pkl");
const RESULTS_JSON = path.join(__dirname, "results", "results.json");
let trainingState = {
  is_training: false,
  current_episode: 0,
  total_episodes: 0,
  progress: 0,
  results: null,
  lastError: null
};
app.post("/upload-csv", upload.single("file"), (req, res) => {
  try {
    console.log("upload-csv: file?", !!req.file, req.file && {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }
    fs.renameSync(req.file.path, DATA_FILE);
    console.log("upload-csv: saved to", DATA_FILE);
    const content = fs.readFileSync(DATA_FILE, "utf-8");
    const firstLine = (content.split(/\r?\n/).find(l => l.trim().length > 0) || "");
    console.log("upload-csv: firstLine:", JSON.stringify(firstLine));
    if (!firstLine.includes("Close")) {
      return res.status(400).json({ error: "'Close' column missing in header" });
    }
    return res.json({ message: "CSV uploaded successfully", path: DATA_FILE });
  } catch (err) {
    try { if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    console.error("upload-csv error:", err);
    return res.status(500).json({ error: "Upload failed", detail: String(err) });
  }
});
app.post("/start-training", (req, res) => {
  if (fs.existsSync(RESULTS_JSON)) {
    try { fs.unlinkSync(RESULTS_JSON); } catch {}
  }
  const DEFAULT_PARAMS = {
    initialBalance: 10000,
    episodes: 1000,
    learningRate: 0.1,
    gamma: 0.95,
    epsilon: 1.0,
    epsilonDecay: 0.995
  };
  const user = req.body || {};
  const merged = { ...DEFAULT_PARAMS, ...Object.fromEntries(Object.entries(user).filter(([, v]) => v != null)) };
  trainingState.is_training = true;
  trainingState.progress = 0;
  trainingState.current_episode = 0;
  trainingState.total_episodes = Number.isFinite(merged.episodes) ? merged.episodes : DEFAULT_PARAMS.episodes;
  trainingState.results = null;
  trainingState.lastError = null;
  const PYTHON_BIN = process.env.PYTHON_BIN || "python";
  const pythonParams = { ...merged, dataPath: DATA_FILE };
  const child = spawn(PYTHON_BIN, ["-u", "main.py", JSON.stringify(pythonParams)], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: path.resolve(__dirname)
  });
  child.stdout.on("data", (data) => {
    const text = data.toString().trim();
    text.split(/\r?\n/).forEach((line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.event === "progress") {
          trainingState.current_episode = Number(msg.episode) || trainingState.current_episode;
          const tot = Number(msg.total) || trainingState.total_episodes || 1;
          trainingState.total_episodes = tot;
          trainingState.progress = Math.max(0, Math.min(100, Math.round((trainingState.current_episode / tot) * 100)));
        } else if (msg.event === "wrote_results") {
          trainingState.is_training = false;
          trainingState.progress = 100;
          console.log("Python wrote results:", msg.path);
        }
      } catch {
      }
    });
  });
  child.stderr.on("data", (data) => {
    const msg = data.toString();
    console.error("Python error:", msg);
    trainingState.lastError = msg;
  });
  child.on("close", (code) => {
    trainingState.is_training = false;
    console.log("Python exited with code", code);
    console.log("Expecting results at:", RESULTS_JSON, "exists?", fs.existsSync(RESULTS_JSON));
    console.log("Server __dirname:", __dirname, "process.cwd():", process.cwd());
    if (fs.existsSync(RESULTS_JSON)) {
      try {
        const results = JSON.parse(fs.readFileSync(RESULTS_JSON, "utf-8"));
        trainingState.results = results;
        trainingState.progress = 100;
        trainingState.current_episode = results.episodesCompleted || trainingState.total_episodes || 0;
      } catch (e) {
        trainingState.lastError = String(e);
      }
    } else if (!trainingState.lastError) {
      trainingState.lastError = `Python exited with code ${code}, and no results.json found.`;
    }
  });
  return res.json({ message: "Training started" });
});
app.get("/training-status", (_req, res) => {
  if (!trainingState.results && fs.existsSync(RESULTS_JSON)) {
    try {
      trainingState.results = JSON.parse(fs.readFileSync(RESULTS_JSON, "utf-8"));
      trainingState.progress = 100;
      trainingState.current_episode = trainingState.results.episodesCompleted || trainingState.total_episodes || 0;
    } catch (e) {
      trainingState.lastError = String(e);
    }
  }
  return res.json(trainingState);
});
app.get("/training-results", (_req, res) => {
  if (!fs.existsSync(RESULTS_JSON)) {
    return res.status(202).json({ status: "pending", lastError: "results.json not present yet" });
  }
  try {
    const results = JSON.parse(fs.readFileSync(RESULTS_JSON, "utf-8"));
    return res.json(results);
  } catch (e) {
    return res.status(500).json({ error: "Failed to read results.json", detail: String(e) });
  }
});
app.get("/download-qtable", (_req, res) => {
  if (!fs.existsSync(QTABLE_FILE)) {
    return res.status(404).json({ error: "Q-table not found" });
  }
  return res.download(QTABLE_FILE);
});
const PORT = process.env.PORT ? Number(process.env.PORT) : 5052;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));