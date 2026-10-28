import { Router, type IRouter } from "express";
import checkoutRouter from "./checkout";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(checkoutRouter);

export default router;
