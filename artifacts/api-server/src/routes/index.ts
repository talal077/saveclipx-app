import { Router, type IRouter } from "express";
import healthRouter from "./health";
import xvideoRouter from "./xvideo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(xvideoRouter);

export default router;
