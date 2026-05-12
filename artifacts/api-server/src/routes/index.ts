import { Router, type IRouter } from "express";
import healthRouter from "./health";
import xvideoRouter from "./xvideo";
import downloadRouter from "./download";

const router: IRouter = Router();

router.use(healthRouter);
router.use(xvideoRouter);
router.use(downloadRouter);

export default router;
