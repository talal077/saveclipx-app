import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import { isValidXUrl } from "../lib/validators";

const router: IRouter = Router();

function formatFilesize(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function runYtDlpInfo(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "--dump-json",
      "--no-playlist",
      "--no-warnings",
      url,
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Extraction timed out after 30 seconds"));
    }, 30_000);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || "yt-dlp extraction failed"));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
      } catch {
        reject(new Error("Failed to parse extraction output"));
      }
    });
  });
}

router.post("/x-video", async (req, res): Promise<void> => {
  const body = req.body as { url?: unknown };
  const url = body.url;

  if (!url || typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "ضع رابط X صحيح", code: "MISSING_URL" });
    return;
  }

  const trimmedUrl = url.trim();

  if (!isValidXUrl(trimmedUrl)) {
    res.status(400).json({
      error: "ضع رابط X صحيح (x.com أو twitter.com فقط)",
      code: "INVALID_URL",
    });
    return;
  }

  try {
    req.log.info({ url: trimmedUrl }, "Extracting video info with yt-dlp");
    const info = await runYtDlpInfo(trimmedUrl);

    const rawFormats = (info.formats as Array<Record<string, unknown>>) ?? [];

    // Keep only real video streams — filter out audio-only and storyboards.
    // Critically: we do NOT expose the raw CDN/HLS URLs to the client;
    // only the formatId is returned so the client must use POST /api/download.
    const seen = new Set<string>();
    const formats: Array<{
      formatId: string;
      quality: string;
      ext: string;
      filesize: string | null;
      height: number | null;
    }> = [];

    const sorted = rawFormats
      .filter(
        (f) =>
          f.vcodec &&
          f.vcodec !== "none" &&
          // skip audio-only
          f.height,
      )
      .sort(
        (a, b) => ((b.height as number) || 0) - ((a.height as number) || 0),
      );

    for (const f of sorted) {
      const quality = `${f.height}p`;
      if (seen.has(quality)) continue;
      seen.add(quality);

      formats.push({
        formatId: f.format_id as string,
        quality,
        ext: (f.ext as string) || "mp4",
        filesize: formatFilesize(
          (f.filesize as number) || (f.filesize_approx as number),
        ),
        height: (f.height as number) || null,
      });
    }

    if (formats.length === 0) {
      res.status(400).json({
        error: "لم يتم العثور على فيديو في هذا الرابط.",
        code: "NO_FORMATS",
      });
      return;
    }

    res.json({
      success: true,
      title:
        (info.title as string) ||
        (info.description as string) ||
        "X Video",
      thumbnail: (info.thumbnail as string) || null,
      duration: formatDuration(info.duration as number),
      uploader:
        (info.uploader as string) ||
        (info.uploader_id as string) ||
        null,
      formats,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg }, "yt-dlp extraction failed");

    if (
      msg.includes("private") ||
      msg.includes("not available") ||
      msg.includes("unavailable") ||
      msg.includes("does not exist")
    ) {
      res.status(400).json({
        error: "هذه التغريدة خاصة أو غير متاحة.",
        code: "UNAVAILABLE",
      });
      return;
    }

    if (msg.includes("timed out")) {
      res.status(408).json({
        error: "حاول مرة أخرى لاحقًا.",
        code: "TIMEOUT",
      });
      return;
    }

    if (
      msg.includes("Unsupported URL") ||
      msg.includes("not a video") ||
      msg.includes("No video formats")
    ) {
      res.status(400).json({
        error: "لم يتم العثور على فيديو في هذا الرابط.",
        code: "UNSUPPORTED",
      });
      return;
    }

    res.status(500).json({
      error: "تعذر استخراج الفيديو. حاول مرة أخرى.",
      code: "EXTRACTION_FAILED",
    });
  }
});

export default router;
