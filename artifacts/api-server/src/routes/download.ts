import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import { mkdir, unlink, readdir, stat } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { isValidXUrl } from "../lib/validators";

const router: IRouter = Router();

const DOWNLOAD_DIR = join(tmpdir(), "x-downloads");

async function ensureDownloadDir(): Promise<void> {
  await mkdir(DOWNLOAD_DIR, { recursive: true });
}

async function runYtDlpDownload(
  postUrl: string,
  formatId: string,
  outputTemplate: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "--format",
      `${formatId}+bestaudio/${formatId}/best`,
      "--merge-output-format",
      "mp4",
      "--no-playlist",
      "--no-warnings",
      "--add-header",
      "Referer:https://x.com/",
      "--add-header",
      "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--output",
      outputTemplate,
      postUrl,
    ];

    const proc = spawn("yt-dlp", args);
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Download timed out"));
    }, 120_000);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || "yt-dlp download failed"));
      } else {
        resolve();
      }
    });
  });
}

async function handleDownload(
  req: Request,
  res: Response,
  postUrl: string,
  formatId: string,
): Promise<void> {
  if (!postUrl || typeof postUrl !== "string" || !postUrl.trim()) {
    res.status(400).json({ error: "ضع رابط X صحيح", code: "MISSING_URL" });
    return;
  }

  if (!isValidXUrl(postUrl.trim())) {
    res.status(400).json({
      error: "ضع رابط X صحيح (x.com أو twitter.com فقط)",
      code: "INVALID_URL",
    });
    return;
  }

  if (!formatId || typeof formatId !== "string" || !formatId.trim()) {
    res
      .status(400)
      .json({ error: "معرّف الجودة مطلوب", code: "MISSING_FORMAT" });
    return;
  }

  await ensureDownloadDir();

  const outputId = randomUUID();
  const outputTemplate = join(DOWNLOAD_DIR, `${outputId}.%(ext)s`);
  let outputPath: string | null = null;

  try {
    req.log.info({ formatId, outputId }, "Starting server-side yt-dlp download");
    await runYtDlpDownload(postUrl.trim(), formatId.trim(), outputTemplate);

    // Discover the actual output file (yt-dlp picks the extension)
    const files = await readdir(DOWNLOAD_DIR);
    const match = files.find((f) => f.startsWith(outputId));
    if (!match) {
      throw new Error("Output file not found after download");
    }
    outputPath = join(DOWNLOAD_DIR, match);

    const fileStats = await stat(outputPath);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="x-video.mp4"');
    res.setHeader("Content-Length", fileStats.size);
    res.setHeader("Cache-Control", "no-store");

    const fileStream = createReadStream(outputPath);

    const cleanup = () => {
      if (outputPath) {
        unlink(outputPath).catch(() => {});
        outputPath = null;
      }
    };

    fileStream.on("end", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);

    fileStream.pipe(res);
    req.log.info({ outputId }, "Streaming MP4 to client");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg, outputId }, "Download failed");

    if (outputPath) {
      unlink(outputPath).catch(() => {});
    }

    if (res.headersSent) return;

    if (msg.includes("timed out")) {
      res.status(408).json({
        error: "تحميل الفيديو استغرق وقتاً طويلاً. حاول مرة أخرى.",
        code: "TIMEOUT",
      });
      return;
    }

    if (
      msg.includes("private") ||
      msg.includes("unavailable") ||
      msg.includes("not available")
    ) {
      res.status(400).json({
        error: "هذه التغريدة خاصة أو غير متاحة.",
        code: "UNAVAILABLE",
      });
      return;
    }

    if (
      msg.includes("Unsupported URL") ||
      msg.includes("not a video") ||
      msg.includes("No video")
    ) {
      res.status(400).json({
        error: "لم يتم العثور على فيديو في هذا الرابط.",
        code: "NO_VIDEO",
      });
      return;
    }

    res.status(500).json({
      error: "تعذر تحميل الفيديو. حاول مرة أخرى.",
      code: "DOWNLOAD_FAILED",
    });
  }
}

/**
 * POST /api/download
 * Used by the web frontend — receives JSON body, streams MP4 as blob.
 */
router.post("/download", async (req, res): Promise<void> => {
  const body = req.body as { url?: unknown; formatId?: unknown };
  const postUrl = typeof body.url === "string" ? body.url : "";
  const formatId = typeof body.formatId === "string" ? body.formatId : "";
  await handleDownload(req, res, postUrl, formatId);
});

/**
 * GET /api/download
 * Used by native mobile — Linking.openURL triggers the browser to handle
 * the Content-Disposition: attachment response directly.
 */
router.get("/download", async (req, res): Promise<void> => {
  const postUrl =
    typeof req.query.url === "string"
      ? decodeURIComponent(req.query.url)
      : "";
  const formatId =
    typeof req.query.formatId === "string" ? req.query.formatId : "";
  await handleDownload(req, res, postUrl, formatId);
});

export default router;
