import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(helmet());
app.use(cors());

// Body size limits
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

// Rate limiting — shared limiter for all /api routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
  skip: (req) => req.method === "GET" && req.path === "/api/healthz",
});

// Tighter limit for the extraction endpoint (yt-dlp is expensive)
const extractLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many fetch requests. Please wait a moment.", code: "RATE_LIMITED" },
});

// Tighter limit for the download proxy (bandwidth-heavy)
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many download requests. Please wait a moment.", code: "RATE_LIMITED" },
});

app.use("/api", apiLimiter);
app.use("/api/x-video", extractLimiter);
app.use("/api/download-file", downloadLimiter);

app.use("/api", router);

export default app;
