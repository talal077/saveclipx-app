import { Router, type IRouter } from "express";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const router: IRouter = Router();

const ALLOWED_VIDEO_HOSTS = [
  "video.twimg.com",
  "pbs.twimg.com",
  "ton.twitter.com",
  "video.xx.fbcdn.net",
];

function isSafeVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      ALLOWED_VIDEO_HOSTS.some(
        (host) =>
          parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

router.get("/download-file", async (req, res): Promise<void> => {
  const rawUrl = req.query.url;
  const filename =
    typeof req.query.filename === "string"
      ? req.query.filename.replace(/[^a-z0-9._-]/gi, "_")
      : "x-video.mp4";

  if (!rawUrl || typeof rawUrl !== "string") {
    res.status(400).json({ error: "Missing url parameter", code: "MISSING_URL" });
    return;
  }

  let videoUrl: string;
  try {
    videoUrl = decodeURIComponent(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid url encoding", code: "INVALID_URL" });
    return;
  }

  if (!isSafeVideoUrl(videoUrl)) {
    res.status(400).json({
      error: "URL not allowed. Only X/Twitter CDN video URLs are permitted.",
      code: "FORBIDDEN_URL",
    });
    return;
  }

  try {
    req.log.info({ filename }, "Proxying video download");

    const upstream = await fetch(videoUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://x.com/",
        Origin: "https://x.com",
      },
    });

    if (!upstream.ok) {
      req.log.warn({ status: upstream.status }, "Upstream video fetch failed");
      res.status(502).json({
        error: "Failed to fetch video from source. It may have expired.",
        code: "UPSTREAM_ERROR",
      });
      return;
    }

    const contentType =
      upstream.headers.get("content-type") || "video/mp4";
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.setHeader("Cache-Control", "no-store");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    if (!upstream.body) {
      res.status(502).json({ error: "No response body from upstream", code: "NO_BODY" });
      return;
    }

    await pipeline(
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
      res,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg }, "Download proxy failed");

    if (!res.headersSent) {
      res.status(500).json({
        error: "Download failed. Please try again.",
        code: "PROXY_ERROR",
      });
    }
  }
});

export default router;
