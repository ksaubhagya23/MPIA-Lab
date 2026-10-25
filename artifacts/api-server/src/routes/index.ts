import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nasaRouter from "./nasa";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nasaRouter);

export default router;

