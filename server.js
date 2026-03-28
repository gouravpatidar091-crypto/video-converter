const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

ffmpeg.setFfmpegPath("ffmpeg");

const app = express();
const PORT = process.env.PORT || 3000;
const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
console.log("FFmpeg path:", ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const UPLOADS_DIR = path.join(ROOT, "uploads");
const OUTPUTS_DIR = path.join(ROOT, "outputs");
const PUBLIC_DIR = path.join(ROOT, "public");

[UPLOADS_DIR, OUTPUTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use("/outputs", express.static(OUTPUTS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, "upload_" + uuidv4() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error("Unsupported file type: " + ext));
  },
});

const jobs = new Map();

const RESOLUTIONS = {
  "480p": { w: 854, h: 480 },
  "720p": { w: 1280, h: 720 },
  "1080p": { w: 1920, h: 1080 },
  original: null,
};

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    ffmpeg: ffmpegInstaller.path,
    ffmpegVersion: ffmpegInstaller.version,
  });
});

app.post("/api/convert", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const format = req.body.format || "mp4";
  const resolution = req.body.resolution || "original";
  const jobId = uuidv4();
  const outputFilename = "converted_" + jobId + "." + format;
  const outputPath = path.join(OUTPUTS_DIR, outputFilename);

  console.log("Job started:", jobId, format, resolution);
  console.log("Input file:", req.file.path);
  console.log("Output file:", outputPath);

  jobs.set(jobId, {
    status: "processing",
    progress: 0,
    outputFile: outputFilename,
    error: null,
  });

  const resConfig = RESOLUTIONS[resolution] || null;

  let cmd = ffmpeg(req.file.path)
    .on("start", (cmdLine) => {
      console.log("FFmpeg command:", cmdLine);
    })
    .on("progress", (p) => {
      const job = jobs.get(jobId);
      if (job) {
        job.progress = Math.min(Math.round(p.percent || 0), 99);
        console.log("Progress:", job.progress + "%");
      }
    })
    .on("end", () => {
      console.log("Conversion done:", jobId);
      const job = jobs.get(jobId);
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        job.status = "error";
        job.error = "Output file is empty";
        console.log("Error: output file empty");
        return;
      }
      job.status = "done";
      job.progress = 100;
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      setTimeout(() => {
        try { fs.unlinkSync(outputPath); } catch (e) {}
        jobs.delete(jobId);
      }, 60 * 60 * 1000);
    })
    .on("error", (err, stdout, stderr) => {
      console.log("FFmpeg error:", err.message);
      console.log("stderr:", stderr);
      const job = jobs.get(jobId);
      if (job) {
        job.status = "error";
        job.error = err.message;
      }
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    });

  if (format === "mp4") {
    cmd.videoCodec("libx264").audioCodec("aac")
      .outputOptions(["-crf 23", "-preset fast", "-pix_fmt yuv420p", "-movflags +faststart"]);
  } else if (format === "webm") {
    cmd.videoCodec("libvpx-vp9").audioCodec("libopus")
      .outputOptions(["-crf 33", "-b:v 0", "-deadline realtime"]);
  } else if (format === "avi") {
    cmd.videoCodec("libxvid").audioCodec("mp3")
      .outputOptions(["-qscale:v 3"]);
  }

  if (resConfig) {
    cmd.videoFilters("scale=" + resConfig.w + ":-2");
  }

  cmd.save(outputPath);

  res.json({ jobId, message: "Conversion started" });
});

app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const r = {
    status: job.status,
    progress: job.progress,
    error: job.error,
  };
  if (job.status === "done") {
    r.downloadUrl = "/outputs/" + job.outputFile;
    r.filename = job.outputFile;
  }
  res.json(r);
});

app.get("/api/download/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(OUTPUTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.download(filePath);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  console.log("Express error:", err.message);
  res.status(400).json({ error: err.message });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running at http://localhost:" + PORT);
  console.log("FFmpeg:", ffmpegInstaller.path);
});
